"""Entry point for ``python -m hqptuner``.

Reads the whole configuration from the ``HQPTUNER_*`` environment, installs the root log handler at the
configured level, and serves the REST API and bundled SPA with uvicorn on ``listen_host:listen_port``. Runs on
import, so this module is executed, never imported for its names.
"""

import logging

import uvicorn

from hqptuner.api.factory import create_app
from hqptuner.audit import resolve_level
from hqptuner.config import Config

cfg = Config()
level = resolve_level(cfg.log_level)
logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
uvicorn.run(
    create_app(cfg),
    host=cfg.listen_host,
    port=cfg.listen_port,
    log_level=logging.getLevelName(level).lower(),
)
