import logging

import uvicorn

from .api import create_app
from .config import Config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

cfg = Config()
uvicorn.run(create_app(cfg), host=cfg.listen_host, port=cfg.listen_port, log_level="info")
