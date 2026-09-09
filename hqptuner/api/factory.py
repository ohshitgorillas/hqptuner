"""Application factory — shared state, the router mounts, and the SPA."""

import logging

from fastapi import FastAPI

from hqptuner.api import errors
from hqptuner.api.lifespan import make_lifespan
from hqptuner.api.routes import (
    apply,
    autopilot,
    config,
    connection,
    descriptions,
    discovery,
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
from hqptuner.config import Config
from hqptuner.core.connection import ConnectionStore, build_http_client, layer_onto_config
from hqptuner.core.manager import ConnectionManager
from hqptuner.metadata import StaticMetadata
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.live import LivePresetStore
from hqptuner.presets.store.narrowing import NarrowingStore

log = logging.getLogger(__name__)


def create_app(cfg: Config | None = None) -> FastAPI:
    """Build the FastAPI app: shared state, the poll and metering background tasks, every router, and the SPA mount.

    Missing hqplayerd credentials are not fatal — the 8088 client is simply absent and the routes needing it 503.
    """
    cfg = cfg or Config()
    static = StaticMetadata(cfg.data_dir)
    # The saved connection record layers under the environment, so this runs before anything reads the three fields
    # it can move (core/connection.py).
    connections = ConnectionStore(cfg.connection_file)
    layer_onto_config(cfg, connections.read())
    http_client = build_http_client(cfg)
    if http_client is None:
        log.warning("no hqplayerd credentials — /api/config unavailable until POST /api/connection carries a pair")
    manager = ConnectionManager(cfg, http_client)

    app = FastAPI(title="HQPTuner", lifespan=make_lifespan(cfg, manager))
    errors.install(app)
    app.state.manager = manager
    app.state.config = cfg
    app.state.static = static
    app.state.connections = connections
    app.state.pending = PendingStore()
    app.state.audit = manager.audit
    if manager.audit.enabled:
        app.include_router(audit_router(manager.audit))
    app.state.live_presets = LivePresetStore(cfg.live_preset_file)
    app.state.favorites = FavoriteStore(cfg.favorites_file)
    app.state.descriptions = DescriptionStore(cfg.description_file)
    app.state.narrowing = NarrowingStore(cfg.narrowing_file)
    # One instance, not two: the prune on preset delete lives with the preset
    # operations, so the routes read the store that delete writes.
    app.state.matrix_modes = manager.presetops.matrix_modes
    # Both `/preset/{name:path}` routes are greedy so that an empty or
    # separator-bearing name reaches the store's name rule instead of falling
    # past every route to the router's own 404. Their registration order carries
    # nothing: they differ by method, and a route whose path matches but whose
    # method does not is a partial match, never a full one.
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
    app.include_router(discovery.router)
    app.include_router(connection.router)
    mount_spa(app)
    return app
