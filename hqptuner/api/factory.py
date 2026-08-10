"""Application factory — shared state, the router mounts, and the SPA."""

import logging

from fastapi import FastAPI

from hqptuner.api import (
    applyapi,
    configapi,
    favoritesapi,
    livepresetapi,
    matrixapi,
    pendingapi,
    presetapi,
    statusapi,
    volumeapi,
)
from hqptuner.api.auditapi import audit_router
from hqptuner.api.lifespan import make_lifespan
from hqptuner.api.pendingapi import PendingStore
from hqptuner.api.spa import mount_spa
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.metadata import StaticMetadata
from hqptuner.presets.favoritestore import FavoriteStore
from hqptuner.presets.livepresets import LivePresetStore

log = logging.getLogger(__name__)


def create_app(cfg: Config | None = None) -> FastAPI:
    """Build the FastAPI app: shared state, the poll and metering background tasks, every router, and the SPA mount.

    Missing hqplayerd credentials are not fatal — the 8088 client is simply absent and the routes needing it 503.
    """
    cfg = cfg or Config()
    static = StaticMetadata(cfg.data_dir)
    http_client = None
    if cfg.hqp_username and cfg.hqp_password:
        http_client = HttpConfigClient(cfg.hqp_host, cfg.hqp_http_port, cfg.hqp_username, cfg.hqp_password)
    else:
        log.warning("no HQPTUNER_HQP_USERNAME/PASSWORD — /api/config unavailable")
    manager = ConnectionManager(cfg, http_client)

    app = FastAPI(title="HQPTuner", lifespan=make_lifespan(cfg, manager, http_client))
    app.state.manager = manager
    app.state.static = static
    app.state.http_client = http_client
    app.state.pending = PendingStore()
    app.state.audit = manager.audit
    if manager.audit.enabled:
        app.include_router(audit_router(manager.audit))
    app.state.live_presets = LivePresetStore(cfg.live_preset_file)
    app.state.favorites = FavoriteStore(cfg.favorites_file)
    # Registration order is load-bearing: configapi's `GET /preset/{name:path}`
    # must stay ahead of presetapi's `DELETE /preset/{name}`, as it was when both
    # lived on one router.
    app.include_router(statusapi.router)
    app.include_router(configapi.router)
    app.include_router(applyapi.router)
    app.include_router(volumeapi.router)
    app.include_router(presetapi.router)
    app.include_router(pendingapi.router)
    app.include_router(matrixapi.router)
    app.include_router(livepresetapi.router)
    app.include_router(favoritesapi.router)
    mount_spa(app)
    return app
