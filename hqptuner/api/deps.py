"""Shared dependencies and response shapes for the /api routers.

``app`` and ``matrixapi`` are one REST surface split by the file-length gate, so
they had grown two verbatim copies of the same three helpers and twelve copies
of the credentials guard. A guard that must be remembered on every new route is
a guard that eventually is not: as FastAPI dependencies it rides the signature
instead — ``def matrix(mgr: HttpMgr)`` cannot forget to check.

No route idle-gates. A write that reloads or restarts the engine interrupts
playback, and that is the user's call to make — HQPTuner does not decide on
their behalf that they may not do it right now (project rule: never idle-gate a
user action).
"""

from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request

from ..manager import ConnectionManager


def manager_of(request: Request) -> ConnectionManager:
    """The app's connection manager. Reads never touch the socket."""
    mgr: ConnectionManager = request.app.state.manager
    return mgr


def require_credentials(request: Request) -> None:
    """503 unless hqplayerd management credentials were configured — without them
    the 8088 lane does not exist, so every route that reads or writes persistent
    config is unavailable rather than broken."""
    if request.app.state.http_client is None:
        raise HTTPException(status_code=503, detail="no hqplayerd credentials configured")


def _http_manager(request: Request) -> ConnectionManager:
    require_credentials(request)
    return manager_of(request)


Mgr = Annotated[ConnectionManager, Depends(manager_of)]
HttpMgr = Annotated[ConnectionManager, Depends(_http_manager)]


def snapshot(manager: ConnectionManager, data: Any) -> dict[str, Any]:
    """Serve last-loaded state, flagged stale when the daemon is unreachable —
    never a socket wait (roadmap 2.2 fail-fast rule)."""
    if data is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    return {"stale": not manager.reachable, "loaded_at": manager.loaded_at, "data": data}


def ensure_form(form: dict[str, Any] | None, error: str | None, label: str) -> dict[str, Any]:
    """A polled 8088 form, or the honest reason it is missing: 502 when the fetch
    itself failed (the daemon answered badly), 503 when nothing has been loaded
    yet (the first poll has not landed). Returns the form so callers can build a
    response off it without re-checking for None."""
    if form is not None:
        return form
    if error:
        raise HTTPException(status_code=502, detail=f"GET {label} failed: {error}")
    raise HTTPException(status_code=503, detail="not yet loaded from daemon")
