"""Matrix-tab REST surface (matrix-spec): the /matrix read model, profile
operations, and convolution filter uploads. Split out of ``api`` by the
file-length gate — a self-contained feature surface mounted alongside it."""

from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..control import ControlError
from ..manager import ConnectionManager

router = APIRouter(prefix="/api")

_AUTOEQ_BLOB = Path(__file__).resolve().parent.parent / "static" / "vendor" / "autoeq.json.gz"


@router.get("/autoeq")
def autoeq_db() -> FileResponse:
    """Vendored AutoEq parametric-EQ library (built by scripts/build_autoeq_db.py,
    upstream MIT). Pre-gzipped on disk and served with Content-Encoding so the
    browser's fetch decompresses transparently; lazy-loaded on first picker open."""
    if not _AUTOEQ_BLOB.exists():
        raise HTTPException(status_code=404, detail="AutoEq library not built (scripts/build_autoeq_db.py)")
    return FileResponse(
        _AUTOEQ_BLOB,
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "no-cache"},
    )


def _mgr(request: Request) -> ConnectionManager:
    manager: ConnectionManager = request.app.state.manager
    return manager


def _snapshot(manager: ConnectionManager, data: Any) -> dict[str, Any]:
    """Serve last-loaded state, flagged stale when the daemon is unreachable —
    never a socket wait (roadmap 2.2 fail-fast rule)."""
    if data is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    return {"stale": not manager.reachable, "loaded_at": manager.loaded_at, "data": data}


def _require_idle(manager: ConnectionManager) -> None:
    """An engine-reloading operation interrupts playback — refuse unless the
    daemon is idle (State state="0")."""
    if (manager.state or {}).get("state") != "0":
        raise HTTPException(status_code=409, detail="daemon is not idle (stop playback first)")


@router.get("/matrix")
def matrix(request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    if request.app.state.http_client is None:
        raise HTTPException(status_code=503, detail="no hqplayerd credentials configured")
    if manager.matrix_form is None and manager.matrix_error:
        raise HTTPException(status_code=502, detail=f"GET /matrix failed: {manager.matrix_error}")
    if manager.matrix_form is None:
        return _snapshot(manager, None)  # not yet loaded — _snapshot raises 503
    # form-derived shape (fields/rows/profiles/active) plus the live 4321 lane:
    # MatrixListProfiles names and State.matrix_profile (empty = [Default]).
    return _snapshot(
        manager,
        {
            **manager.matrix_form,
            "live_profiles": manager.matrix_profiles or [],
            "live_active": (manager.state or {}).get("matrix_profile", ""),
        },
    )


class MatrixProfileBody(BaseModel):
    action: str  # switch (4321, live) | load | save | delete (form lane, reload)
    name: str = ""  # empty = the unnamed [Default]


@router.post("/matrix/profile")
async def matrix_profile(body: MatrixProfileBody, request: Request) -> dict[str, Any]:
    """Matrix profile operations (matrix-spec step 5). `switch` rides the live
    4321 lane — no reload, no idle gate. save/delete/load ride the form lane and
    reload the engine (~3 s), so they are idle-gated; a named `load` also
    replaces post-process state (probe findings)."""
    manager = _mgr(request)
    if body.action == "switch":
        try:
            return await manager.matrix_switch_profile(body.name)
        except ControlError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    if body.action not in ("load", "save", "delete"):
        raise HTTPException(status_code=404, detail=f"unknown matrix profile action: {body.action}")
    if not body.name and body.action in ("save", "delete"):
        raise HTTPException(status_code=422, detail="profile name required")
    if request.app.state.http_client is None:
        raise HTTPException(status_code=503, detail="no hqplayerd credentials configured")
    _require_idle(manager)
    try:
        return await manager.matrix_profile_action(body.action, body.name)
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"matrix profile {body.action} failed: {exc}") from exc


@router.get("/speakers")
def speakers(request: Request) -> dict[str, Any]:
    """Speaker-processing read model (readme §1.9): enabled + per-channel level
    (dBFS) / distance (cm). Served from the last-loaded form snapshot, stale-flagged
    when the daemon is unreachable — never a socket wait (roadmap 2.2)."""
    manager = _mgr(request)
    if request.app.state.http_client is None:
        raise HTTPException(status_code=503, detail="no hqplayerd credentials configured")
    if manager.speakers_form is None and manager.speakers_error:
        raise HTTPException(status_code=502, detail=f"GET /speakers failed: {manager.speakers_error}")
    if manager.speakers_form is None:
        return _snapshot(manager, None)  # not yet loaded — _snapshot raises 503
    return _snapshot(manager, manager.speakers_form)


class SpeakersBody(BaseModel):
    enabled: bool = False
    channels: dict[str, dict[str, str]] = {}  # channel index -> {level, distance}


@router.post("/speakers")
async def speakers_apply(body: SpeakersBody, request: Request) -> dict[str, Any]:
    """Apply speaker processing via the /speakers form lane (readme §1.9). Reloads
    the engine (~3 s), so it is idle-gated. The write is checkbox-safe and
    range-validated in ``httpconf.apply_speakers``."""
    manager = _mgr(request)
    if request.app.state.http_client is None:
        raise HTTPException(status_code=503, detail="no hqplayerd credentials configured")
    _require_idle(manager)
    try:
        return await manager.apply_speakers(body.enabled, body.channels)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"speakers apply failed: {exc}") from exc


@router.post("/matrix/filter")
async def matrix_filter(request: Request, file: Annotated[UploadFile, File()]) -> dict[str, str]:
    """Park an uploaded convolution filter (wav/txt) for the next apply, which
    injects it into the restore archive; returns the daemon-side absolute path
    the pipeline process string should reference (matrix-spec step 4)."""
    try:
        return _mgr(request).park_filter(file.filename or "", await file.read())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
