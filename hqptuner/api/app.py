"""Read-only REST API (Phase 2.3)."""

import asyncio
import contextlib
import hashlib
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from hqptuner import __version__
from hqptuner.api import deps, livepresetapi, matrixapi, pendingapi
from hqptuner.api.deps import HttpMgr, Mgr
from hqptuner.api.models import ApplyBody, EngineBody, LiveBody, ProfileBody, VolumeBody
from hqptuner.api.pendingapi import PendingStore, _apply_succeeded, _pending
from hqptuner.audit import AuditLog
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlError
from hqptuner.engine.metering import MeteringReader, context_from
from hqptuner.lanes import livechain, livelane, livemap, liveoverrides
from hqptuner.metadata import StaticMetadata, merge_enumerations
from hqptuner.presets import presetlane
from hqptuner.presets.livepresets import LivePresetStore
from hqptuner.presets.presetstore import PresetError


class NoCacheStaticFiles(StaticFiles):
    """Serve the SPA with revalidation forced.

    Browsers cache ES modules aggressively; on a local config tool that's not worth a stale build shadowing an edit, so
    every asset carries `Cache-Control: no-cache` — the browser must revalidate (a cheap 304 via ETag/Last-Modified)
    instead of blindly reusing.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/health")
def health(manager: Mgr) -> dict[str, Any]:
    return {
        "reachable": manager.reachable,
        "unreachable_since": manager.unreachable_since,
        # When the CURRENT control connection was established. A brief drop can be
        # shorter than the frontend's health poll, so `reachable` never visibly goes
        # false and an edge on it cannot be seen; this changes on every reconnect,
        # which is what the LIVE page keys its stale-error clearing on.
        "connected_at": manager.loaded_at,
        "alarm": manager.alarm,
        "info": manager.info,
        "license": manager.license,
        # HQPTuner's own version, not the engine's: the About HQPTuner card reads
        # it from here so the package is the single source of truth.
        "app_version": __version__,
    }


@router.get("/state")
def state(manager: Mgr) -> dict[str, Any]:
    # `active_chain` is not a State attribute: it is which filter/shaper chain the
    # engine currently has loaded (livechain.active_chain — the configured mode when
    # pcm/sdm, Status.active_mode in auto, null when neither can answer). Served
    # here so the frontend knows which chain's controls are live-adjustable
    # without duplicating that State/Status fallback in JS.
    live = manager.state
    data = None if live is None else {**live, "active_chain": livechain.active_chain(manager)}
    return deps.snapshot(manager, data)


@router.get("/status")
def status(manager: Mgr) -> dict[str, Any]:
    if manager.status is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    junk = manager.metering.recommendation() if manager.metering is not None else None
    return deps.snapshot(manager, {"status": manager.status, "metadata": manager.status_metadata, "junk": junk})


@router.get("/enumerations")
def enumerations(request: Request, manager: Mgr) -> dict[str, Any]:
    if manager.enums is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    mode_name = manager.current_mode_name()
    merged = merge_enumerations(manager.enums, request.app.state.static, mode_name)
    merged["mode"] = {"index": (manager.state or {}).get("mode"), "name": mode_name}
    return deps.snapshot(manager, merged)


@router.get("/config")
def config(manager: HttpMgr) -> dict[str, Any]:
    form = deps.ensure_form(manager.config_form, manager.config_error, "/config")
    # `profiles` and `active` come from HQPTuner's own preset store — the source of
    # truth — not the daemon's (unreliable) profile subsystem, which under our
    # restore-only model always reports [default].
    #
    # `file` is the RUNNING configuration, which is the XML overlaid with whatever
    # the live lane has changed since it was written (lanes/livemap.py): a
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
            "file": {**(manager.file_config or {}), **liveoverrides.live_overrides(manager)},
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
# presetstore's own validation, which is where that check belongs.
@router.get("/preset/{name:path}")
async def preset(name: str, manager: HttpMgr) -> dict[str, Any]:
    """Read a preset's saved settings from its snapshot without loading it.

    The editor previews these when the user picks a preset, before any apply. The empty name is "(no preset)" and
    previews the running config.
    """
    try:
        return {"name": name, "config": await manager.read_preset(name)}
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
async def backup(manager: HttpMgr) -> Response:
    try:
        data = await manager.presetops.backup()
    except ControlError as exc:
        raise HTTPException(status_code=502, detail=f"backup failed: {exc}") from exc
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="hqplayer-settings.zip"'},
    )


@router.get("/metadata")
def metadata(request: Request) -> dict[str, Any]:
    static: StaticMetadata = request.app.state.static
    return static.raw


@router.get("/log")
async def log_tail(manager: Mgr, lines: int = 50) -> dict[str, Any]:
    """Return a static tail of the daemon's log file (System-tab live view).

    Read-only, no daemon socket — reads the file the running config points at.
    """
    n = max(1, min(lines, 500))
    return await manager.read_log_tail(n)


@router.get("/volume")
def volume_get(manager: Mgr) -> dict[str, Any]:
    """Live volume + its live bounds/enabled (VolumeRange).

    Separate from the staged-config surface — this is the runtime playback-volume lane.
    """
    vr = manager.volume_range or {}
    return {
        "volume": (manager.state or {}).get("volume"),
        "min": vr.get("min"),
        "max": vr.get("max"),
        "enabled": vr.get("enabled"),
        "adaptive": vr.get("adaptive"),
    }


@router.post("/volume")
async def volume_set(body: VolumeBody, manager: Mgr) -> dict[str, Any]:
    """Immediate live-volume write — never staged, never restarts.

    503 when volume control is disabled (the slider grays on that state, so this is the race backstop).
    """
    try:
        return await manager.applyops.set_volume(body.level)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# /api/matrix* routes live in matrixapi (mounted in create_app)


async def _save_after_apply(manager: ConnectionManager, name: str) -> dict[str, Any]:
    """Persist a clean, successful apply into the named preset (store + daemon mirror).

    Only called when the apply itself succeeded, so the running config already carries the edits. ``save_preset``
    reports its own failure.
    """
    return await manager.presetops.save_preset(name)


async def _persist_after_apply(manager: ConnectionManager, save: str | None, report: dict[str, Any]) -> None:
    """Fold a clean apply into a preset.

    The target is the named preset the request asked for, or whatever auto-save is armed for when it asked for none.
    """
    if save is not None:
        report["saved"] = await _save_after_apply(manager, save)
        return
    autosaved = await presetlane.autosave(manager)
    if autosaved is not None:
        report["autosaved"] = autosaved


@router.post("/config/apply")
async def apply(request: Request, manager: Mgr, body: ApplyBody | None = None) -> dict[str, Any]:
    store = _pending(request)
    switch_to = body.switch_to if body else None
    if not store.live and not store.http and switch_to is None:
        raise HTTPException(status_code=400, detail="nothing staged")
    # the staged set as it stands NOW — a clean apply clears the buffer below, so
    # nothing captured after this point can say what was applied
    staged_http, staged_live = dict(store.http), dict(store.live)
    save = body.save.name if body is not None and body.save is not None else None
    try:
        report = await manager.applyops.apply(store.live, store.http, switch_to)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    ok = _apply_succeeded(report)
    manager.audit.apply(staged_http, staged_live, switch_to, save, ok=ok)
    if not ok:
        return report  # soft failure — keep staging so the user can retry
    await _persist_after_apply(manager, save, report)
    store.clear()
    return report


@router.post("/config/live")
async def config_live(body: LiveBody, manager: Mgr) -> dict[str, Any]:
    """Apply live-lane config-form fields immediately, readback-verified.

    This is the LIVE view's whole write path. Never staged and never persistent, so it cannot restart the daemon and
    cannot flush what the tabs view has staged.

    Routed through the lane rather than a manager method because the LIVE lane's
    only caller is this route, and `/state` above already reads `livemap`
    directly for the same reason.
    """
    if not body.fields:
        raise HTTPException(status_code=422, detail="no live fields given")
    unknown = sorted(set(body.fields) - set(livemap.live_fields()))
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown live fields: {unknown}")
    try:
        report = await livelane.apply_now(manager, body.fields)
        autosaved = await presetlane.autosave(manager)
        if autosaved is not None:
            report["autosaved"] = autosaved
        return report
    except livemap.LiveRouteError as exc:
        # 409, not 422: every field is a real live control and its value was a
        # real option — the engine's current chain or lists are what refuse it,
        # so the reasons are per field and the batch applied nothing.
        raise HTTPException(status_code=409, detail=exc.reasons) from exc
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/engine")
async def engine_get(manager: HttpMgr) -> dict[str, Any]:
    try:
        return {"engine": await manager.read_engine(), "active_config": manager.active_config}
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"read engine failed: {exc}") from exc


@router.post("/engine")
async def engine_apply(body: EngineBody, manager: HttpMgr) -> dict[str, Any]:
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
async def restore(cfgfile: Annotated[UploadFile, File()], manager: HttpMgr) -> dict[str, Any]:
    data = await cfgfile.read()
    manager.audit.restore_upload(cfgfile.filename or "", len(data), hashlib.sha256(data).hexdigest())
    try:
        await manager.restore_config(data)
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"restore failed: {exc}") from exc
    return {"restored": True, "bytes": len(data)}


@router.post("/profile/{action}")
async def profile(action: str, body: ProfileBody, manager: Mgr) -> dict[str, Any]:
    methods = {
        "load": manager.presetops.load_preset,
        "save": manager.presetops.save_preset,
        "delete": manager.presetops.delete_preset,
    }
    if action not in methods:
        raise HTTPException(status_code=404, detail=f"unknown profile action: {action}")
    if not body.name:
        raise HTTPException(status_code=422, detail="profile name required")
    try:
        return await methods[action](body.name)
    except PresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/preset/{name}")
async def delete_preset(name: str, manager: HttpMgr) -> dict[str, Any]:
    """Delete a preset from the store and remove its daemon mirror.

    Backs the Delete button on the preset picker.
    """
    try:
        return await manager.presetops.delete_preset(name)
    except PresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"delete preset failed: {exc}") from exc


SHUTDOWN_GRACE = 2.0  # seconds the poll loop gets to notice its stop flag


async def _finish(task: asyncio.Task[None], grace: float) -> None:
    """Give a background task ``grace`` seconds to exit on its own stop flag, then cancel it.

    Shutdown must not wait on a daemon that has stopped answering: the poll loop's 8088 lane retries per request, so a
    wedged web server otherwise costs a full multiple of the request timeout.
    """
    with contextlib.suppress(asyncio.CancelledError, TimeoutError):
        await asyncio.wait_for(task, grace)


def _audit_router(audit: AuditLog) -> APIRouter:
    """Build the event log's read route, which exists only when the log is on.

    An install without ``HQPTUNER_DEBUG_LOG`` has no such endpoint rather than an endpoint that answers empty. Nothing
    in the UI links here; it is an operator's surface, and the file it reads is equally available to ``jq``.
    """
    audit_api = APIRouter(prefix="/api")

    @audit_api.get("/audit")
    def records(limit: int = 200) -> dict[str, Any]:
        return {"records": audit.tail(limit)}

    return audit_api


def create_app(cfg: Config | None = None) -> FastAPI:
    cfg = cfg or Config()
    static = StaticMetadata(cfg.data_dir)
    http_client = None
    if cfg.hqp_username and cfg.hqp_password:
        http_client = HttpConfigClient(cfg.hqp_host, cfg.hqp_http_port, cfg.hqp_username, cfg.hqp_password)
    else:
        log.warning("no HQPTUNER_HQP_USERNAME/PASSWORD — /api/config unavailable")
    manager = ConnectionManager(cfg, http_client)

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(manager.run())
        # junk-filter advisor's metering reader — best-effort alongside the poll
        # loop; an absent 4322 stream just means "no recommendation"
        reader = MeteringReader(cfg.hqp_host, cfg.hqp_metering_port, lambda: context_from(manager))
        manager.metering = reader
        metering_task = asyncio.create_task(reader.run())
        yield
        manager.stop()
        reader.stop()
        await _finish(task, SHUTDOWN_GRACE)
        # no grace for the reader: it blocks in readexactly, which its stop flag
        # cannot interrupt, so waiting on it always costs the full grace
        await _finish(metering_task, 0)
        await manager.aclose()
        if http_client is not None:
            await http_client.aclose()

    app = FastAPI(title="HQPTuner", lifespan=lifespan)
    app.state.manager = manager
    app.state.static = static
    app.state.http_client = http_client
    app.state.pending = PendingStore()
    app.state.audit = manager.audit
    if manager.audit.enabled:
        app.include_router(_audit_router(manager.audit))
    app.state.live_presets = LivePresetStore(cfg.live_preset_file)
    app.include_router(router)
    app.include_router(pendingapi.router)
    app.include_router(matrixapi.router)
    app.include_router(livepresetapi.router)
    # Serve the SPA. Mounted last and at "/", so the /api routes above win; the
    # SPA's static assets and index.html fall through to here.
    static_dir = Path(__file__).resolve().parent.parent / "static"
    if static_dir.is_dir():
        app.mount("/", NoCacheStaticFiles(directory=static_dir, html=True), name="spa")
    return app
