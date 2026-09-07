"""SPA static-asset mount — the bundled frontend, served with revalidation forced."""

from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles
from starlette.routing import Match, Mount
from starlette.types import Scope


class NoCacheStaticFiles(StaticFiles):
    """Serve the SPA with revalidation forced.

    Browsers cache ES modules aggressively; on a local config tool that's not worth a stale build shadowing an edit, so
    every asset carries `Cache-Control: no-cache` — the browser must revalidate (a cheap 304 via ETag/Last-Modified)
    instead of blindly reusing.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        """Serve the asset as StaticFiles would, then stamp ``Cache-Control: no-cache`` on the way out."""
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
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


def mount_spa(app: FastAPI) -> None:
    """Mount the bundled SPA at "/", if it was built into the package; a source checkout has no such directory."""
    # Appended last, so the /api routes win; the SPA's static assets and
    # index.html fall through to here. app.mount builds a plain Mount, so the
    # subclass goes onto the route table by hand.
    static_dir = Path(__file__).resolve().parent.parent / "static"
    if static_dir.is_dir():
        app.router.routes.append(SpaMount("/", app=NoCacheStaticFiles(directory=static_dir, html=True), name="spa"))
