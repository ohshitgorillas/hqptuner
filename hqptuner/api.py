"""Read-only REST API (Phase 2.3)."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Request

from .config import Config
from .httpconf import HttpConfigClient
from .manager import ConnectionManager
from .metadata import StaticMetadata, merge_enumerations

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


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


@router.get("/metadata")
def metadata(request: Request) -> dict[str, Any]:
    static: StaticMetadata = request.app.state.static
    return static.raw


def create_app(cfg: Config | None = None) -> FastAPI:
    cfg = cfg or Config()
    static = StaticMetadata(cfg.data_dir)
    http_client = None
    if cfg.hqp_username and cfg.hqp_password:
        http_client = HttpConfigClient(
            cfg.hqp_host, cfg.hqp_http_port, cfg.hqp_username, cfg.hqp_password
        )
    else:
        log.warning("no HQPTUNER_HQP_USERNAME/PASSWORD — /api/config unavailable")
    manager = ConnectionManager(cfg, http_client)

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(manager.run())
        yield
        manager.stop()
        await task
        if http_client is not None:
            await http_client.aclose()

    app = FastAPI(title="HQPTuner", lifespan=lifespan)
    app.state.manager = manager
    app.state.static = static
    app.state.http_client = http_client
    app.include_router(router)
    return app
