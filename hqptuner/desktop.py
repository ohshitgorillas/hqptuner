"""Desktop shell for macOS and Windows: a tray icon in front of the server, one instance per listen port.

``launch`` is the entry point's dispatcher. On Linux it serves exactly as ``main()`` always has. On macOS and
Windows it first asks the listen port who holds it, then either serves behind a tray icon, opens the browser on the
instance already running, or refuses because another program has the port.

Every outside effect (the port probe, the browser, the bound server, its thread, the tray) is a field of
``Parts``, so a caller replaces any of them without patching.
"""

from __future__ import annotations

import enum
import importlib
import ipaddress
import logging
import re
import socket
import threading
import webbrowser
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING, Protocol, cast
from urllib.parse import urlsplit

import httpx
import uvicorn

from hqptuner.config import Config
from hqptuner.paths import bundled

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastapi import FastAPI

log = logging.getLogger(__name__)

OPEN_LABEL = "Open HQPTuner"
QUIT_LABEL = "Quit HQPTuner"

#: Seconds the single-instance check waits on ``GET /api/health`` before calling the port's holder a stranger.
PROBE_TIMEOUT = 2.0

#: The ``app_version`` key in a JSON body, which marks HQPTuner's ``GET /api/health`` answer.
_APP_VERSION = re.compile(r'"app_version"\s*:')

#: Seconds Quit waits for the server thread to finish before the tray stops anyway.
QUIT_WAIT = 10.0

#: Each wildcard listen address, and the loopback address a browser connects to in its place.
_LOOPBACK = {str(ipaddress.IPv4Address(0)): "127.0.0.1", str(ipaddress.IPv6Address(0)): "::1"}


class Shell(enum.Enum):
    """What a launch runs on a given platform."""

    SERVER = "server"
    DESKTOP = "desktop"


class Occupant(enum.Enum):
    """Who answered on the listen port."""

    NOBODY = "nobody"
    HQPTUNER = "hqptuner"
    STRANGER = "stranger"


class Stop(enum.Enum):
    """How the server thread ended when Quit asked it to."""

    CLEAN = "clean"
    ABANDONED = "abandoned"


class Listener(Protocol):
    """A server whose socket is already bound: ``run`` serves until ``exit`` is called."""

    def run(self) -> None:
        """Serve on the bound socket until asked to exit."""

    def exit(self) -> None:
        """Ask a running ``run`` to return."""


class Worker(Protocol):
    """The thread the server runs on."""

    def start(self) -> None:
        """Start the thread."""

    def join(self, timeout: float | None = None) -> None:
        """Wait for the thread, at most ``timeout`` seconds."""

    def is_alive(self) -> bool:
        """Whether the thread is still running."""


class Tray(Protocol):
    """A tray icon: ``run`` blocks the calling thread until ``stop``."""

    def run(self) -> None:
        """Show the icon and handle its menu until stopped."""

    def stop(self) -> None:
        """Remove the icon and let ``run`` return."""


class TrayBackend(Protocol):
    """The three pystray names the adapter uses."""

    Icon: Callable[..., Tray]
    Menu: Callable[..., object]
    MenuItem: Callable[..., object]


def shell_for(platform: str) -> Shell:
    """Return the shell a launch runs on ``platform``, a ``sys.platform`` value.

    macOS (``darwin``) and Windows (``win32``) get the desktop shell; every other platform serves headless.
    """
    return Shell.DESKTOP if platform in {"darwin", "win32"} else Shell.SERVER


def ui_url(host: str, port: int) -> str:
    """Return the URL a browser on this machine opens to reach a server listening on ``host:port``.

    A wildcard listen address (``0.0.0.0`` or ``::``) is not an address to connect to, so it becomes loopback.
    """
    name = _LOOPBACK.get(host, host)
    return f"http://[{name}]:{port}" if ":" in name else f"http://{name}:{port}"


def answers(url: str, timeout: float = PROBE_TIMEOUT) -> bool:
    """Return whether something accepts a TCP connection on ``url``'s host and port within ``timeout`` seconds."""
    parts = urlsplit(url)
    family, kind, proto, _, address = socket.getaddrinfo(parts.hostname, parts.port, type=socket.SOCK_STREAM)[0]
    with socket.socket(family, kind, proto) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex(address) == 0


def occupant(
    url: str, get: Callable[..., httpx.Response] = httpx.get, knock: Callable[[str], bool] = answers
) -> Occupant:
    """Say who holds the listen port; ``url`` is the UI's URL, as ``ui_url`` builds it.

    When ``knock`` finds nothing accepting a connection on the port, nobody holds it. Otherwise ``GET
    {url}/api/health`` decides: a body carrying an ``app_version`` key means HQPTuner, any other body a stranger.
    ``httpx.HTTPError`` propagates when the holder does not answer as HTTP within ``PROBE_TIMEOUT``.
    """
    if not knock(url):
        return Occupant.NOBODY
    response = get(f"{url}/api/health", timeout=PROBE_TIMEOUT)
    return Occupant.HQPTUNER if _APP_VERSION.search(response.text) else Occupant.STRANGER


def stop(listener: Listener, worker: Worker, timeout: float = QUIT_WAIT) -> Stop:
    """Ask the server to exit and wait for its thread, at most ``timeout`` seconds.

    Returns ``CLEAN`` when the thread finished inside the wait and ``ABANDONED`` when it was still running.
    """
    listener.exit()
    worker.join(timeout)
    return Stop.ABANDONED if worker.is_alive() else Stop.CLEAN


def build_tray(backend: TrayBackend, image: object, on_open: Callable[[], None], on_quit: Callable[[], None]) -> Tray:
    """Build the tray icon on ``backend`` with its two menu items.

    The Open item is the menu's default and calls ``on_open``; the Quit item calls ``on_quit``.
    """
    menu = backend.Menu(
        backend.MenuItem(OPEN_LABEL, on_open, default=True),
        backend.MenuItem(QUIT_LABEL, on_quit),
    )
    return backend.Icon("HQPTuner", image, "HQPTuner", menu)


class Listening:
    """A uvicorn server whose socket is bound and listening from construction.

    The kernel queues a connection made before ``run`` starts accepting, so a browser opened right after
    construction waits for its page instead of being refused.
    """

    def __init__(self, app: FastAPI, *, host: str, port: int, log_level: str, timeout_graceful_shutdown: int) -> None:
        """Bind ``host:port`` and start listening; uvicorn exits the process when the port cannot be bound."""
        config = uvicorn.Config(
            app, host=host, port=port, log_level=log_level, timeout_graceful_shutdown=timeout_graceful_shutdown
        )
        sock = config.bind_socket()
        sock.listen(config.backlog)
        self.server = uvicorn.Server(config)
        self.sockets = [sock]

    def run(self) -> None:
        """Serve on the bound socket until asked to exit."""
        self.server.run(sockets=self.sockets)

    def exit(self) -> None:
        """Ask a running ``run`` to return."""
        self.server.should_exit = True


def daemon_thread(target: Callable[[], None]) -> threading.Thread:
    """Wrap ``target`` in an unstarted daemon thread, which cannot keep the process alive once Quit gives up on it."""
    return threading.Thread(target=target, daemon=True)


def pystray_icon(on_open: Callable[[], None], on_quit: Callable[[], None]) -> Tray:
    """Build the pystray icon from the bundled image.

    pystray and Pillow are loaded by name because only macOS and Windows installs carry them.
    """
    backend = cast("TrayBackend", importlib.import_module("pystray"))
    image = importlib.import_module("PIL.Image").open(bundled("data", "tray.png"))
    return build_tray(backend, image, on_open, on_quit)


_new_tab = partial(webbrowser.open, new=2)


@dataclass(frozen=True)
class Parts:
    """The outside effects the shell reaches for.

    ``probe`` takes the UI's URL and says who holds the listen port, ``browse`` opens a URL in the default
    browser, ``listen`` binds the listen socket and returns the server that will serve on it, ``worker`` wraps a
    target in an unstarted thread, and ``tray`` builds the tray icon from its Open and Quit callbacks.
    """

    probe: Callable[[str], Occupant] = occupant
    browse: Callable[[str], object] = _new_tab
    listen: Callable[..., Listener] = Listening
    worker: Callable[[Callable[[], None]], Worker] = daemon_thread
    tray: Callable[[Callable[[], None], Callable[[], None]], Tray] = pystray_icon


def serve(app: FastAPI, *, host: str, port: int, parts: Parts | None = None, **uvicorn_options: object) -> None:
    """Serve ``app`` behind a tray icon until Quit; takes the keywords ``main`` hands its runner.

    In order: bind the listen socket, start the server on its thread, open the browser on the UI, then run the
    tray on the calling thread. Open in the tray menu opens the browser again. Quit stops the server, waits for
    its thread, then stops the tray, which is what lets this return.
    """
    parts = parts or Parts()
    listener = parts.listen(app, host=host, port=port, **uvicorn_options)
    worker = parts.worker(listener.run)
    worker.start()
    url = ui_url(host, port)
    parts.browse(url)

    def on_open() -> None:
        parts.browse(url)

    def on_quit() -> None:
        if stop(listener, worker) is Stop.ABANDONED:
            log.warning("server still running %.0f s after Quit; exiting without it", QUIT_WAIT)
        tray.stop()

    tray = parts.tray(on_open, on_quit)
    tray.run()


def _refuse(url: str) -> int:
    """Log that another program holds ``url``'s port and return the exit status for it."""
    log.error("%s is held by another program; HQPTuner did not start", url)
    return 1


def launch(platform: str, main: Callable[..., None], parts: Parts | None = None) -> int:
    """Run the launch ``platform`` calls for and return the process exit status.

    The headless shell calls ``main()`` and returns 0. The desktop shell asks the configured listen port who
    holds it first: nobody, and it calls ``main(run=...)`` with ``serve`` as the runner; HQPTuner, and it opens
    the browser on that instance without starting a server; a stranger, and it logs the conflict and returns 1.
    A holder that never answers the probe as HTTP is a stranger too: the conflict is logged and the process ends
    with status 1.
    """
    if shell_for(platform) is Shell.SERVER:
        main()
        return 0
    parts = parts or Parts()
    cfg = Config()
    url = ui_url(cfg.listen_host, cfg.listen_port)
    try:
        held = parts.probe(url)
    except httpx.HTTPError as exc:
        raise SystemExit(_refuse(url)) from exc
    if held is Occupant.STRANGER:
        return _refuse(url)
    if held is Occupant.HQPTUNER:
        parts.browse(url)
        return 0
    main(run=partial(serve, parts=parts))
    return 0
