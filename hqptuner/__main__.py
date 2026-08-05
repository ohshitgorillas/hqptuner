import logging

import uvicorn

from .api import create_app
from .audit import resolve_level
from .config import Config

cfg = Config()
level = resolve_level(cfg.log_level)
logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
uvicorn.run(
    create_app(cfg),
    host=cfg.listen_host,
    port=cfg.listen_port,
    log_level=logging.getLevelName(level).lower(),
)
