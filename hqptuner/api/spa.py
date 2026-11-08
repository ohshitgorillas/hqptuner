"""SPA static-asset mount — the bundled frontend, served with revalidation forced."""

import base64
import hashlib
import re
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.routing import Match, Mount
from starlette.types import Scope

from hqptuner.config import Config
from hqptuner.paths import bundled

#: The text of the page's one inline script, the import map.
_IMPORT_MAP = re.compile(rb'<script type="importmap">(.*?)</script>', re.DOTALL)

#: Types the mount pins whatever the host's `mimetypes` says: `nosniff` makes a browser refuse a script or a stylesheet
#: served under any other type, and on Windows `mimetypes` reads a registry that can hold a wrong one.
_PINNED_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}


def page_policy(static_dir: Path) -> str:
    """Build the `Content-Security-Policy` for the page in ``static_dir``: its own origin and its import map only.

    Everything the SPA loads comes from its own origin, apart from the `data:` favicon and the `data:` masks in its
    stylesheets. Its one inline script, the import map, is allowed by the SHA-256 of its text as a browser reads it,
    with line ends normalised the way the HTML parser does. A page without an import map has no inline script to allow.
    """
    page = static_dir / "index.html"
    found = _IMPORT_MAP.search(page.read_bytes()) if page.is_file() else None
    inline = ""
    if found:
        text = found.group(1).replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        inline = f" 'sha256-{base64.b64encode(hashlib.sha256(text).digest()).decode()}'"
    return "; ".join(
        (
            "default-src 'none'",
            f"script-src 'self'{inline}",
            "style-src 'self'",
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
        )
    )


class NoCacheStaticFiles(StaticFiles):
    """Serve the SPA with revalidation forced, and with headers that stop it being framed or sniffed.

    Browsers cache ES modules aggressively; on a local config tool that's not worth a stale build shadowing an edit, so
    every asset carries `Cache-Control: no-cache` — the browser must revalidate (a cheap 304 via ETag/Last-Modified)
    instead of blindly reusing. Every asset also carries `X-Content-Type-Options: nosniff` and the content policy.
    """

    def __init__(self, *, directory: Path, html: bool = False) -> None:
        """Serve ``directory``, with the content policy worked out from its ``index.html`` once, here."""
        super().__init__(directory=directory, html=html)
        self._guard = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": page_policy(directory)}

    async def get_response(self, path: str, scope: Scope) -> Response:
        """Serve the asset as StaticFiles would, then stamp the cache, sniffing and content-policy headers on it."""
        try:
            response = await super().get_response(path, scope)
        except HTTPException as refusal:
            refusal.headers = {**(refusal.headers or {}), **self._guard}
            raise
        response.headers["Cache-Control"] = "no-cache"
        response.headers.update(self._guard)
        pinned = _PINNED_TYPES.get(Path(str(getattr(response, "path", ""))).suffix.lower())
        if pinned:
            response.headers["Content-Type"] = pinned
        return response


class SpaMount(Mount):
    """A mount at "/" that declines every path under /api.

    A mount at "/" claims any path no route took, so without this an unknown /api
    path would be answered by the file server: 404 on a GET, 405 on anything else,
    neither carrying a code. Declining lets the router give its own answer, a 404
    for no route and a 405 for a real path hit with the wrong method.
    """

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        """Match as a Mount would, except that /api and everything under it is never ours."""
        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/"):
            return Match.NONE, {}
        return super().matches(scope)


def mount_spa(app: FastAPI, cfg: Config) -> None:
    """Mount the bundled SPA at "/", if it was built into the package; a source checkout has no such directory."""
    # Appended last, so the /api routes win; the SPA's static assets and
    # index.html fall through to here. app.mount builds a plain Mount, so the
    # subclass goes onto the route table by hand.
    static_dir = bundled("static", bundle=cfg.bundle)
    if static_dir.is_dir():
        app.router.routes.append(SpaMount("/", app=NoCacheStaticFiles(directory=static_dir, html=True), name="spa"))
