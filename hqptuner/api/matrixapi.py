"""Matrix-tab REST surface (matrix-spec): the /matrix read model, profile
operations, and convolution filter uploads. Split out of ``api`` by the
file-length gate — a self-contained feature surface mounted alongside it."""

import json
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..conf.matrixconf import MATRIX_PROFILES
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
    # file_profiles is the saved-profile truth: the <matrix_profile> elements of
    # the running config, which is where a persisted profile lives and the only
    # place a profile HQPTuner saved but has not applied yet can be seen. The
    # daemon's own list (live_profiles) holds what it read at startup, so the
    # picker shows the union and only a name in live_profiles can switch live.
    return deps.snapshot(
        manager,
        {
            **form,
            "live_profiles": manager.matrix_profiles or [],
            "live_active": (manager.state or {}).get("matrix_profile", ""),
            "file_profiles": json.loads((manager.file_config or {}).get(MATRIX_PROFILES) or "{}"),
        },
    )


class MatrixProfileBody(BaseModel):
    action: str  # switch — the only verb this route has (4321, live)
    name: str = ""  # empty = the unnamed [Default]


@router.post("/matrix/profile")
async def matrix_profile(body: MatrixProfileBody, manager: Mgr) -> dict[str, Any]:
    """Load a saved matrix profile into the running matrix (matrix-spec step 5,
    amended round 5): 4321 ``MatrixSetProfile``, live, no engine reload, playback
    undisturbed, post-process untouched. Needs no credentials — the Control API
    lane is unauthenticated.

    Saving and deleting a profile are NOT here: they are staged
    ``<matrix_profile>`` config edits and ride ``/api/config/stage`` +
    ``/api/config/apply`` like every other persistent setting, because the daemon
    does not persist profiles itself (round 5). The client stages the loaded
    profile's rows alongside this call, so a load is live AND persists."""
    if body.action != "switch":
        raise HTTPException(status_code=404, detail=f"unknown matrix profile action: {body.action}")
    try:
        return await manager.matrix_switch_profile(body.name)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/speakers")
def speakers(manager: HttpMgr) -> dict[str, Any]:
    """Speaker-processing read model (readme §1.9): enabled + per-channel level
    (dBFS) / distance (cm). Served from the last-loaded form snapshot, stale-flagged
    when the daemon is unreachable — never a socket wait (fail-fast, see deps)."""
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
