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

    async def post_config(self, fields: dict[str, str]) -> None:
        """Apply persistent settings. The daemon writes hqplayerd.xml itself and
        restarts (protocol.md §3.6); the submit button field is `Apply`. The
        connection manager's outage path handles the restart/resync."""
        resp = await self._client.post("/config", data={**fields, "Apply": "Apply"})
        resp.raise_for_status()

    async def post_profile(self, action: str, **fields: str) -> None:
        """Preset CRUD: action in load/save/delete (protocol.md §3.6). `load`
        also restarts the daemon."""
        if action not in _PROFILE_ACTIONS:
            raise ValueError(f"unknown profile action: {action}")
        resp = await self._client.post(f"/config/profile/{action}", data=fields)
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
