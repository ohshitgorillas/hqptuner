"""Entry point for ``python -m hqptuner``, and for a frozen build's bootloader.

Reads the whole configuration from the ``HQPTUNER_*`` environment, installs the root log handler at the
configured level, and serves the REST API and bundled SPA with uvicorn on ``listen_host:listen_port``. Serving
happens in ``main()``, never on import, so a bootloader that imports this module for its entry point starts
nothing by doing so. Run as a program, it goes through ``hqptuner.desktop.launch``, which calls ``main()`` directly
on Linux and puts the tray icon and the single-instance check in front of it on macOS and Windows.
"""

import logging
import multiprocessing
import sys
from collections.abc import Callable

import uvicorn

from hqptuner.api.factory import create_app
from hqptuner.audit import resolve_level
from hqptuner.config import Config
from hqptuner.desktop import launch


def main(run: Callable[..., None] = uvicorn.run) -> None:
    """Configure logging from the environment, then serve until interrupted.

    ``run`` defaults to the live ``uvicorn.run``; a caller pins it to observe that serving was asked for
    without starting a real server.
    """
    # First statement of the entry point, per PyInstaller: a frozen build's child
    # processes re-enter the executable, and this is what stops them re-running main.
    multiprocessing.freeze_support()
    cfg = Config()
    level = resolve_level(cfg.log_level)
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run(
        create_app(cfg),
        host=cfg.listen_host,
        port=cfg.listen_port,
        log_level=logging.getLevelName(level).lower(),
        # An open meter feed never closes on its own; without a bound, shutdown would wait on it until the kill.
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    # A frozen build's child processes re-enter here too, and this is what returns
    # them to their own work before launch asks the listen port who holds it.
    multiprocessing.freeze_support()
    sys.exit(launch(sys.platform, main))
