"""Entry point for ``python -m hqptuner``, and for a frozen build's bootloader.

Reads the whole configuration from the ``HQPTUNER_*`` environment, installs the root log handler at the
configured level, and serves the REST API and bundled SPA with uvicorn on ``listen_host:listen_port``. Serving
happens in ``main()``, never on import, so a bootloader that imports this module for its entry point starts
nothing by doing so.
"""

import logging
import multiprocessing

import uvicorn

from hqptuner.api.factory import create_app
from hqptuner.audit import resolve_level
from hqptuner.config import Config


def main() -> None:
    """Configure logging from the environment, then serve until interrupted."""
    # First statement of the entry point, per PyInstaller: a frozen build's child
    # processes re-enter the executable, and this is what stops them re-running main.
    multiprocessing.freeze_support()
    cfg = Config()
    level = resolve_level(cfg.log_level)
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run(
        create_app(cfg),
        host=cfg.listen_host,
        port=cfg.listen_port,
        log_level=logging.getLevelName(level).lower(),
    )


if __name__ == "__main__":
    main()
