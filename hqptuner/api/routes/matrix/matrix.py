"""Matrix-tab REST surface (matrix-spec): the /matrix read model, profile operations, and convolution filter uploads.

A self-contained feature surface mounted alongside ``api``.
"""

import json
from dataclasses import dataclass
from typing import Annotated, TypeGuard

import httpx
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from hqptuner.api import deps
from hqptuner.api.deps import Cfg, HttpMgr, Mgr
from hqptuner.api.errors import ControlFailedError, ErrorBody, InvalidInputError, refuse
from hqptuner.conf.httpforms import FormField, MatrixRow, ProfileSelect, SpeakersForm
from hqptuner.conf.matrixprofiles import MATRIX_PROFILES, StoredProfile
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes import matrixlane
from hqptuner.lanes.http import speakerprocessing
from hqptuner.lanes.http.speakerprocessing import SpeakerApplyResult
from hqptuner.lanes.matrixlane import MatrixProfileSwitch
from hqptuner.paths import bundled

router = APIRouter(prefix="/api")

# Resolved per request rather than at import: a frozen build's bundle root is
# only known once the process is running, and `bundled` is what knows it.
_AUTOEQ_BLOB = ("static", "vendor", "autoeq.json.gz")


class AutoEqNotBuiltError(ErrorBody):
    """The vendored AutoEq library has not been built yet."""

    code = "not_found"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("AutoEq library not built (scripts/build_autoeq_db.py)")


@router.get("/autoeq")
def autoeq_db(cfg: Cfg) -> FileResponse:
    """Vendored AutoEq parametric-EQ library (built by scripts/build_autoeq_db.py, upstream MIT).

    Pre-gzipped on disk and served with Content-Encoding so the browser's fetch decompresses transparently;
    lazy-loaded on first picker open.
    """
    blob = bundled(*_AUTOEQ_BLOB, bundle=cfg.bundle)
    if not blob.exists():
        raise refuse(AutoEqNotBuiltError())
    return FileResponse(
        blob,
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "no-cache"},
    )


@dataclass(frozen=True)
class MatrixReport:
    """``GET /api/matrix``: the /matrix form plus the live, file-saved, and per-preset profile lists."""

    fields: list[FormField]
    rows: list[MatrixRow]
    profiles: ProfileSelect | None
    active: str
    live_profiles: list[str]
    live_active: str
    file_profiles: dict[str, StoredProfile]
    preset_profiles: dict[str, list[str]]


def _is_str_map(value: object) -> TypeGuard[dict[str, str]]:
    """Return whether ``value`` is a JSON object with only string values."""
    return isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items())


def _is_rows(value: object) -> TypeGuard[list[dict[str, str]]]:
    """Return whether ``value`` is a list of string-valued row maps."""
    return isinstance(value, list) and all(_is_str_map(row) for row in value)


def _is_stored_profile(value: object) -> TypeGuard[StoredProfile]:
    """Return whether ``value`` has ``StoredProfile``'s shape: a ``rows`` list and a ``post`` map, string-valued."""
    return isinstance(value, dict) and _is_rows(value.get("rows")) and _is_str_map(value.get("post"))


def _parse_file_profiles(raw: str) -> dict[str, StoredProfile]:
    """Parse ``read_profiles``'s JSON, keeping only entries shaped like ``StoredProfile``.

    The one place this round-trips back through ``json.loads`` unnarrowed: a config file hand-edited or written by
    another tool drops the malformed entry here rather than crashing the read model.
    """
    parsed: object = json.loads(raw or "{}")
    if not isinstance(parsed, dict):
        return {}
    return {k: v for k, v in parsed.items() if isinstance(k, str) and _is_stored_profile(v)}


@router.get("/matrix")
def matrix(manager: HttpMgr) -> deps.Snapshot[MatrixReport]:
    """Return the Matrix tab's read model: the /matrix form plus the live, file-saved, and per-preset profile lists.

    Served from the last-loaded form snapshot, stale-flagged when the daemon is unreachable — never a socket wait.
    """
    form = deps.ensure_form(manager.readings.matrix_form, manager.readings.matrix_error)
    # form-derived shape (fields/rows/profiles/active) plus the live 4321 lane:
    # MatrixListProfiles names and State.matrix_profile (empty = [Default]).
    # file_profiles is the saved-profile truth: the <matrix_profile> elements of
    # the running config, which is where a persisted profile lives and the only
    # place a profile HQPTuner saved but has not applied yet can be seen. The
    # daemon's own list (live_profiles) holds what it read at startup, so the
    # picker shows the union and only a name in live_profiles can switch live.
    return deps.snapshot(
        manager,
        MatrixReport(
            fields=form["fields"],
            rows=form["rows"],
            profiles=form["profiles"],
            active=form["active"],
            live_profiles=manager.readings.matrix_profiles or [],
            live_active=(manager.readings.state or {}).get("matrix_profile", ""),
            file_profiles=_parse_file_profiles((manager.readings.file_config or {}).get(MATRIX_PROFILES) or ""),
            # each stored preset's profile names — the save/delete target pickers'
            # read model, computed from the store at request time (pure filesystem)
            preset_profiles=manager.presetops.preset_profiles(),
        ),
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


class UnknownMatrixProfileActionError(ErrorBody):
    """``POST /api/matrix/profile`` named a verb this route does not have."""

    code = "not_found"

    def __init__(self, *, action: str) -> None:
        """Render the wording naming the unrecognized ``action``."""
        super().__init__(f"unknown matrix profile action: {action}")


class MatrixSwitchRefusedError(ControlFailedError):
    """The daemon refused a live matrix profile switch; the known no-track case is translated, alone."""

    template = "Switching the matrix profile failed: {error}"

    def __init__(self, *, error: ControlError) -> None:
        """Render the no-track translation under ``daemon_refused``, else the error's own text and code."""
        if _NO_TRACK in str(error):
            ErrorBody.__init__(self, _NO_TRACK_MESSAGE)
            self.code = "daemon_refused"
        else:
            super().__init__(error=error)


class MatrixProfileBody(BaseModel):
    """Carry the verb and profile name for ``POST /api/matrix/profile``, the live matrix-profile switch."""

    action: str  # switch — the only verb this route has (4321, live)
    name: str = ""  # empty = the unnamed [Default]


@router.post("/matrix/profile")
async def matrix_profile(body: MatrixProfileBody, manager: Mgr) -> MatrixProfileSwitch:
    """Load a saved matrix profile into the running matrix (matrix-spec.md "Profiles").

    4321 ``MatrixSetProfile``, live, no engine reload, playback undisturbed, post-process untouched. Needs no
    credentials — the Control API lane is unauthenticated.

    Saving and deleting a profile are NOT here: they are staged
    ``<matrix_profile>`` config edits and ride ``/api/config/stage`` +
    ``/api/config/apply`` like every other persistent setting, because the daemon
    does not persist profiles itself. The client stages the loaded
    profile's rows alongside this call, so a load is live AND persists.
    """
    if body.action != "switch":
        raise refuse(UnknownMatrixProfileActionError(action=body.action))
    try:
        return await matrixlane.switch_profile(manager, body.name)
    except ControlError as exc:
        raise refuse(MatrixSwitchRefusedError(error=exc)) from exc


@router.get("/speakers")
def speakers(manager: HttpMgr) -> deps.Snapshot[SpeakersForm]:
    """Speaker-processing read model (readme §1.9): enabled + per-channel level (dBFS) / distance (cm).

    Served from the last-loaded form snapshot, stale-flagged when the daemon is unreachable — never a socket wait
    (fail-fast, see deps).
    """
    form = deps.ensure_form(manager.readings.speakers_form, manager.readings.speakers_error)
    return deps.snapshot(manager, form)


class SpeakersBody(BaseModel):
    """Carry the speaker-processing switch and per-channel level/distance values for ``POST /api/speakers``."""

    enabled: bool = False
    channels: dict[str, dict[str, str]] = {}  # channel index -> {level, distance}


class SpeakersApplyFailedError(ErrorBody):
    """A speaker-processing apply failed on the wire, naming the underlying error."""

    code = "daemon_write_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the apply."""
        super().__init__(f"Applying the speaker settings failed: {error}")


@router.post("/speakers")
async def speakers_apply(body: SpeakersBody, manager: HttpMgr) -> deps.WithAutosave[SpeakerApplyResult]:
    """Apply speaker processing via the /speakers form lane (readme §1.9).

    Reloads the engine (~3 s), interrupting playback — never refused for it. The write is checkbox-safe and
    range-validated in ``httpconf.apply_speakers``.
    """
    try:
        result = await speakerprocessing.apply(manager, body.channels, enabled=body.enabled)
    except ValueError as exc:
        raise refuse(InvalidInputError(error=exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise refuse(SpeakersApplyFailedError(error=exc)) from exc
    return await deps.with_autosave(result, manager)


def _limit_text(limit: int) -> str:
    """Spell the configured per-file limit as a reader would: whole MiB when it is one, bytes otherwise."""
    mib = 1024 * 1024
    return f"{limit // mib} MiB" if limit % mib == 0 else f"{limit} byte"


class FilterUploadTypeError(ErrorBody):
    """A convolution filter upload arrived as something other than an uploaded file."""

    code = "invalid_input"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("The filter must be a .wav or .txt file.")


class FilterUploadTooLargeError(ErrorBody):
    """A convolution filter upload exceeded the configured per-file byte limit."""

    code = "invalid_input"

    def __init__(self, *, limit: int) -> None:
        """Render the wording naming the configured ``limit``, spelled as a reader would."""
        super().__init__(f"The filter is larger than the {_limit_text(limit)} limit.")


@router.post("/matrix/filter")
async def matrix_filter(file: Annotated[UploadFile | str, File()], manager: Mgr) -> dict[str, str]:
    """Park an uploaded convolution filter (wav/txt) for the next apply, which injects it into the restore archive.

    Refuses an oversize, misnamed or malformed upload with 422 before anything is written; the size check runs on
    the part's byte count so an oversize body is never read into the route. A part with an empty filename reaches
    the handler as a bare string, which is refused the same way. Returns the daemon-side absolute path the pipeline
    process string should reference (matrix-spec.md "Filter upload").
    """
    if isinstance(file, str):
        raise refuse(FilterUploadTypeError())
    limit = manager.presetops.filter_max_bytes
    if file.size is not None and file.size > limit:
        raise refuse(FilterUploadTooLargeError(limit=limit))
    try:
        return manager.presetops.park_filter(file.filename or "", await file.read())
    except ValueError as exc:
        raise refuse(InvalidInputError(error=exc)) from exc
