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
from . import deps
from .deps import HttpMgr, Mgr

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


@router.get("/matrix")
def matrix(manager: HttpMgr) -> dict[str, Any]:
    form = deps.ensure_form(manager.matrix_form, manager.matrix_error, "/matrix")
    # form-derived shape (fields/rows/profiles/active) plus the live 4321 lane:
    # MatrixListProfiles names and State.matrix_profile (empty = [Default]).
    return deps.snapshot(
        manager,
        {
            **form,
            "live_profiles": manager.matrix_profiles or [],
            "live_active": (manager.state or {}).get("matrix_profile", ""),
        },
    )


class MatrixProfileBody(BaseModel):
    action: str  # switch (4321, live) | load | save | delete (form lane, reload)
    name: str = ""  # empty = the unnamed [Default]


@router.post("/matrix/profile")
async def matrix_profile(body: MatrixProfileBody, request: Request, manager: Mgr) -> dict[str, Any]:
    """Matrix profile operations (matrix-spec step 5). `switch` rides the live
    4321 lane — no reload. save/delete/load ride the form lane and reload the
    engine (~3 s), interrupting playback if any: that is the user's call, not
    ours, so it is never refused for being mid-playback. A named `load` also
    replaces post-process state (probe findings).

    Credentials are checked in the handler rather than by HttpMgr: the live
    `switch` branch does not need them, and an unknown action is a 404 before
    anything else is asked about it."""
    if body.action == "switch":
        try:
            return await manager.matrix_switch_profile(body.name)
        except ControlError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    if body.action not in ("load", "save", "delete"):
        raise HTTPException(status_code=404, detail=f"unknown matrix profile action: {body.action}")
    if not body.name and body.action in ("save", "delete"):
        raise HTTPException(status_code=422, detail="profile name required")
    deps.require_credentials(request)
    try:
        return await manager.matrix_profile_action(body.action, body.name)
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"matrix profile {body.action} failed: {exc}") from exc


@router.get("/speakers")
def speakers(manager: HttpMgr) -> dict[str, Any]:
    """Speaker-processing read model (readme §1.9): enabled + per-channel level
    (dBFS) / distance (cm). Served from the last-loaded form snapshot, stale-flagged
    when the daemon is unreachable — never a socket wait (roadmap 2.2)."""
    form = deps.ensure_form(manager.speakers_form, manager.speakers_error, "/speakers")
    return deps.snapshot(manager, form)


class SpeakersBody(BaseModel):
    enabled: bool = False
    channels: dict[str, dict[str, str]] = {}  # channel index -> {level, distance}


@router.post("/speakers")
async def speakers_apply(body: SpeakersBody, manager: HttpMgr) -> dict[str, Any]:
    """Apply speaker processing via the /speakers form lane (readme §1.9). Reloads
    the engine (~3 s), interrupting playback — never refused for it. The write is
    checkbox-safe and range-validated in ``httpconf.apply_speakers``."""
    try:
        return await manager.apply_speakers(body.enabled, body.channels)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"speakers apply failed: {exc}") from exc


@router.post("/matrix/filter")
async def matrix_filter(file: Annotated[UploadFile, File()], manager: Mgr) -> dict[str, str]:
    """Park an uploaded convolution filter (wav/txt) for the next apply, which
    injects it into the restore archive; returns the daemon-side absolute path
    the pipeline process string should reference (matrix-spec step 4)."""
    try:
        return manager.park_filter(file.filename or "", await file.read())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
