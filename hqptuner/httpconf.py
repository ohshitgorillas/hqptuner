"""hqplayerd HTTP configuration interface (port 8088) — read side.

GET /config under Digest auth returns the full persistent-settings form;
parse_config_form() turns it into a settings model: every field with its
current value and constraints, grouped by the form's own section/label
structure. This is the sole persistent-config read path (roadmap §2.1
decision — no direct hqplayerd.xml parsing).
"""

import re
from typing import Any

import httpx
from bs4 import BeautifulSoup, Tag


def _attr(el: Tag, name: str) -> str | None:
    value = el.get(name)
    if isinstance(value, list):
        return " ".join(value)
    return value


def _number(raw: str | None) -> Any:
    try:
        return int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        try:
            return float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return raw


def _parse_input(el: Tag, section: str | None, label: str | None) -> dict[str, Any] | None:
    itype = el.get("type", "text")
    if itype in ("submit", "button", "hidden"):
        return None
    field: dict[str, Any] = {
        "name": el.get("name"),
        "type": itype,
        "section": section,
        "label": label,
    }
    if itype == "checkbox":
        field["value"] = el.has_attr("checked")
        # the value the daemon expects on submit when checked (verified: "1",
        # not the HTML default "on") — carried so the serializer round-trips it
        field["on_value"] = _attr(el, "value") or "on"
    elif itype == "number":
        field["value"] = _number(_attr(el, "value"))
        for attr in ("min", "max", "step"):
            if el.has_attr(attr):
                field[attr] = _number(_attr(el, attr))
    else:
        field["value"] = el.get("value", "")
    return field


def _parse_select(el: Tag, section: str | None, label: str | None) -> dict[str, Any]:
    options = [
        {
            "value": opt.get("value", ""),
            "label": opt.get_text(strip=True),
            "selected": opt.has_attr("selected"),
        }
        for opt in el.find_all("option")
    ]
    selected = next(
        (o["value"] for o in options if o["selected"]),
        options[0]["value"] if options else None,
    )
    return {
        "name": el.get("name"),
        "type": "select",
        "section": section,
        "label": label,
        "value": selected,
        "options": options,
    }


def parse_config_form(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    fields: list[dict[str, Any]] = []
    profiles: dict[str, Any] | None = None

    for form in soup.find_all("form", method="post"):
        section: str | None = None
        label: str | None = None
        for el in form.descendants:
            if not isinstance(el, Tag):
                continue
            if el.name == "h2":
                section = el.get_text(strip=True)
            elif el.name == "h3":
                label = el.get_text(strip=True)
            elif el.name == "input":
                field = _parse_input(el, section, label)
                if field is not None:
                    fields.append(field)
            elif el.name == "select":
                field = _parse_select(el, section, label)
                if field["name"] == "profile":
                    # the profile CRUD form (POST /config/profile/*); [default]
                    # is the empty-value unnamed base configuration
                    profiles = field
                else:
                    fields.append(field)

    return {"fields": fields, "profiles": profiles}


# /matrix pipeline-table fields are indexed per row: source_0, gain_0, ... The
# `plot` checkbox is a client-side toggle and `filter` the upload slot — neither
# carries config state, so rows keep only the five value-bearing columns.
_MATRIX_ROW_RE = re.compile(r"^(source|gain|gainunit|mixdown|process|plot|filter)_(\d+)$")
_MATRIX_ROW_SKIP = ("plot", "filter")


def _matrix_active(soup: BeautifulSoup) -> str:
    """The active matrix profile name, printed as ``<b>Active: </b>NAME`` on the
    form (``[Default]`` = the unnamed default)."""
    for b in soup.find_all("b"):
        if b.get_text(strip=True).startswith("Active:"):
            text = b.next_sibling
            if isinstance(text, str):
                return text.strip()
    return ""


def _matrix_profiles(soup: BeautifulSoup, profile_field: dict[str, Any] | None) -> dict[str, Any] | None:
    """The profile text input joined with its ``<datalist>`` options (the saved
    matrix profiles). The generic parser sees only a bare text input — the
    options live in a datalist the input references by id."""
    if profile_field is None:
        return None
    datalist = soup.find("datalist")
    options = [
        {"value": opt.get("value", ""), "label": opt.get_text(strip=True)}
        for opt in (datalist.find_all("option") if isinstance(datalist, Tag) else [])
    ]
    return {**profile_field, "options": options}


def parse_matrix_form(html: str) -> dict[str, Any]:
    """The /matrix form parsed into ``{fields, rows, profiles, active}``.

    ``fields`` are the flat controls (enabled/engine/expand_hf/iir2fir + the
    post-process plugin table); ``rows`` groups the indexed pipeline-table fields
    (``source_N``/``gain_N``/``gainunit_N``/``mixdown_N``/``process_N``) into one
    dict per pipeline; ``profiles`` is the profile input with its datalist
    options; ``active`` the printed active-profile name. Tolerates the daemon's
    malformed gainunit markup (``value="dB""`` — stray quote), which the HTML
    parser reads as a normal value plus a junk attribute."""
    base = parse_config_form(html)
    soup = BeautifulSoup(html, "html.parser")
    rows: dict[int, dict[str, Any]] = {}
    fields: list[dict[str, Any]] = []
    profile_field: dict[str, Any] | None = None
    for f in base["fields"]:
        m = _MATRIX_ROW_RE.match(f.get("name") or "")
        if m:
            if m.group(1) not in _MATRIX_ROW_SKIP:
                rows.setdefault(int(m.group(2)), {})[m.group(1)] = f.get("value")
            continue
        if f.get("name") == "profile":
            profile_field = f
            continue
        fields.append(f)
    return {
        "fields": fields,
        "rows": [{"index": i, **rows[i]} for i in sorted(rows)],
        "profiles": _matrix_profiles(soup, profile_field),
        "active": _matrix_active(soup),
    }


def serialize_matrix_form(html: str) -> tuple[dict[str, str], list[str]]:
    """Complete, browser-faithful serialization of the /matrix form: checked
    checkboxes only (submitting their ``value`` attr — the daemon persists a
    stray ``on`` verbatim into its XML and wedges engine init, matrix-spec probe
    findings), the selected option per select, text/number values as-is.
    Returns ``(fields, file_input_names)`` — the daemon silently ignores any
    partial POST, so every write must carry the whole thing."""
    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form")
    fields: dict[str, str] = {}
    files: list[str] = []
    for el in form.find_all(["input", "select"]) if isinstance(form, Tag) else []:
        name = el.get("name")
        if not isinstance(name, str) or not name:
            continue
        if el.name == "select":
            fields[name] = _selected_value(el)
        elif el.get("type") == "file":
            files.append(name)
        else:
            value = _submitted_value(el)
            if value is not None:
                fields[name] = value
    return fields, files


def _selected_value(el: Tag) -> str:
    opts = el.find_all("option")
    sel = next((o for o in opts if o.has_attr("selected")), opts[0] if opts else None)
    return (_attr(sel, "value") or "") if isinstance(sel, Tag) else ""


def _submitted_value(el: Tag) -> str | None:
    """What a browser submits for an input — None for buttons and unchecked
    checkboxes; a checked checkbox submits its value attr (never 'on')."""
    itype = el.get("type", "text")
    if itype in ("submit", "button"):
        return None
    if itype == "checkbox":
        return (_attr(el, "value") or "on") if el.has_attr("checked") else None
    return _attr(el, "value") or ""


_MATRIX_ACTIONS = ("load", "save", "delete")
_PROFILE_ACTIONS = ("load", "save", "delete")


class HttpConfigClient:
    def __init__(self, host: str, port: int, username: str, password: str, timeout: float = 10.0):
        self._client = httpx.AsyncClient(
            base_url=f"http://{host}:{port}",
            auth=httpx.DigestAuth(username, password),
            timeout=timeout,
        )

    async def get_config(self) -> dict[str, Any]:
        resp = await self._client.get("/config")
        resp.raise_for_status()
        return parse_config_form(resp.text)

    async def get_matrix(self) -> dict[str, Any]:
        """GET /matrix — the pipeline/post-processing form (pipeline rows, matrix
        profiles, Bauer crossfeed, DAC correction, loudness). The daemon silently
        ignores a partial POST here too (docs/matrix-spec.md probe findings), so
        writes overlay a fresh read (manager)."""
        resp = await self._client.get("/matrix")
        resp.raise_for_status()
        return parse_matrix_form(resp.text)

    async def matrix_profile_action(self, action: str, name: str) -> None:
        """``POST /matrix/{load,save,delete}`` with the COMPLETE current form
        (fresh GET, serialized browser-faithfully — a partial POST is silently
        ignored) and the ``profile`` field set to ``name``. save/delete reload
        the engine ~3 s; a named load applies live but replaces the whole matrix
        context including post-process (docs/matrix-spec.md probe findings)."""
        if action not in _MATRIX_ACTIONS:
            raise ValueError(f"unknown matrix profile action: {action}")
        resp = await self._client.get("/matrix")
        resp.raise_for_status()
        fields, file_names = serialize_matrix_form(resp.text)
        fields["profile"] = name
        files = [(n, ("", b"", "application/octet-stream")) for n in file_names]
        resp = await self._client.post(f"/matrix/{action}", data=fields, files=files)
        resp.raise_for_status()

    async def post_profile(self, action: str, **fields: str) -> None:
        """Preset CRUD: action in load/save/delete (protocol.md §3.6). `load`
        also restarts the daemon."""
        if action not in _PROFILE_ACTIONS:
            raise ValueError(f"unknown profile action: {action}")
        resp = await self._client.post(f"/config/profile/{action}", data=fields)
        resp.raise_for_status()

    async def refresh_devices(self) -> None:
        """Ask the daemon to re-scan its output devices. Verified against the live
        6.0.4 web UI: the "Refresh devices" button is a submit in a ``method=get``
        form with ``formaction="/config/refresh"``, i.e. a bare ``GET
        /config/refresh`` (no body). A POST is silently ignored. Picks up an
        endpoint (e.g. a NAA that was powered off) absent from the device list —
        the caller re-reads the form afterwards to serve the new options."""
        resp = await self._client.get("/config/refresh")
        resp.raise_for_status()

    async def restore(self, cfgfile: bytes, scope: str = "system") -> None:
        """Restore a full settings archive via multipart ``POST /restore``.
        ``scope="system"`` targets the running config (``/etc/hqplayer``);
        ``"user"`` targets ``~/.hqplayer``. Grounded on 6.0.4: ``scope=system``
        writes every archive member to disk (**additively** — a member omitted
        from the zip is not deleted) and the daemon self-restarts (~5.6 s), landing
        on the ``[default]`` config (``hqplayerd.xml``); it does **not** restore a
        named active profile (docs/protocol.md §3.6). The connection manager's
        outage path handles the restart/resync. ``cfgfile`` is a ``/backup``
        settings.zip (or config xml)."""
        resp = await self._client.post(
            "/restore",
            data={"scope": scope},
            files={"cfgfile": ("settings.zip", cfgfile, "application/zip")},
        )
        resp.raise_for_status()

    async def backup(self) -> bytes:
        """Daemon's settings backup (a zip) — a safety copy taken before an
        apply. The plain /backup route is only the HTML page; the actual
        settings archive is /backup/settings.zip (verified on 6.0.4)."""
        resp = await self._client.get("/backup/settings.zip")
        resp.raise_for_status()
        return resp.content

    async def aclose(self) -> None:
        await self._client.aclose()
