"""hqplayerd HTTP configuration interface (port 8088) — read side.

GET /config under Digest auth returns the full persistent-settings form;
parse_config_form() turns it into a settings model: every field with its
current value and constraints, grouped by the form's own section/label
structure. This is the sole persistent-config read path (roadmap §2.1
decision — no direct hqplayerd.xml parsing).
"""

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


_SKIP_FIELDS = frozenset({"profile", "profile_name"})  # profile-save inputs, not config
_CHECKBOX_TRUE = frozenset({True, "1", "on", "true", "True"})


def is_checked(value: Any) -> bool:
    """Whether a checkbox override/current-value counts as checked."""
    return value in _CHECKBOX_TRUE


def serialize_config_form(fields: list[dict[str, Any]], overrides: dict[str, str] | None = None) -> dict[str, str]:
    """Render a parsed config model back into a COMPLETE POST /config form,
    applying `overrides` by field name. Checkboxes submit their on-value ("1")
    when truthy and are omitted when not (browser semantics — the daemon needs
    `name=1`, not `name=on`, verified on 6.0.4); other fields submit their
    value. The profile-save inputs are skipped. A partial form is rejected by
    the daemon, so every config field is emitted here."""
    overrides = overrides or {}
    out: dict[str, str] = {}
    for field in fields:
        name = field.get("name")
        if not name or name in _SKIP_FIELDS:
            continue
        if field.get("type") == "file":
            # file inputs (matrix/convolution filter uploads) have no readable
            # value to round-trip; omitting them leaves the loaded file intact
            # (verified on 6.0.4). Never emit name="" — that would clear it.
            continue
        value = overrides.get(name, field.get("value"))
        if field.get("type") == "checkbox":
            if is_checked(value):
                out[name] = str(field.get("on_value", "1"))
        else:
            out[name] = "" if value is None else str(value)
    return out


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
        """GET /matrix — the pipeline/post-processing form (Bauer crossfeed, DAC
        correction, loudness). Same parser as /config; the daemon rejects a
        partial POST here too, so writes overlay a fresh read (manager)."""
        resp = await self._client.get("/matrix")
        resp.raise_for_status()
        return parse_config_form(resp.text)

    async def post_matrix(self, fields: dict[str, str], file_names: tuple[str, ...] = ()) -> None:
        """Apply the /matrix form. Because the form carries `<input type=file>`
        inputs, the daemon expects **multipart/form-data** — a urlencoded POST
        returns 200 but is silently ignored (verified on 6.0.4), so the file
        inputs must be sent as empty parts (filename="" = keep existing). The
        apply restarts the daemon; success is confirmed by readback, never the
        POST. `fields` is the complete form minus file inputs (serialized)."""
        files = {name: ("", b"", "application/octet-stream") for name in file_names}
        resp = await self._client.post("/matrix", data=fields, files=files or None)
        resp.raise_for_status()

    async def post_config(self, fields: dict[str, str]) -> None:
        """Apply persistent settings. The daemon writes hqplayerd.xml itself and
        restarts (protocol.md §3.6); the connection manager's outage path handles
        the restart/resync. The Apply submit button is nameless, so the form
        carries field values alone — no synthetic submit field. `fields` MUST be
        the complete form (see serialize_config_form); the daemon rejects a
        partial form ("Failed!", no write). Verified on 6.0.4."""
        resp = await self._client.post("/config", data=fields)
        resp.raise_for_status()

    async def post_profile(self, action: str, **fields: str) -> None:
        """Preset CRUD: action in load/save/delete (protocol.md §3.6). `load`
        also restarts the daemon."""
        if action not in _PROFILE_ACTIONS:
            raise ValueError(f"unknown profile action: {action}")
        resp = await self._client.post(f"/config/profile/{action}", data=fields)
        resp.raise_for_status()

    async def restore(self, cfgfile: bytes, scope: str = "system") -> None:
        """Restore a full settings archive via multipart ``POST /restore``.
        ``scope="system"`` targets the running config (``/etc/hqplayer``);
        ``"user"`` targets ``~/.hqplayer``. Grounded on 6.0.4: ``scope=system``
        writes the archive and the daemon self-restarts (~5.6 s), **preserving
        the active preset** — the connection manager's outage path handles the
        restart/resync. ``cfgfile`` is a ``/backup`` settings.zip (or config xml)."""
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
