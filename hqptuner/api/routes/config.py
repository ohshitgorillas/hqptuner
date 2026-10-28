"""Configuration surface — /config form, preset previews, device refresh, backup, state archive, engine, restore.

Every route but the state export and import needs the daemon's 8088 management lane, so takes ``HttpMgr``; those two
touch only HQPTuner's own files and log, so take ``Cfg`` and answer without credentials.
"""

import hashlib
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import APIRouter, File, Request, Response, UploadFile

from hqptuner import logbuffer
from hqptuner.api import deps
from hqptuner.api.deps import Cfg, HttpMgr, Mgr
from hqptuner.api.errors import ControlFailedError, ErrorBody, InvalidInputError, refuse
from hqptuner.api.models import EngineBody
from hqptuner.conf.engineconf import UnreadableArchiveError
from hqptuner.conf.httpforms import FormField
from hqptuner.core import engineread
from hqptuner.core.applyops import EngineApplyResult
from hqptuner.engine.controlerrors import ControlError
from hqptuner.engine.devicecaps import DeviceCaps
from hqptuner.presets import archive, fileconfig, presetlane, presetops
from hqptuner.presets.presetlane import PresetOption
from hqptuner.presets.store import stateimport
from hqptuner.presets.store.export import state_archive

router = APIRouter(prefix="/api")


@dataclass(frozen=True)
class PresetChoice:
    """The preset picker as the form renders it: the selected preset and every option, "(no preset)" first."""

    value: str
    options: list[PresetOption]


@dataclass(frozen=True)
class ConfigView:
    """``GET /api/config`` data: the /config form's fields beside HQPTuner's presets."""

    fields: list[FormField]
    profiles: PresetChoice
    active: str
    # What the selected output device announced it can carry, or null when
    # nothing is known about it. The rate menus gray against this; null grays
    # nothing.
    device_caps: DeviceCaps | None


@dataclass(frozen=True)
class EngineReading:
    """``GET /api/engine``: the hardware-acceleration attributes, and the active preset snapshot they were read from."""

    engine: dict[str, str]
    active_config: str | None


@dataclass(frozen=True)
class PresetPreview:
    """``GET /api/preset/{name}``: a preset's saved settings in form-field terms, under the name that was asked for."""

    name: str
    config: dict[str, str]


@dataclass(frozen=True)
class RestoreAnswer:
    """``POST /api/restore``: how many bytes of the upload reached the daemon."""

    bytes: int


class ReadPresetFailedError(ErrorBody):
    """A preset preview's read failed on the wire, naming the underlying error."""

    code = "daemon_read_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the read."""
        super().__init__(f"Reading the preset failed: {error}")


class DeviceRefreshFailedError(ErrorBody):
    """A device rescan failed on the wire, naming the underlying error."""

    code = "daemon_read_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the refresh."""
        super().__init__(f"Refreshing the device list failed: {error}")


class BackupReadFailedError(ErrorBody):
    """A settings-archive backup failed on the wire, naming the underlying error."""

    code = "daemon_write_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the backup."""
        super().__init__(f"Reading HQPlayer's settings backup failed: {error}")


class ReadEngineFailedError(ErrorBody):
    """A hardware-acceleration attribute read failed on the wire, naming the underlying error."""

    code = "daemon_read_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the read."""
        super().__init__(f"Reading the engine settings failed: {error}")


class NoEngineOverridesError(ErrorBody):
    """An engine-attribute apply named no overrides at all."""

    code = "nothing_staged"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("no engine overrides given")


# The sentence an engine-attribute apply that failed answers with, whichever error stopped it.
_ENGINE_APPLY_FAILED = "Applying the engine settings failed: {error}"


class EngineApplyFailedError(ErrorBody):
    """An engine-attribute apply failed on the wire, naming the underlying error."""

    code = "daemon_write_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the apply."""
        super().__init__(_ENGINE_APPLY_FAILED.format(error=error))


class EngineControlFailedError(ControlFailedError):
    """A Control API error that stopped an engine-attribute apply, under the error's own code."""

    template = _ENGINE_APPLY_FAILED


class ArchiveUnreadableError(ErrorBody):
    """A restore upload's own descriptions member would not parse, whose own message is the whole refusal."""

    code = "archive_unreadable"

    def __init__(self, *, error: Exception) -> None:
        """Render ``error``'s own message, naming no further fact."""
        super().__init__(str(error))


class RestoreFailedError(ErrorBody):
    """A restore upload failed on the wire, naming the underlying error."""

    code = "daemon_write_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the restore."""
        super().__init__(f"Restoring the settings failed: {error}")


@router.get("/config")
def config(manager: HttpMgr) -> deps.Snapshot[ConfigView]:
    """Return the /config form joined with HQPTuner's preset list and the output device's caps.

    Needs credentials — without them the 8088 lane does not exist and the route 503s.
    """
    form = deps.ensure_form(manager.readings.config_form, manager.readings.config_error)
    # `profiles` and `active` come from HQPTuner's own preset store — the source of
    # truth — not the daemon's (unreliable) profile subsystem, which under our
    # restore-only model always reports [default].
    presets = presetlane.listing(manager)
    view = ConfigView(
        fields=form["fields"],
        profiles=PresetChoice(value=presets.value, options=presets.options),
        active=presets.active,
        device_caps=manager.readings.device_caps,
    )
    return deps.snapshot(view)


# `:path` rather than the default convertor, which is `[^/]+` and so cannot match
# an EMPTY segment: the picker's "(no preset)" option carries the empty name and
# must reach this route. A name with a slash in it still 404s, from
# store.presets' own validation, which is where that check belongs.
@router.get("/preset/{name:path}")
async def preset(name: str, manager: HttpMgr) -> PresetPreview:
    """Read a preset's saved settings from its snapshot without loading it.

    The editor previews these when the user picks a preset, before any apply. The empty name is "(no preset)" and
    previews the running config.
    """
    try:
        return PresetPreview(name, await presetlane.read(manager, name))
    except (ControlError, httpx.HTTPError) as exc:
        raise refuse(ReadPresetFailedError(error=exc)) from exc


@router.post("/config/refresh")
async def config_refresh(manager: HttpMgr) -> None:
    """Re-scan output devices on the daemon and refetch the config forms.

    A device that was absent (a powered-off NAA endpoint) appears in the dropdown afterwards.
    """
    try:
        await engineread.refresh_devices(manager)
    except (ControlError, httpx.HTTPError) as exc:
        raise refuse(DeviceRefreshFailedError(error=exc)) from exc


@router.get("/backup")
async def backup(manager: HttpMgr, request: Request) -> Response:
    """Return the daemon's settings archive as a zip download, carrying HQPTuner's profile descriptions.

    The descriptions ride as one extra member (``presetzip.DESCRIPTIONS_MEMBER``) so the download is the whole of
    what the user has here, not the daemon's half of it; every daemon member is copied byte-for-byte, so the archive
    still restores anywhere. A store with nothing in it adds no member.
    """
    store = deps.descriptions_of(request)
    try:
        data = await archive.backup(manager, store)
    except (ControlError, httpx.HTTPError) as exc:
        raise refuse(BackupReadFailedError(error=exc)) from exc
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="hqplayer-settings.zip"'},
    )


@router.get("/state-export")
def state_export(cfg: Cfg) -> Response:
    """Return HQPTuner's own stores, the debug log and the recent log lines as a zip download.

    A plain ``def``, so the disk reads run on the threadpool rather than the event loop.
    """
    return Response(
        content=state_archive(cfg, logbuffer.RECENT.lines()),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="hqptuner-state.zip"'},
    )


@dataclass(frozen=True)
class StateImportAnswer:
    """``POST /api/state-import``: the stores the import replaced, by their names in the archive."""

    replaced: list[str]


@router.post("/state-import")
def state_import(statefile: Annotated[UploadFile, File()], manager: Mgr, cfg: Cfg) -> StateImportAnswer:
    """Replace each store a state archive carries, recording the upload's name, size, and SHA-256 first.

    The whole archive is checked before anything is written; a refusal (``state_unreadable``, ``state_too_new``)
    changes nothing. The install's stores are saved to ``backups/pre-import-state.zip`` first, and a backup that
    cannot be written (``backup_failed``) changes nothing either; then the active preset pointer is cleared. The work
    is on disk only. A plain ``def``, so it runs on the threadpool.
    """
    upload = stateimport.read_upload(statefile.file, cfg.state_max_bytes)
    manager.audit.state_upload(statefile.filename or "", upload.size, upload.digest)
    try:
        carried = stateimport.check(upload, cfg.state_max_bytes)
        replaced = manager.presetops.import_state(carried)
    except (stateimport.StateImportError, presetops.BackupFailedError) as exc:
        raise refuse(exc) from exc
    return StateImportAnswer(replaced=replaced)


@router.get("/engine")
async def engine_get(manager: HttpMgr) -> EngineReading:
    """Return the hardware-acceleration attributes, read out of a fresh backup, and the active preset snapshot's name.

    They are on no form, so this costs a backup fetch, read on demand.
    """
    try:
        engine = await fileconfig.read_engine(manager)
    except UnreadableArchiveError as exc:
        raise refuse(ArchiveUnreadableError(error=exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise refuse(ReadEngineFailedError(error=exc)) from exc
    return EngineReading(engine, manager.readings.active_config)


@router.post("/engine")
async def engine_apply(body: EngineBody, manager: HttpMgr) -> deps.Reported[EngineApplyResult]:
    """Write hardware-acceleration attributes by editing the backup archive and restoring it.

    400 with no overrides, 422 when one is not a valid engine attribute, 502 when the daemon fails the write. The
    restore restarts the daemon and interrupts playback, which is the user's call.
    """
    if not body.overrides:
        raise refuse(NoEngineOverridesError())
    try:
        result = await manager.applyops.apply_engine(body.overrides, all_presets=body.all_presets)
    except ValueError as exc:
        raise refuse(InvalidInputError(error=exc)) from exc
    except ControlError as exc:
        raise refuse(EngineControlFailedError(error=exc)) from exc
    except httpx.HTTPError as exc:
        raise refuse(EngineApplyFailedError(error=exc)) from exc
    return deps.Reported(result)


@router.post("/restore")
async def restore(cfgfile: Annotated[UploadFile, File()], manager: HttpMgr, request: Request) -> RestoreAnswer:
    """Push a user-uploaded settings archive to the daemon, recording its name, size, and SHA-256 first.

    The daemon self-restarts on it, interrupting playback. The only member removed first is HQPTuner's descriptions
    member: it is folded into this install's store. Everything else, including a bare
    XML upload, reaches the daemon exactly as the user sent it.
    """
    data = await cfgfile.read()
    manager.audit.restore_upload(cfgfile.filename or "", len(data), hashlib.sha256(data).hexdigest())
    store = deps.descriptions_of(request)
    try:
        pushed = await archive.restore(manager, store, data)
    except UnreadableArchiveError as exc:
        raise refuse(ArchiveUnreadableError(error=exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise refuse(RestoreFailedError(error=exc)) from exc
    return RestoreAnswer(bytes=pushed)
