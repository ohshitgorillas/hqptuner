"""Configuration surface — the /config form, preset previews, device refresh, backup, engine attributes, and restore.

These are the routes that need the daemon's 8088 management lane, so every one of them takes ``HttpMgr``.
"""

import hashlib
import logging
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile

from hqptuner.api import deps
from hqptuner.api.deps import HttpMgr
from hqptuner.api.models import EngineBody
from hqptuner.conf import presetzip
from hqptuner.engine.control import ControlError
from hqptuner.lanes.live import overrides
from hqptuner.presets import presetlane
from hqptuner.presets.store.descriptions import DescriptionError, DescriptionStore
from hqptuner.presets.store.presets import PresetError

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/config")
def config(manager: HttpMgr) -> dict[str, Any]:
    """Return the /config form joined with HQPTuner's preset list, the running config, and the output device's caps.

    Needs credentials — without them the 8088 lane does not exist and the route 503s.
    """
    form = deps.ensure_form(manager.config_form, manager.config_error, "/config")
    # `profiles` and `active` come from HQPTuner's own preset store — the source of
    # truth — not the daemon's (unreliable) profile subsystem, which under our
    # restore-only model always reports [default].
    #
    # `file` is the RUNNING configuration, which is the XML overlaid with whatever
    # the live lane has changed since it was written (lanes/live/routing.py): a
    # live-routed filter/dither/mode edit never touches the file, so the file alone
    # would report a setting the engine stopped using. The frontend grounds the
    # affected controls here, so a dropdown shows what is actually playing and
    # selecting the previous value still reads as a change.
    presets = manager.presetops.presets()
    return deps.snapshot(
        manager,
        {
            **form,
            "profiles": {"value": presets["value"], "options": presets["options"]},
            "active": presets["active"],
            "autosave": presets["autosave"],
            "file": {**(manager.file_config or {}), **overrides.live_overrides(manager)},
            # What the selected output device announced it can carry, or null when
            # nothing is known about it (core/manager.refresh_device_caps). The rate
            # menus gray against this; null grays nothing.
            "device_caps": manager.device_caps,
        },
    )


# `:path` rather than the default convertor, which is `[^/]+` and so cannot match
# an EMPTY segment. The picker's "(no preset)" option carries the empty name, and
# `GET /api/preset/` was falling past this route into the SPA mount and coming
# back as a bare 404 — the read lane has always handled the empty name, it was
# just unreachable over HTTP. A name with a slash in it still 404s, from
# store.presets' own validation, which is where that check belongs.
@router.get("/preset/{name:path}")
async def preset(name: str, manager: HttpMgr) -> dict[str, Any]:
    """Read a preset's saved settings from its snapshot without loading it.

    The editor previews these when the user picks a preset, before any apply. The empty name is "(no preset)" and
    previews the running config.
    """
    try:
        return {"name": name, "config": await presetlane.read(manager, name)}
    except PresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"read preset failed: {exc}") from exc


@router.post("/config/refresh")
async def config_refresh(manager: HttpMgr) -> dict[str, Any]:
    """Re-scan output devices on the daemon and refetch the config forms.

    A device that was absent (a powered-off NAA endpoint) appears in the dropdown afterwards.
    """
    try:
        return await manager.refresh_devices()
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"device refresh failed: {exc}") from exc


@router.get("/backup")
async def backup(manager: HttpMgr, request: Request) -> Response:
    """Return the daemon's settings archive as a zip download, carrying HQPTuner's profile descriptions.

    The descriptions ride as one extra member (``presetzip.DESCRIPTIONS_MEMBER``) so the download is the whole of
    what the user has here, not the daemon's half of it; every daemon member is copied byte-for-byte, so the archive
    still restores anywhere. A store with nothing in it adds no member.
    """
    try:
        data = await manager.presetops.backup()
    except ControlError as exc:
        raise HTTPException(status_code=502, detail=f"backup failed: {exc}") from exc
    store: DescriptionStore = request.app.state.descriptions
    try:
        data = presetzip.embed_descriptions(data, store.export_bytes())
    except DescriptionError as exc:
        # An unreadable store is not a reason to withhold the daemon's own backup.
        log.warning("descriptions not carried in backup: %s", exc)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="hqplayer-settings.zip"'},
    )


@router.get("/engine")
async def engine_get(manager: HttpMgr) -> dict[str, Any]:
    """Return the hardware-acceleration attributes, read out of a fresh backup, and the active preset snapshot's name.

    They are not on any form, so this costs a backup fetch — read on demand, never per poll.
    """
    try:
        return {"engine": await manager.read_engine(), "active_config": manager.active_config}
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"read engine failed: {exc}") from exc


@router.post("/engine")
async def engine_apply(body: EngineBody, manager: HttpMgr) -> dict[str, Any]:
    """Write hardware-acceleration attributes by editing the backup archive and restoring it, then auto-save.

    400 with no overrides, 422 when one is not a valid engine attribute. The restore restarts the daemon and
    interrupts playback — the user's call, never refused for it.
    """
    if not body.overrides:
        raise HTTPException(status_code=400, detail="no engine overrides given")
    try:
        report = await manager.applyops.apply_engine(body.overrides, all_presets=body.all_presets)
        autosaved = await presetlane.autosave(manager)
        if autosaved is not None:
            report["autosaved"] = autosaved
        return report
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/restore")
async def restore(cfgfile: Annotated[UploadFile, File()], manager: HttpMgr, request: Request) -> dict[str, Any]:
    """Push a user-uploaded settings archive to the daemon, recording its name, size, and SHA-256 first.

    The daemon self-restarts on it, interrupting playback. The one thing taken out of the archive first is
    HQPTuner's own descriptions member, which ``GET /api/backup`` put there: it is folded into this install's store
    and never handed to hqplayerd, which did not write it and has no idea what it is. Everything else — including a
    bare XML upload, which is not an archive at all — reaches the daemon exactly as the user sent it.
    """
    data = await cfgfile.read()
    manager.audit.restore_upload(cfgfile.filename or "", len(data), hashlib.sha256(data).hexdigest())
    data, carried = presetzip.take_descriptions(data)
    if carried is not None:
        store: DescriptionStore = request.app.state.descriptions
        try:
            store.merge(carried)
        except DescriptionError as exc:
            # A restore is about the daemon's config; descriptions we cannot read are a note in the log, not a 4xx
            # in front of the user's restore.
            log.warning("carried descriptions not restored: %s", exc)
    try:
        await manager.restore_config(data)
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"restore failed: {exc}") from exc
    return {"restored": True, "bytes": len(data)}
