"""hqplayerd HTTP configuration interface (port 8088) — read side.

GET /config under Digest auth returns the full persistent-settings form;
parse_config_form() turns it into a settings model: every field with its
current value and constraints, grouped by the form's own section/label
structure. This is the sole persistent-config read path — no direct
hqplayerd.xml parsing (docs/architecture.md §2).
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
    """Parse a settings form page into ``{fields, profiles}``.

    ``fields`` is every value-bearing input and select across the page's POST forms, each with its current value,
    its number constraints and the ``<h2>``/``<h3>`` section+label it sits under; submit, button and hidden inputs
    are dropped. ``profiles`` is the preset ``profile`` select lifted out of that list (the /config/profile/* CRUD
    form), or None on a page that carries no such select.
    """
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
    """Read the active matrix profile name, printed as ``<b>Active: </b>NAME`` on the form.

    ``[Default]`` = the unnamed default.
    """
    for b in soup.find_all("b"):
        if b.get_text(strip=True).startswith("Active:"):
            text = b.next_sibling
            if isinstance(text, str):
                return text.strip()
    return ""


def _matrix_profiles(soup: BeautifulSoup, profile_field: dict[str, Any] | None) -> dict[str, Any] | None:
    """Join the profile text input with its ``<datalist>`` options, the saved matrix profiles.

    The generic parser sees only a bare text input — the options live in a
    datalist the input references by id.
    """
    if profile_field is None:
        return None
    datalist = soup.find("datalist")
    options = [
        {"value": opt.get("value", ""), "label": opt.get_text(strip=True)}
        for opt in (datalist.find_all("option") if isinstance(datalist, Tag) else [])
    ]
    return {**profile_field, "options": options}


def parse_matrix_form(html: str) -> dict[str, Any]:
    """Parse the /matrix form into ``{fields, rows, profiles, active}``.

    ``fields`` are the flat controls (enabled/engine/expand_hf/iir2fir + the
    post-process plugin table); ``rows`` groups the indexed pipeline-table fields
    (``source_N``/``gain_N``/``gainunit_N``/``mixdown_N``/``process_N``) into one
    dict per pipeline; ``profiles`` is the profile input with its datalist
    options; ``active`` the printed active-profile name. Tolerates the daemon's
    malformed gainunit markup (``value="dB""`` — stray quote), which the HTML
    parser reads as a normal value plus a junk attribute.
    """
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


_SPEAKER_FIELD_RE = re.compile(r"^(level|distance)_(\d+)$")
# readme §1.9.1: level is dBFS, distance is cm. Ranges from the live form inputs.
_SPK_LEVEL = (-60.0, 0.0)
_SPK_DISTANCE = (0.0, 5000.0)


def parse_speakers_form(html: str) -> dict[str, Any]:
    """Parse the /speakers form into ``{enabled, channels}``.

    Speaker processing is a top-level config element (readme §1.9), absent from
    /config — this is its only read surface. Each channel is ``{index, label, level, distance}`` plus the
    input min/max/step constraints; ``label`` is the daemon's own channel name (the
    ``<h2>`` above each pair: Left, Right, Center, LFE, Left rear, ...).
    """
    base = parse_config_form(html)
    enabled = False
    chans: dict[int, dict[str, Any]] = {}
    for f in base["fields"]:
        name = f.get("name") or ""
        if name == "enabled":
            enabled = bool(f.get("value"))
            continue
        m = _SPEAKER_FIELD_RE.match(name)
        if m is None:
            continue
        kind, idx = m.group(1), int(m.group(2))
        ch = chans.setdefault(idx, {"index": idx, "label": f.get("section")})
        ch[kind] = f.get("value")
        for attr in ("min", "max", "step"):
            if attr in f:
                ch[f"{kind}_{attr}"] = f[attr]
    return {"enabled": enabled, "channels": [chans[i] for i in sorted(chans)]}


def _validate_speaker_num(value: str, bounds: tuple[float, float], field: str) -> str:
    """Numeric + in-range or raise.

    Returns the caller's exact string so a 0.1 level step survives verbatim —
    garbage never reaches the daemon.
    """
    lo, hi = bounds
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"speakers: {field}={value!r} is not numeric") from None
    if not (lo <= n <= hi):
        raise ValueError(f"speakers: {field}={value} out of range [{lo:g}, {hi:g}]")
    return value


def serialize_matrix_form(html: str) -> tuple[dict[str, str], list[str]]:
    """Complete, browser-faithful serialization of the /matrix form.

    Checked checkboxes only (submitting their ``value`` attr — the daemon
    persists a stray ``on`` verbatim into its XML and wedges engine init,
    matrix-spec probe findings), the selected option per select, text/number
    values as-is. Returns ``(fields, file_input_names)`` — the daemon silently
    ignores any partial POST, so every write must carry the whole thing.
    """
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
    """Return what a browser submits for an input.

    None for buttons and unchecked checkboxes; a checked checkbox submits its
    value attr (never 'on').
    """
    itype = el.get("type", "text")
    if itype in ("submit", "button"):
        return None
    if itype == "checkbox":
        return (_attr(el, "value") or "on") if el.has_attr("checked") else None
    return _attr(el, "value") or ""


# The CRUD verbs both profile subsystems take: /matrix/{action} for matrix
# profiles, /config/profile/{action} for preset mirrors. Different routes, same
# three verbs — one tuple, so a route that grows a fourth verb is a deliberate
# split rather than a copy that silently fell behind.
_ACTIONS = ("load", "save", "delete")


class HttpConfigClient:
    """Async client for hqplayerd's HTTP configuration interface — the /config, /matrix, /speakers and /backup forms.

    Every route here is a read or a whole-form write against that port; nothing on this lane touches the 4321
    control protocol.
    """

    def __init__(self, host: str, port: int, username: str, password: str, timeout: float = 10.0):
        """Open the Digest-authenticated connection pool against ``host:port``, with ``timeout`` on every request."""
        self._client = httpx.AsyncClient(
            base_url=f"http://{host}:{port}",
            auth=httpx.DigestAuth(username, password),
            timeout=timeout,
        )

    async def _get(self, path: str) -> httpx.Response:
        """GET, raising on any non-2xx.

        Every read on this lane goes through here so no route can forget to check
        the status and parse an error page as if it were a form.
        """
        resp = await self._client.get(path)
        resp.raise_for_status()
        return resp

    async def _post(self, path: str, **kwargs: Any) -> None:
        """POST, raising on any non-2xx.

        No caller needs the body — the daemon answers a write with its own HTML
        page, and what actually landed is established by readback, never by the
        response.
        """
        resp = await self._client.post(path, **kwargs)
        resp.raise_for_status()

    async def get_config(self) -> dict[str, Any]:
        """GET /config — the persistent-settings form, parsed into fields plus the preset select."""
        return parse_config_form((await self._get("/config")).text)

    async def get_matrix(self) -> dict[str, Any]:
        """GET /matrix — the pipeline/post-processing form.

        Carries pipeline rows, matrix profiles, Bauer crossfeed, DAC correction
        and loudness. The daemon silently ignores a partial POST here too
        (docs/matrix-spec.md probe findings), so writes overlay a fresh read
        (manager).
        """
        return parse_matrix_form((await self._get("/matrix")).text)

    # No profile CRUD on this lane. ``POST /matrix/{load,save,delete}`` cost a
    # ~3 s engine reload each and never persisted a saved profile anyway (the
    # daemon keeps it in memory only, matrix-spec.md "Probe findings — saved"),
    # so save/delete became
    # staged ``<matrix_profile>`` config edits and load rides 4321
    # ``MatrixSetProfile``. Nothing here writes /matrix any more.

    async def get_speakers(self) -> dict[str, Any]:
        """GET /speakers — the multi-channel speaker-processing form (readme §1.9).

        Carries the enabled switch and per-channel level (dBFS) + distance (cm).
        """
        return parse_speakers_form((await self._get("/speakers")).text)

    async def apply_speakers(self, channels: dict[str, dict[str, str]], *, enabled: bool) -> None:
        """Apply speaker processing via the /speakers Apply form.

        Overlays the desired enabled + per-channel level/distance onto a fresh
        COMPLETE GET (a partial POST is silently ignored, same contract as
        /config and /matrix) and enforces the checkbox contract: ``enabled=1`` when on, the field
        OMITTED when off — never a raw ``0``/``on``, which the daemon writes
        verbatim and wedges engine init (matrix-spec probe). Levels are validated
        to dBFS [-60, 0], distances to cm [0, 5000] — garbage is rejected, not
        sent. The daemon reloads the engine (~3 s), interrupting playback.
        """
        # generic complete-form serialize
        fields, _ = serialize_matrix_form((await self._get("/speakers")).text)
        fields.pop("enabled", None)  # checkbox rebuilt below, contract-safe
        for idx, ch in channels.items():
            i = int(idx)
            if "level" in ch:
                fields[f"level_{i}"] = _validate_speaker_num(ch["level"], _SPK_LEVEL, f"level_{i}")
            if "distance" in ch:
                fields[f"distance_{i}"] = _validate_speaker_num(ch["distance"], _SPK_DISTANCE, f"distance_{i}")
        if enabled:
            fields["enabled"] = "1"
        await self._post("/speakers", data=fields)

    async def post_profile(self, action: str, **fields: str) -> None:
        """Preset CRUD: action in load/save/delete (protocol.md §3.6).

        `load` also restarts the daemon.
        """
        if action not in _ACTIONS:
            raise ValueError(f"unknown profile action: {action}")
        await self._post(f"/config/profile/{action}", data=fields)

    async def refresh_devices(self) -> None:
        """Ask the daemon to re-scan its output devices.

        Verified against the live
        6.0.4 web UI: the "Refresh devices" button is a submit in a ``method=get``
        form with ``formaction="/config/refresh"``, i.e. a bare ``GET
        /config/refresh`` (no body). A POST is silently ignored. Picks up an
        endpoint (e.g. a NAA that was powered off) absent from the device list —
        the caller re-reads the form afterwards to serve the new options.
        """
        await self._get("/config/refresh")

    async def restore(self, cfgfile: bytes, scope: str = "system") -> None:
        """Restore a full settings archive via multipart ``POST /restore``.

        ``scope="system"`` targets the running config (``/etc/hqplayer``);
        ``"user"`` targets ``~/.hqplayer``. Grounded on 6.0.4: ``scope=system``
        writes every archive member to disk (**additively** — a member omitted
        from the zip is not deleted) and the daemon self-restarts (~5.6 s), landing
        on the ``[default]`` config (``hqplayerd.xml``); it does **not** restore a
        named active profile (docs/protocol.md §3.6). The connection manager's
        outage path handles the restart/resync. ``cfgfile`` is a ``/backup``
        settings.zip (or config xml).
        """
        await self._post(
            "/restore",
            data={"scope": scope},
            files={"cfgfile": ("settings.zip", cfgfile, "application/zip")},
        )

    async def backup(self) -> bytes:
        """Daemon's settings backup (a zip) — a safety copy taken before an apply.

        The plain /backup route is only the HTML page; the actual settings
        archive is /backup/settings.zip (verified on 6.0.4).
        """
        return (await self._get("/backup/settings.zip")).content

    async def aclose(self) -> None:
        """Close the underlying HTTP client and its connection pool."""
        await self._client.aclose()
