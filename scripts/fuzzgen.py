#!/usr/bin/env python3
"""Generate hostile requests from the OpenAPI spec, and say how dangerous each one is.

Every attack ``scripts/fuzz.py`` sends is built here, before the first request
goes out, so the run is a fixed list rather than a loop that decides as it goes.
Attacks come off the declared schema — per field, per type, per request shape —
which is why a route added to the API is fuzzed the day its schema lands.

Each attack also carries the class that decides how carefully it may be sent
(``classify``): ``read``, ``stage``, ``apply``, ``live``, ``store`` or ``never``.
The class is worked out from the route template, never from the path a name has
already been substituted into, because ``/api/preset/{name}`` writes the store
and ``/api/preset/fuzz-ab12`` would otherwise look like an ordinary route.
"""

from dataclasses import dataclass, field
from typing import Any

LONG = "A" * 4096
BIG_MAP_KEYS = 500
BIG_ARRAY = 2000
RACE_WIDTH = 4
RACE_CATEGORY = 6

NEVER = {"/api/backup", "/api/restore", "/api/autosave"}
APPLY = {"/api/config/apply", "/api/engine", "/api/speakers"}
LIVE = {"/api/config/live", "/api/volume", "/api/matrix/profile", "/api/livepresets/{name}/apply"}
STAGE = {"/api/config/stage", "/api/config/pending", "/api/config/refresh", "/api/matrix/filter"}
STORE = {
    "/api/favorites",
    "/api/narrowing",
    "/api/matrixmodes",
    "/api/descriptions",
    "/api/livepresets/{name}",
    "/api/preset/{name}",
    "/api/profile/{action}",
    "/api/autopilot",
}

STRINGS: list[tuple[Any, str]] = [
    ("", "empty string"),
    ("   ", "whitespace only"),
    ("\x00\x07", "control characters"),
    (chr(0xB4) + chr(0xA5) + chr(0x2603), "unicode"),
    (LONG, "4096-character string"),
    (123, "number where a string is declared"),
    (None, "null"),
    ([], "array where a string is declared"),
]
NUMBERS: list[tuple[Any, str]] = [
    (-1, "negative"),
    (10**308, "huge"),
    ("12", "number as a string"),
    ("NaN", "NaN as text"),
    (None, "null"),
]
BOOLEANS: list[tuple[Any, str]] = [("true", "boolean as a string"), (1, "boolean as a number"), (None, "null")]
NAMES: list[tuple[str, str]] = [
    ("../../etc/passwd", "traversal"),
    ("a/b", "slash"),
    ("a\\b", "backslash"),
    ("..", "dots"),
    ("%20", "encoded space"),
    ("   ", "whitespace only"),
    (chr(0x430) + "dmin", "lookalike unicode"),
    (LONG, "4096-character name"),
]


@dataclass
class Attack:
    """One generated request: what to send, how dangerous it is, and the words its record files it under."""

    category: int
    method: str
    path: str
    note: str
    klass: str = "read"
    body: Any = None
    params: dict[str, Any] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    raw: str | None = None


def classify(method: str, template: str) -> str:
    """Return the class that decides how carefully one operation may be attacked, from its route template."""
    if template in NEVER:
        return "never"
    if method == "GET":
        return "read"
    if template in APPLY:
        return "apply"
    if template in LIVE:
        return "live"
    if template in STAGE:
        return "stage"
    return "store" if template in STORE else "never"


def deref(spec: dict[str, Any], node: dict[str, Any]) -> dict[str, Any]:
    """Resolve one ``$ref`` into ``components.schemas``, returning other nodes unchanged."""
    ref = node.get("$ref")
    if not isinstance(ref, str):
        return node
    schemas: dict[str, Any] = spec.get("components", {}).get("schemas", {})
    return dict(schemas.get(ref.rsplit("/", 1)[-1], {}))


def scalar_attacks(schema: dict[str, Any]) -> list[tuple[Any, str]]:
    """Return the value/note pairs that abuse one declared scalar type."""
    kind = schema.get("type")
    if kind in {"number", "integer"}:
        return NUMBERS
    if kind == "boolean":
        return BOOLEANS
    if kind == "array":
        return [("x", "string where an array is declared"), ([None], "null element")]
    return STRINGS


def map_attacks(schema: dict[str, Any]) -> list[tuple[Any, str]]:
    """Return the value/note pairs that abuse a free-form object map."""
    inner = schema.get("additionalProperties")
    hits: list[tuple[Any, str]] = [({"": ""}, "empty key"), ({"nope": "x"}, "unknown key")]
    if isinstance(inner, dict) and inner.get("type") == "string":
        hits += [({"filter1x": value}, f"known key, {note}") for value, note in STRINGS[:4]]
    hits.append(({f"k{n}": "x" for n in range(BIG_MAP_KEYS)}, f"{BIG_MAP_KEYS}-key map"))
    return hits


def placeholder(spec: dict[str, Any], schema: dict[str, Any]) -> Any:
    """Return a minimal in-shape value for a required field, so other fields can be attacked alone."""
    kind = deref(spec, schema).get("type")
    return {"number": 1, "integer": 1, "boolean": True, "array": [], "object": {}}.get(str(kind), "x")


def body_attacks(spec: dict[str, Any], schema: dict[str, Any]) -> list[tuple[Any, str]]:
    """Return one body per field per abusive value, holding the other required fields in shape."""
    schema = deref(spec, schema)
    props: dict[str, Any] = schema.get("properties", {})
    required: list[str] = schema.get("required", [])
    base = {name: placeholder(spec, props.get(name, {})) for name in required}
    out: list[tuple[Any, str]] = []
    for name, raw in props.items():
        prop = deref(spec, raw)
        pairs = map_attacks(prop) if prop.get("additionalProperties") is not None else scalar_attacks(prop)
        out += [({**base, name: value}, f"{name}: {note}") for value, note in pairs]
    out += [({k: v for k, v in base.items() if k != drop}, f"{drop}: omitted") for drop in required]
    arrays = [name for name, raw in props.items() if deref(spec, raw).get("type") == "array"]
    if arrays:
        out.append(({**base, arrays[0]: ["x"] * BIG_ARRAY}, f"{arrays[0]}: {BIG_ARRAY} elements"))
    return out


def shape_attacks(method: str, template: str, path: str, declared: set[str], *, has_body: bool) -> list[Attack]:
    """Return the request-shape attacks that depend on no field: bad JSON, wrong method, wrong content type.

    ``declared`` is the set of methods the spec gives this path. A method it does not list reaches no handler, so
    the attack is as harmless as a read and is not held back by the caps the real writer on that path answers to.
    """
    klass, other = classify(method, template), "GET" if method != "GET" else "POST"
    wrong = classify(other, template) if template in NEVER or other in declared else "read"
    note = "empty body on a POST" if has_body else "body on a route that takes none"
    return [
        Attack(2, method, path, "malformed JSON", klass, raw="{"),
        Attack(2, method, path, "wrong content type", klass, raw="name=x", headers={"content-type": "text/plain"}),
        Attack(2, other, path, "wrong method", wrong),
        Attack(2, method, path, note, klass, raw="" if has_body else '{"x": 1}'),
    ]


def name_attacks(method: str, template: str, params: list[dict[str, Any]]) -> list[Attack]:
    """Return the path-segment and query-string attacks for one operation's declared parameters."""
    klass = classify(method, template)
    out: list[Attack] = []
    for param in params:
        name = str(param.get("name"))
        for value, note in NAMES:
            if param.get("in") == "path":
                out.append(Attack(3, method, template.replace("{" + name + "}", value), f"{name}: {note}", klass))
            else:
                out.append(Attack(3, method, template, f"{name}: {note}", klass, params={name: value}))
    return out


def fixed_attacks(name: str) -> list[Attack]:
    """Return the attacks no schema describes: the sequences, the oversized bodies, and the bounded races."""
    edit = {"http": {"filter1x": "1"}}
    stage, pending, apply = "/api/config/stage", "/api/config/pending", "/api/config/apply"
    big = {"http": {f"f{n}": "1" for n in range(BIG_MAP_KEYS)}}
    upload = f"--x\r\n{LONG}\r\n--x--\r\n"
    filters = "/api/matrix/filter"
    out = [
        Attack(4, "POST", stage, "double submit, step 1", "stage", body=edit),
        Attack(4, "POST", stage, "double submit, step 2", "stage", body=edit),
        Attack(4, "DELETE", pending, "stage then discard then apply, step 2", "stage"),
        Attack(4, "POST", apply, "stage then discard then apply, step 3", "apply", body={}),
        Attack(4, "POST", apply, "apply twice, step 2", "apply", body={}),
        Attack(4, "DELETE", f"/api/preset/{name}", "delete then use, step 1", "store"),
        Attack(4, "GET", f"/api/preset/{name}", "delete then use, step 2", "read"),
        Attack(5, "POST", stage, f"staged buffer of {BIG_MAP_KEYS} fields", "stage", body=big),
        Attack(5, "POST", filters, "long field name on the upload route", "stage", raw=upload),
    ]
    out += [
        Attack(RACE_CATEGORY, "POST", stage, f"parallel stage {n + 1}", "stage", body={"http": {"filter1x": str(n)}})
        for n in range(RACE_WIDTH)
    ]
    out.append(Attack(RACE_CATEGORY, "DELETE", pending, "discard racing apply", "stage"))
    out.append(Attack(RACE_CATEGORY, "POST", apply, "apply racing discard", "apply", body={}))
    return out


def operations(spec: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """Return every (method, template, operation) the spec declares, in spec order."""
    return [
        (method.upper(), str(path), operation)
        for path, item in spec.get("paths", {}).items()
        for method, operation in item.items()
        if isinstance(operation, dict)
    ]


def json_schema(operation: dict[str, Any]) -> dict[str, Any] | None:
    """Return the JSON request-body schema of one operation, or None when it takes no JSON body."""
    entry = operation.get("requestBody", {}).get("content", {}).get("application/json")
    if not isinstance(entry, dict):
        return None
    schema = entry.get("schema")
    return schema if isinstance(schema, dict) else None


def generate(spec: dict[str, Any], cap: int, name: str) -> list[Attack]:
    """Build every attack for the whole run, before the first request is sent."""
    out: list[Attack] = []
    ops = operations(spec)
    for method, template, operation in ops:
        path = template.replace("{name}", name).replace("{action}", "load")
        declared = {m for m, t, _ in ops if t == template}
        schema = json_schema(operation)
        klass = classify(method, template)
        if schema is not None:
            pairs = body_attacks(spec, schema)[:cap]
            out += [Attack(1, method, path, note, klass, body=body) for body, note in pairs]
        out += shape_attacks(method, template, path, declared, has_body=schema is not None)
        out += name_attacks(method, template, operation.get("parameters", []))[:cap]
    return out + fixed_attacks(name)
