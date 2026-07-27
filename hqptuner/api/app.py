"""Read-only REST API (Phase 2.3)."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.types import Scope

from .. import __version__
from ..conf.httpconf import HttpConfigClient
from ..config import Config
from ..control import ControlError
from ..lanes import livemap
from ..manager import ConnectionManager
from ..metadata import StaticMetadata, merge_enumerations
from ..presetstore import PresetError
from ..writer import known_live_settings
from . import deps, matrixapi
from .deps import HttpMgr, Mgr


class NoCacheStaticFiles(StaticFiles):
    """Serve the SPA with revalidation forced. Browsers cache ES modules
    aggressively; on a local config tool that's not worth a stale build shadowing
    an edit, so every asset carries `Cache-Control: no-cache` — the browser must
    revalidate (a cheap 304 via ETag/Last-Modified) instead of blindly reusing."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


class StageBody(BaseModel):
    live: dict[str, dict[str, str]] = {}
    http: dict[str, str] = {}


class SaveTarget(BaseModel):
    name: str


class ApplyBody(BaseModel):
    # optional: after a successful apply, persist the (now clean) working config
    # into this preset snapshot — the active one (Apply & Save) or a new name
    # (Save as New). Absent = ephemeral apply (working config only).
    save: SaveTarget | None = None
    # optional: the user previewed this preset in the editor; apply loads it first
    # so it becomes active, then applies the staged tweaks on top of its snapshot.
    switch_to: str | None = None


class ProfileBody(BaseModel):
    name: str = ""


class VolumeBody(BaseModel):
    level: str


class EngineBody(BaseModel):
    overrides: dict[str, str] = {}
    all_presets: bool = False


class PendingStore:
    """Server-side staged-changes buffer. Survives browser reloads because it
    lives on the backend, not the client."""

    def __init__(self) -> None:
        self.live: dict[str, dict[str, str]] = {}
        self.http: dict[str, str] = {}

    def stage(self, live: dict[str, dict[str, str]], http: dict[str, str]) -> None:
        self.live.update(live)
        self.http.update(http)

    def clear(self) -> None:
        self.live = {}
        self.http = {}

    def snapshot(self) -> dict[str, Any]:
        return {"live": self.live, "http": self.http}


@router.get("/health")
def health(manager: Mgr) -> dict[str, Any]:
    return {
        "reachable": manager.reachable,
        "unreachable_since": manager.unreachable_since,
        "alarm": manager.alarm,
        "info": manager.info,
        "license": manager.license,
        # HQPTuner's own version, not the engine's: the About HQPTuner card reads
        # it from here so the package is the single source of truth.
        "app_version": __version__,
    }


@router.get("/state")
def state(manager: Mgr) -> dict[str, Any]:
    return deps.snapshot(manager, manager.state)


@router.get("/status")
def status(manager: Mgr) -> dict[str, Any]:
    if manager.status is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    return deps.snapshot(manager, {"status": manager.status, "metadata": manager.status_metadata})


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
    presets = manager.presets()
    return deps.snapshot(
        manager,
        {
            **form,
            "profiles": {"value": presets["value"], "options": presets["options"]},
            "active": presets["active"],
            "file": {**(manager.file_config or {}), **livemap.live_overrides(manager)},
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
    """A preset's saved settings, read from its snapshot without loading it — the
    editor previews these when the user picks a preset, before any apply. The
    empty name is "(no preset)" and previews the running config."""
    try:
        return {"name": name, "config": await manager.read_preset(name)}
    except PresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"read preset failed: {exc}") from exc


@router.post("/config/refresh")
async def config_refresh(manager: HttpMgr) -> dict[str, Any]:
    """Re-scan output devices on the daemon and refetch the config forms, so a
    device that was absent (a powered-off NAA endpoint) appears in the dropdown."""
    try:
        return await manager.refresh_devices()
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"device refresh failed: {exc}") from exc


@router.get("/backup")
async def backup(manager: HttpMgr) -> Response:
    try:
        data = await manager.backup()
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
    """Static tail of the daemon's log file (System-tab live view). Read-only,
    no daemon socket — reads the file the running config points at."""
    n = max(1, min(lines, 500))
    return await manager.read_log_tail(n)


@router.get("/volume")
def volume_get(manager: Mgr) -> dict[str, Any]:
    """Live volume + its live bounds/enabled (VolumeRange). Separate from the
    staged-config surface — this is the runtime playback-volume lane."""
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
    """Immediate live-volume write — never staged, never restarts. 503 when
    volume control is disabled (the slider grays on that state, so this is the
    race backstop)."""
    try:
        return await manager.set_volume(body.level)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _pending(request: Request) -> PendingStore:
    store: PendingStore = request.app.state.pending
    return store


def _apply_succeeded(report: dict[str, Any]) -> bool:
    """Whether every staged change actually took. A live edit counts only if its
    readback verified (`ok`); the persistent lane only if the running config
    reflected the change after the restart (`applied`). A soft failure — a value
    never converged, or a preset's endpoint is gone — returns False here so the
    caller keeps the pending buffer instead of silently dropping the edits."""
    if any(not entry.get("ok") for entry in report.get("live", [])):
        return False
    switched = report.get("switched")
    if switched is not None and not switched.get("active"):
        return False  # the preset switch never took — don't clear the preview
    persistent = report.get("persistent")
    return not (persistent is not None and not persistent.get("applied"))


@router.post("/config/stage")
def stage(body: StageBody, request: Request) -> dict[str, Any]:
    unknown = set(body.live) - set(known_live_settings())
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown live settings: {sorted(unknown)}")
    store = _pending(request)
    store.stage(body.live, body.http)
    return store.snapshot()


@router.get("/config/pending")
def pending(request: Request) -> dict[str, Any]:
    return _pending(request).snapshot()


@router.delete("/config/pending")
def discard(request: Request, manager: Mgr) -> dict[str, Any]:
    store = _pending(request)
    store.clear()
    # parked filter uploads belong to the staged process strings just discarded
    manager.clear_parked_filters()
    return store.snapshot()


# /api/matrix* routes live in matrixapi (mounted in create_app)


async def _save_after_apply(manager: ConnectionManager, name: str) -> dict[str, Any]:
    """Persist a clean, successful apply into the named preset (store + daemon
    mirror). Only called when the apply itself succeeded, so the running config
    already carries the edits. ``save_preset`` reports its own failure."""
    return await manager.save_preset(name)


@router.post("/config/apply")
async def apply(request: Request, manager: Mgr, body: ApplyBody | None = None) -> dict[str, Any]:
    store = _pending(request)
    switch_to = body.switch_to if body else None
    if not store.live and not store.http and switch_to is None:
        raise HTTPException(status_code=400, detail="nothing staged")
    try:
        report = await manager.apply(store.live, store.http, switch_to)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not _apply_succeeded(report):
        return report  # soft failure — keep staging so the user can retry
    if body is not None and body.save is not None:
        report["saved"] = await _save_after_apply(manager, body.save.name)
    store.clear()
    return report


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
        return await manager.apply_engine(body.overrides, body.all_presets)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/restore")
async def restore(cfgfile: Annotated[UploadFile, File()], manager: HttpMgr) -> dict[str, Any]:
    data = await cfgfile.read()
    try:
        await manager.restore_config(data)
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"restore failed: {exc}") from exc
    return {"restored": True, "bytes": len(data)}


@router.post("/profile/{action}")
async def profile(action: str, body: ProfileBody, manager: Mgr) -> dict[str, Any]:
    methods = {
        "load": manager.load_preset,
        "save": manager.save_preset,
        "delete": manager.delete_preset,
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
    """Delete a preset from the store and remove its daemon mirror (Delete button
    on the preset picker)."""
    try:
        return await manager.delete_preset(name)
    except PresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"delete preset failed: {exc}") from exc


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
        yield
        manager.stop()
        await task
        await manager.aclose()
        if http_client is not None:
            await http_client.aclose()

    app = FastAPI(title="HQPTuner", lifespan=lifespan)
    app.state.manager = manager
    app.state.static = static
    app.state.http_client = http_client
    app.state.pending = PendingStore()
    app.include_router(router)
    app.include_router(matrixapi.router)
    # Serve the SPA. Mounted last and at "/", so the /api routes above win; the
    # SPA's static assets and index.html fall through to here.
    static_dir = Path(__file__).resolve().parent.parent / "static"
    if static_dir.is_dir():
        app.mount("/", NoCacheStaticFiles(directory=static_dir, html=True), name="spa")
    return app
