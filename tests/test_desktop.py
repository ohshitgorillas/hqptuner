"""The desktop shell: platform dispatch, the UI's URL, the tray menu, the serve sequence and the launch dispatcher.

Every outside effect goes through a ``Parts`` built from the fakes below. Each fake answers from the table its test
hands it and appends what was asked of it to one shared log, so a test reads the order of effects off that log.
"""

from __future__ import annotations

import inspect
import io
import ipaddress
import socket
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

import fake_http
import httpx
import pytest
from fastapi import FastAPI

from hqptuner import desktop
from hqptuner.desktop import Occupant, Parts, Shell

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

HOST = "127.0.0.1"
PORT = 18431


# --- fakes ------------------------------------------------------------------------------------------------------


class FakeListener:
    """A bound server: ``run`` logs ``serve`` and returns, ``exit`` logs ``exit``."""

    def __init__(self, log: list[str]) -> None:
        self.log = log

    def run(self) -> None:
        self.log.append("serve")

    def exit(self) -> None:
        self.log.append("exit")


class FakeWorker:
    """A thread that runs its target inline on ``start`` and reports the liveness its table gave it."""

    def __init__(self, log: list[str], target: Callable[[], None], *, alive: bool) -> None:
        self.log = log
        self.target = target
        self.alive = alive
        self.waits: list[float | None] = []

    def start(self) -> None:
        self.log.append("start")
        self.target()

    def join(self, timeout: float | None = None) -> None:
        self.log.append("join")
        self.waits.append(timeout)

    def is_alive(self) -> bool:
        return self.alive


class FakeTray:
    """A tray icon whose ``run`` clicks the scripted menu entries in order, then returns."""

    def __init__(self, log: list[str], callbacks: dict[str, Callable[[], None]], clicks: tuple[str, ...]) -> None:
        self.log = log
        self.callbacks = callbacks
        self.clicks = clicks

    def run(self) -> None:
        self.log.append("tray")
        for click in self.clicks:
            self.callbacks[click]()

    def stop(self) -> None:
        self.log.append("tray-stop")


@dataclass
class Rig:
    """The table a test hands the fakes: who holds the port, what the user clicks, whether the thread outlives Quit."""

    occupant: Occupant = Occupant.NOBODY
    clicks: tuple[str, ...] = ()
    alive_after_join: bool = False
    log: list[str] = field(default_factory=list)
    probed: list[str] = field(default_factory=list)
    browsed: list[str] = field(default_factory=list)
    bound: list[tuple[tuple[object, ...], dict[str, object]]] = field(default_factory=list)

    def probe(self, url: str) -> Occupant:
        self.log.append("probe")
        self.probed.append(url)
        return self.occupant

    def browse(self, url: str) -> object:
        self.log.append("browse")
        self.browsed.append(url)
        return None

    def listen(self, *args: object, **kwargs: object) -> FakeListener:
        self.log.append("bind")
        self.bound.append((args, kwargs))
        return FakeListener(self.log)

    def worker(self, target: Callable[[], None]) -> FakeWorker:
        return FakeWorker(self.log, target, alive=self.alive_after_join)

    def tray(self, on_open: Callable[[], None], on_quit: Callable[[], None]) -> FakeTray:
        return FakeTray(self.log, {"open": on_open, "quit": on_quit}, self.clicks)

    def parts(self) -> Parts:
        return Parts(probe=self.probe, browse=self.browse, listen=self.listen, worker=self.worker, tray=self.tray)


@dataclass
class FakeItem:
    """One menu entry, as pystray's ``MenuItem`` takes it."""

    text: object
    action: Callable[..., object]
    default: bool


class FakeIcon:
    """The icon pystray's ``Icon`` builds; it keeps what it was built from and whether it is running."""

    def __init__(self, name: object, image: object, title: object, menu: object) -> None:
        self.name = name
        self.image = image
        self.title = title
        self.menu = menu
        self.running = False

    def run(self) -> None:
        self.running = True

    def stop(self) -> None:
        self.running = False


class FakeBackend:
    """pystray's three names, taking what pystray's own take; every icon, menu and item built is kept."""

    Icon: Callable[..., desktop.Tray]
    Menu: Callable[..., object]
    MenuItem: Callable[..., object]

    def __init__(self) -> None:
        self.icons: list[FakeIcon] = []
        self.menus: list[tuple[object, ...]] = []
        self.items: list[FakeItem] = []
        self.Icon = self._icon
        self.Menu = self._menu
        self.MenuItem = self._item

    def _icon(self, name: object, icon: object = None, title: object = None, menu: object = None) -> FakeIcon:
        built = FakeIcon(name, icon, title, menu)
        self.icons.append(built)
        return built

    def _menu(self, *items: object) -> tuple[object, ...]:
        self.menus.append(items)
        return items

    def _item(self, text: object, action: Callable[..., object], **options: object) -> FakeItem:
        built = FakeItem(text, action, default=options.get("default") is True)
        self.items.append(built)
        return built


# --- helpers ----------------------------------------------------------------------------------------------------


def fire(item: FakeItem, icon: FakeIcon) -> object:
    """Call a menu action the way pystray does: with as many of ``(icon, item)`` as the action takes."""
    count = len(inspect.signature(item.action).parameters)
    return item.action(*(icon, item)[:count])


def callbacks_reached(*, default: bool) -> list[str]:
    """Build the tray, click every menu item whose default flag is ``default``, return the callbacks that ran."""
    hits: list[str] = []
    backend = FakeBackend()
    desktop.build_tray(backend, object(), lambda: hits.append("open"), lambda: hits.append("quit"))
    for icon in backend.icons:
        menu = icon.menu if isinstance(icon.menu, tuple) else ()
        for item in menu:
            if isinstance(item, FakeItem) and item.default is default:
                fire(item, icon)
    return hits


def serve_on(rig: Rig, host: str = HOST, port: int = PORT) -> list[str]:
    """Run ``serve`` against the rig's parts and return the effect log."""
    desktop.serve(FastAPI(), host=host, port=port, log_level="info", timeout_graceful_shutdown=5, parts=rig.parts())
    return rig.log


def after_tray(log: list[str]) -> list[str] | None:
    """The effects logged after the tray started running, or None when it never ran."""
    if "tray" not in log:
        return None
    return log[log.index("tray") + 1 :]


def names_loopback(url: str) -> bool:
    """Whether ``url``'s host is a loopback address or ``localhost``."""
    return urlsplit(url).hostname in {"localhost", "127.0.0.1", "::1"}


def addresses(urls: list[str]) -> list[tuple[str | None, int | None]]:
    """Each URL's host and port."""
    return [(urlsplit(url).hostname, urlsplit(url).port) for url in urls]


@dataclass
class FakeMain:
    """The entry point's ``main``: records whether it was handed a runner, and starts nothing."""

    calls: list[str] = field(default_factory=list)

    def __call__(self, **kwargs: object) -> None:
        self.calls.append("desktop" if "run" in kwargs else "headless")


@pytest.fixture
def listen_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HQPTUNER_LISTEN_HOST", HOST)
    monkeypatch.setenv("HQPTUNER_LISTEN_PORT", str(PORT))


# --- shell_for --------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("platform", "shell"),
    [("darwin", Shell.DESKTOP), ("win32", Shell.DESKTOP), ("linux", Shell.SERVER), ("freebsd14", Shell.SERVER)],
)
def test_shell_for_gives_macos_and_windows_the_desktop_and_others_the_server(platform: str, shell: Shell) -> None:
    assert desktop.shell_for(platform) is shell


# --- ui_url -----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("host", ["192.0.2.7", "2001:db8::7", "tuner.example"])
def test_ui_url_keeps_a_concrete_listen_address(host: str) -> None:
    assert urlsplit(desktop.ui_url(host, PORT)).hostname == host


@pytest.mark.parametrize("host", [str(ipaddress.IPv4Address(0)), str(ipaddress.IPv6Address(0))])
def test_ui_url_turns_a_wildcard_listen_address_into_loopback(host: str) -> None:
    assert names_loopback(desktop.ui_url(host, PORT))


@pytest.mark.parametrize("port", [8090, PORT])
def test_ui_url_carries_the_listen_port(port: int) -> None:
    assert urlsplit(desktop.ui_url(HOST, port)).port == port


def test_ui_url_speaks_plain_http() -> None:
    assert urlsplit(desktop.ui_url(HOST, PORT)).scheme == "http"


# --- build_tray -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("default", "reached"), [(True, ["open"]), (False, ["quit"])], ids=["default", "other"])
def test_tray_default_item_opens_and_the_other_quits(*, default: bool, reached: list[str]) -> None:
    assert callbacks_reached(default=default) == reached


# --- serve ------------------------------------------------------------------------------------------------------


def test_serve_binds_then_starts_the_server_then_opens_the_browser_then_runs_the_tray() -> None:
    assert serve_on(Rig()) == ["bind", "start", "serve", "browse", "tray"]


@pytest.mark.parametrize(
    ("clicks", "alive", "tail"),
    [
        (("open",), False, ["browse"]),
        (("quit",), False, ["exit", "join", "tray-stop"]),
        (("quit",), True, ["exit", "join", "tray-stop"]),
        (("open", "quit"), False, ["browse", "exit", "join", "tray-stop"]),
    ],
    ids=["open", "quit", "quit-thread-stuck", "open-then-quit"],
)
def test_serve_menu_clicks_take_effect_in_order(*, clicks: tuple[str, ...], alive: bool, tail: list[str]) -> None:
    assert after_tray(serve_on(Rig(clicks=clicks, alive_after_join=alive))) == tail


def test_serve_opens_the_browser_on_the_address_it_serves() -> None:
    rig = Rig()
    serve_on(rig)
    assert addresses(rig.browsed) == [(HOST, PORT)]


# --- stdio ------------------------------------------------------------------------------------------------------

KEPT = io.StringIO()
SINK = io.StringIO()


@pytest.mark.parametrize(
    ("stdout", "stderr", "pair"),
    [(None, KEPT, (SINK, KEPT)), (KEPT, None, (KEPT, SINK))],
    ids=["stdout", "stderr"],
)
def test_stdio_puts_the_sink_in_place_of_a_missing_stream(
    stdout: io.StringIO | None, stderr: io.StringIO | None, pair: tuple[io.StringIO, io.StringIO]
) -> None:
    assert desktop.stdio(stdout, stderr, sink=lambda: SINK) == pair


def test_stdio_opens_a_sink_that_takes_a_write_when_none_is_given() -> None:
    with desktop.stdio(None, KEPT)[0] as sink:
        assert sink.write("x") == 1


# --- launch -----------------------------------------------------------------------------------------------------

#: platform, who holds the port, the servers ``main`` was asked to start, the addresses browsed, the exit status.
LAUNCHES = [
    ("linux", Occupant.NOBODY, ["headless"], [], 0),
    ("linux", Occupant.HQPTUNER, ["headless"], [], 0),
    ("linux", Occupant.STRANGER, ["headless"], [], 0),
    ("darwin", Occupant.NOBODY, ["desktop"], [], 0),
    ("darwin", Occupant.HQPTUNER, [], [(HOST, PORT)], 0),
    ("darwin", Occupant.STRANGER, [], [], 1),
    ("win32", Occupant.NOBODY, ["desktop"], [], 0),
    ("win32", Occupant.HQPTUNER, [], [(HOST, PORT)], 0),
    ("win32", Occupant.STRANGER, [], [], 1),
]
SERVERS = [pytest.param(p, h, s, id=f"{p}-{h.value}") for p, h, s, _, _ in LAUNCHES]
BROWSED = [pytest.param(p, h, b, id=f"{p}-{h.value}") for p, h, _, b, _ in LAUNCHES]
STATUSES = [pytest.param(p, h, x, id=f"{p}-{h.value}") for p, h, _, _, x in LAUNCHES]


@dataclass
class Launched:
    servers: list[str]
    browsed: list[tuple[str | None, int | None]]
    status: int


def launched(platform: str, held: Occupant) -> Launched:
    """Launch on ``platform`` with ``held`` answering the probe; return what started, what was browsed, the status."""
    rig = Rig(occupant=held)
    main = FakeMain()
    status = desktop.launch(platform, main, rig.parts())
    return Launched(main.calls, addresses(rig.browsed), status)


@pytest.mark.usefixtures("listen_env")
@pytest.mark.parametrize(("platform", "held", "servers"), SERVERS)
def test_launch_starts_the_server_its_shell_and_the_port_call_for(
    platform: str, held: Occupant, servers: list[str]
) -> None:
    assert launched(platform, held).servers == servers


@pytest.mark.usefixtures("listen_env")
@pytest.mark.parametrize(("platform", "held", "browsed"), BROWSED)
def test_launch_opens_the_browser_only_on_a_running_instance(
    platform: str, held: Occupant, browsed: list[tuple[str, int]]
) -> None:
    assert launched(platform, held).browsed == browsed


@pytest.mark.usefixtures("listen_env")
@pytest.mark.parametrize(("platform", "held", "status"), STATUSES)
def test_launch_exits_nonzero_only_when_a_stranger_holds_the_port(platform: str, held: Occupant, status: int) -> None:
    assert launched(platform, held).status == status


def mute(url: str) -> Occupant:
    """A probe whose port holder takes the connection and never answers."""
    raise httpx.ReadTimeout(url)


@pytest.mark.usefixtures("listen_env")
@pytest.mark.parametrize("platform", ["darwin", "win32"])
def test_launch_ends_the_process_nonzero_when_the_port_holder_never_answers(platform: str) -> None:
    with pytest.raises(SystemExit) as ended:
        desktop.launch(platform, FakeMain(), replace(Rig().parts(), probe=mute))
    assert ended.value.code == 1


# --- stop -------------------------------------------------------------------------------------------------------


@dataclass
class Stopped:
    result: desktop.Stop
    waits: list[float | None]


def stopped(*, alive: bool, timeout: float | None = None) -> Stopped:
    """Stop a server whose thread reports ``alive`` after the join; return the result and the waits joined on."""
    log: list[str] = []
    listener = FakeListener(log)
    worker = FakeWorker(log, lambda: None, alive=alive)
    result = desktop.stop(listener, worker) if timeout is None else desktop.stop(listener, worker, timeout)
    return Stopped(result, worker.waits)


@pytest.mark.parametrize(
    ("alive", "result"), [(False, desktop.Stop.CLEAN), (True, desktop.Stop.ABANDONED)], ids=["finished", "stuck"]
)
def test_stop_abandons_a_thread_still_running_after_the_wait(*, alive: bool, result: desktop.Stop) -> None:
    assert stopped(alive=alive).result is result


@pytest.mark.parametrize(("timeout", "wait"), [(None, desktop.QUIT_WAIT), (30.0, 30.0)], ids=["default", "given"])
def test_stop_joins_the_thread_once_for_the_timeout_it_was_given(timeout: float | None, wait: float) -> None:
    assert stopped(alive=False, timeout=timeout).waits == [wait]


# --- occupant ---------------------------------------------------------------------------------------------------

HEALTH = "/api/health"


def answering(status: int, body: bytes) -> type[BaseHTTPRequestHandler]:
    """A server that answers ``GET /api/health`` with ``status`` and ``body``, and 404 on every other path."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            found = self.path == HEALTH
            sent = body if found else b""
            self.send_response(status if found else 404)
            self.send_header("Content-Length", str(len(sent)))
            self.end_headers()
            self.wfile.write(sent)

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def speaking(raw: bytes) -> type[BaseHTTPRequestHandler]:
    """A program that is not an HTTP server: it writes ``raw`` to whoever connects and hangs up."""

    class Handler(BaseHTTPRequestHandler):
        def handle(self) -> None:
            self.wfile.write(raw)

    return Handler


def served[T](handler: type[BaseHTTPRequestHandler], probe: Callable[[str], T]) -> T:
    """Serve ``handler`` on a loopback port and return what ``probe`` says about that port's URL."""
    server = fake_http.spawn({}, handler=handler)
    port = next(server)["_port"]
    try:
        return probe(f"http://{HOST}:{port}")
    finally:
        next(server, None)


def knocked(_url: str) -> bool:
    """A knock that always finds something on the port."""
    return True


@dataclass
class Get:
    """A ``get`` that keeps the timeout each request carried, then raises ``raised``, or answers 200 when it is None."""

    raised: type[httpx.TimeoutException] | None = None
    timeouts: list[object] = field(default_factory=list)

    def __call__(self, url: str, **kwargs: object) -> httpx.Response:
        self.timeouts.append(kwargs.get("timeout"))
        if self.raised is not None:
            raise self.raised(url)
        return httpx.Response(200, content=b"{}")


def test_occupant_calls_a_refused_connection_nobody(closed_port: int) -> None:
    assert desktop.occupant(f"http://{HOST}:{closed_port}") is Occupant.NOBODY


def test_occupant_calls_a_json_object_carrying_app_version_hqptuner() -> None:
    answer = answering(200, b'{"reachable": false, "app_version": "1.16.0"}')
    assert served(answer, desktop.occupant) is Occupant.HQPTUNER


@pytest.mark.parametrize(
    "handler",
    [
        pytest.param(answering(200, b'{"reachable": false}'), id="json-object-without-app-version"),
        pytest.param(answering(200, b'["app_version"]'), id="json-array"),
        pytest.param(answering(200, b"<html><body>router login</body></html>"), id="html"),
    ],
)
def test_occupant_calls_any_other_answer_a_stranger(handler: type[BaseHTTPRequestHandler]) -> None:
    assert served(handler, desktop.occupant) is Occupant.STRANGER


def test_occupant_raises_when_the_holder_does_not_speak_http() -> None:
    with pytest.raises(httpx.RemoteProtocolError):
        served(speaking(b"SSH-2.0-OpenSSH_9.9\r\n"), desktop.occupant)


@pytest.mark.parametrize("raised", [httpx.ConnectTimeout, httpx.ReadTimeout], ids=["connect", "read"])
def test_occupant_raises_when_no_answer_comes_inside_the_timeout(raised: type[httpx.TimeoutException]) -> None:
    with pytest.raises(raised):
        desktop.occupant(f"http://{HOST}:{PORT}", get=Get(raised), knock=knocked)


def test_occupant_asks_once_with_the_probe_timeout() -> None:
    get = Get()
    desktop.occupant(f"http://{HOST}:{PORT}", get=get, knock=knocked)
    assert get.timeouts == [desktop.PROBE_TIMEOUT]


def test_answers_only_where_something_listens(closed_port: int) -> None:
    closed = desktop.answers(f"http://{HOST}:{closed_port}")
    assert (closed, served(answering(200, b""), desktop.answers)) == (False, True)


# --- the production parts ---------------------------------------------------------------------------------------


def accepts(port: int) -> bool:
    """Whether a TCP connection to ``port`` on loopback is taken."""
    try:
        socket.create_connection((HOST, port), timeout=5).close()
    except OSError:
        return False
    return True


@pytest.fixture
def listening(closed_port: int) -> Iterator[desktop.Listening]:
    """A ``Listening`` on a free loopback port, never run, its socket closed afterwards."""
    built = desktop.Listening(FastAPI(), host=HOST, port=closed_port, log_level="info", timeout_graceful_shutdown=5)
    yield built
    for sock in built.sockets:
        sock.close()


def test_a_listener_takes_connections_before_it_runs(closed_port: int, request: pytest.FixtureRequest) -> None:
    before = accepts(closed_port)
    request.getfixturevalue("listening")
    assert (before, accepts(closed_port)) == (False, True)


def test_exit_asks_the_bound_server_to_stop(listening: desktop.Listening) -> None:
    before = listening.server.should_exit
    listening.exit()
    assert (before, listening.server.should_exit) == (False, True)


def test_the_server_thread_is_an_unstarted_daemon() -> None:
    thread = desktop.daemon_thread(lambda: None)
    assert (thread.daemon, thread.is_alive()) == (True, False)
