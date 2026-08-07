"""Matrix-tab REST surface (matrix-spec): the /matrix read model, profile operations, and convolution filter uploads.

Split out of ``api`` by the file-length gate — a self-contained feature surface mounted alongside it.
"""

import json
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from hqptuner.api import deps
from hqptuner.api.deps import HttpMgr, Mgr
from hqptuner.conf.matrixconf import MATRIX_PROFILES
from hqptuner.engine.control import ControlError
from hqptuner.presets import presetlane

router = APIRouter(prefix="/api")

_AUTOEQ_BLOB = Path(__file__).resolve().parent.parent / "static" / "vendor" / "autoeq.json.gz"


@router.get("/autoeq")
def autoeq_db() -> FileResponse:
    """Vendored AutoEq parametric-EQ library (built by scripts/build_autoeq_db.py, upstream MIT).

    Pre-gzipped on disk and served with Content-Encoding so the browser's fetch decompresses transparently;
    lazy-loaded on first picker open.
    """
    if not _AUTOEQ_BLOB.exists():
        raise HTTPException(status_code=404, detail="AutoEq library not built (scripts/build_autoeq_db.py)")
    return FileResponse(
        _AUTOEQ_BLOB,
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "no-cache"},
    )


@router.get("/matrix")
def matrix(manager: HttpMgr) -> dict[str, Any]:
    """Return the Matrix tab's read model: the /matrix form plus the live, file-saved, and per-preset profile lists.

    Served from the last-loaded form snapshot, stale-flagged when the daemon is unreachable — never a socket wait.
    """
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
            # each stored preset's profile names — the save/delete target pickers'
            # read model, computed from the store at request time (pure filesystem)
            "preset_profiles": manager.presetops.preset_profiles(),
        },
    )


# The daemon refuses a live profile switch with nothing loaded to play, and says
# so in C++ internals: `clHQPlayerEngine::MatrixSetProfile():
# clPlaylist::GetTrackFile(): trackn > last` — the playlist has no track at the
# index it went looking for. Observed on 6.0.4, documented nowhere. That text
# tells a listener nothing, so this one refusal is translated and every other
# error keeps the daemon's own words: a catch-all would hide the errors whose
# text is the only clue there is.
_NO_TRACK = "GetTrackFile"
_NO_TRACK_MESSAGE = "Live playback is needed to load a matrix profile."


def _switch_refusal(text: str) -> str:
    return _NO_TRACK_MESSAGE if _NO_TRACK in text else text


class MatrixProfileBody(BaseModel):
    """Carry the verb and profile name for ``POST /api/matrix/profile``, the live matrix-profile switch."""

    action: str  # switch — the only verb this route has (4321, live)
    name: str = ""  # empty = the unnamed [Default]


@router.post("/matrix/profile")
async def matrix_profile(body: MatrixProfileBody, manager: Mgr) -> dict[str, Any]:
    """Load a saved matrix profile into the running matrix (matrix-spec.md "Profiles", amended round 5).

    4321 ``MatrixSetProfile``, live, no engine reload, playback undisturbed, post-process untouched. Needs no
    credentials — the Control API lane is unauthenticated.

    Saving and deleting a profile are NOT here: they are staged
    ``<matrix_profile>`` config edits and ride ``/api/config/stage`` +
    ``/api/config/apply`` like every other persistent setting, because the daemon
    does not persist profiles itself (round 5). The client stages the loaded
    profile's rows alongside this call, so a load is live AND persists.
    """
    if body.action != "switch":
        raise HTTPException(status_code=404, detail=f"unknown matrix profile action: {body.action}")
    try:
        return await manager.applyops.matrix_switch_profile(body.name)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=_switch_refusal(str(exc))) from exc


@router.get("/speakers")
def speakers(manager: HttpMgr) -> dict[str, Any]:
    """Speaker-processing read model (readme §1.9): enabled + per-channel level (dBFS) / distance (cm).

    Served from the last-loaded form snapshot, stale-flagged when the daemon is unreachable — never a socket wait
    (fail-fast, see deps).
    """
    form = deps.ensure_form(manager.speakers_form, manager.speakers_error, "/speakers")
    return deps.snapshot(manager, form)


class SpeakersBody(BaseModel):
    """Carry the speaker-processing switch and per-channel level/distance values for ``POST /api/speakers``."""

    enabled: bool = False
    channels: dict[str, dict[str, str]] = {}  # channel index -> {level, distance}


@router.post("/speakers")
async def speakers_apply(body: SpeakersBody, manager: HttpMgr) -> dict[str, Any]:
    """Apply speaker processing via the /speakers form lane (readme §1.9).

    Reloads the engine (~3 s), interrupting playback — never refused for it. The write is checkbox-safe and
    range-validated in ``httpconf.apply_speakers``.
    """
    try:
        report = await manager.applyops.apply_speakers(body.channels, enabled=body.enabled)
        autosaved = await presetlane.autosave(manager)
        if autosaved is not None:
            report["autosaved"] = autosaved
        return report
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"speakers apply failed: {exc}") from exc


@router.post("/matrix/filter")
async def matrix_filter(file: Annotated[UploadFile, File()], manager: Mgr) -> dict[str, str]:
    """Park an uploaded convolution filter (wav/txt) for the next apply, which injects it into the restore archive.

    Returns the daemon-side absolute path the pipeline process string should reference (matrix-spec.md
    "Filter upload").
    """
    try:
        return manager.presetops.park_filter(file.filename or "", await file.read())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
