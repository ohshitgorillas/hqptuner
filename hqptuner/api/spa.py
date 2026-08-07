"""SPA static-asset mount — the bundled frontend, served with revalidation forced."""

from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles
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


def mount_spa(app: FastAPI) -> None:
    """Mount the bundled SPA at "/", if it was built into the package; a source checkout has no such directory."""
    # Mounted last and at "/", so the /api routes win; the SPA's static assets and
    # index.html fall through to here.
    static_dir = Path(__file__).resolve().parent.parent / "static"
    if static_dir.is_dir():
        app.mount("/", NoCacheStaticFiles(directory=static_dir, html=True), name="spa")
