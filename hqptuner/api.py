"""Read-only REST API (Phase 2.3)."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import Config
from .control import ControlError
from .httpconf import HttpConfigClient
from .manager import ConnectionManager
from .metadata import StaticMetadata, merge_enumerations
from .writer import known_live_settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


class StageBody(BaseModel):
    live: dict[str, dict[str, str]] = {}
    http: dict[str, str] = {}


class ProfileBody(BaseModel):
    name: str = ""


class VolumeBody(BaseModel):
    level: str


class PendingStore:
    """Server-side staged-changes buffer. Survives browser reloads because it
    lives on the backend, not the client (roadmap Phase 3)."""

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


def _mgr(request: Request) -> ConnectionManager:
    manager: ConnectionManager = request.app.state.manager
    return manager


def _snapshot(manager: ConnectionManager, data: Any) -> dict[str, Any]:
    """Serve last-loaded state, flagged stale when the daemon is unreachable —
    never a socket wait (roadmap 2.2 fail-fast rule)."""
    if data is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    return {"stale": not manager.reachable, "loaded_at": manager.loaded_at, "data": data}


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    return {
        "reachable": manager.reachable,
        "unreachable_since": manager.unreachable_since,
        "alarm": manager.alarm,
        "info": manager.info,
    }


@router.get("/state")
def state(request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    return _snapshot(manager, manager.state)


@router.get("/status")
def status(request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    if manager.status is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    return _snapshot(manager, {"status": manager.status, "metadata": manager.status_metadata})


@router.get("/enumerations")
def enumerations(request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    if manager.enums is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    mode_name = manager.current_mode_name()
    merged = merge_enumerations(manager.enums, request.app.state.static, mode_name)
    merged["mode"] = {"index": (manager.state or {}).get("mode"), "name": mode_name}
    return _snapshot(manager, merged)


@router.get("/config")
def config(request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    if request.app.state.http_client is None:
        raise HTTPException(status_code=503, detail="no hqplayerd credentials configured")
    if manager.config_form is None and manager.config_error:
        raise HTTPException(status_code=502, detail=f"GET /config failed: {manager.config_error}")
    return _snapshot(manager, manager.config_form)


@router.get("/matrix")
def matrix(request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    if request.app.state.http_client is None:
        raise HTTPException(status_code=503, detail="no hqplayerd credentials configured")
    if manager.matrix_form is None and manager.matrix_error:
        raise HTTPException(status_code=502, detail=f"GET /matrix failed: {manager.matrix_error}")
    return _snapshot(manager, manager.matrix_form)


@router.get("/metadata")
def metadata(request: Request) -> dict[str, Any]:
    static: StaticMetadata = request.app.state.static
    return static.raw


@router.get("/volume")
def volume_get(request: Request) -> dict[str, Any]:
    """Live volume + its live bounds/enabled (VolumeRange). Separate from the
    staged-config surface — this is the runtime playback-volume lane."""
    manager = _mgr(request)
    vr = manager.volume_range or {}
    return {
        "volume": (manager.state or {}).get("volume"),
        "min": vr.get("min"),
        "max": vr.get("max"),
        "enabled": vr.get("enabled"),
        "adaptive": vr.get("adaptive"),
    }


@router.post("/volume")
async def volume_set(body: VolumeBody, request: Request) -> dict[str, Any]:
    """Immediate live-volume write — never staged, never restarts. 503 when
    volume control is disabled (the slider grays on that state, so this is the
    race backstop)."""
    try:
        return await _mgr(request).set_volume(body.level)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _pending(request: Request) -> PendingStore:
    store: PendingStore = request.app.state.pending
    return store


def _apply_succeeded(report: dict[str, Any]) -> bool:
    """Whether every staged change actually took. A live edit counts only if its
    readback verified (`ok`); the http lane only if the daemon reflected the
    change after its restart (`verified.applied`). A soft failure — daemon
    answered but rejected, or a value never reflected — returns False here so the
    caller keeps the pending buffer instead of silently dropping the edits."""
    if any(not entry.get("ok") for entry in report.get("live", [])):
        return False
    http = report.get("http")
    return not (http is not None and not http.get("verified", {}).get("applied"))


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
def discard(request: Request) -> dict[str, Any]:
    store = _pending(request)
    store.clear()
    return store.snapshot()


@router.post("/config/apply")
async def apply(request: Request) -> dict[str, Any]:
    store = _pending(request)
    if not store.live and not store.http:
        raise HTTPException(status_code=400, detail="nothing staged")
    try:
        report = await _mgr(request).apply(store.live, store.http)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if _apply_succeeded(report):
        store.clear()  # keep staging on a soft failure so the user can retry
    return report


@router.post("/profile/{action}")
async def profile(action: str, body: ProfileBody, request: Request) -> dict[str, Any]:
    manager = _mgr(request)
    methods = {
        "load": manager.load_profile,
        "save": manager.save_profile,
        "delete": manager.delete_profile,
    }
    if action not in methods:
        raise HTTPException(status_code=404, detail=f"unknown profile action: {action}")
    if not body.name:
        raise HTTPException(status_code=422, detail="profile name required")
    try:
        await methods[action](body.name)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"action": action, "name": body.name, "submitted": True}


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
    # Serve the SPA. Mounted last and at "/", so the /api routes above win; the
    # SPA's static assets and index.html fall through to here.
    static_dir = Path(__file__).resolve().parent / "static"
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="spa")
    return app
