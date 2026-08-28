"""Application factory — shared state, the router mounts, and the SPA."""

import logging

from fastapi import FastAPI

from hqptuner.api.lifespan import make_lifespan
from hqptuner.api.routes import (
    apply,
    autopilot,
    config,
    descriptions,
    favorites,
    livepreset,
    matrix,
    matrixmodes,
    narrowing,
    pending,
    preset,
    status,
    volume,
)
from hqptuner.api.routes.audit import audit_router
from hqptuner.api.routes.pending import PendingStore
from hqptuner.api.spa import mount_spa
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.metadata import StaticMetadata
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.live import LivePresetStore
from hqptuner.presets.store.matrixmode import MatrixModeStore
from hqptuner.presets.store.narrowing import NarrowingStore

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
    app.state.descriptions = DescriptionStore(cfg.description_file)
    app.state.narrowing = NarrowingStore(cfg.narrowing_file)
    app.state.matrix_modes = MatrixModeStore(cfg.matrix_mode_file)
    # Registration order is load-bearing: config's `GET /preset/{name:path}`
    # must stay ahead of preset's `DELETE /preset/{name}`, as it was when both
    # lived on one router.
    app.include_router(status.router)
    app.include_router(config.router)
    app.include_router(apply.router)
    app.include_router(volume.router)
    app.include_router(preset.router)
    app.include_router(pending.router)
    app.include_router(matrix.router)
    app.include_router(livepreset.router)
    app.include_router(favorites.router)
    app.include_router(descriptions.router)
    app.include_router(narrowing.router)
    app.include_router(matrixmodes.router)
    app.include_router(autopilot.router)
    mount_spa(app)
    return app
