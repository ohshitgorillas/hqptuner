"""Shared fixtures: a stateful fake hqplayerd speaking real Control API XML
over a real socket (docs/testing.md — fakes speak the wire protocol).

The fake keeps a per-connection settings dict and answers setters + State from
it, so a `Set*` followed by `State` reads back the change — enough to exercise
the readback-verify path. Two quirks are modelled for the write-path tests:
`value="999"` returns `result="OK"` without applying (the OK-but-not-applied
caveat, protocol.md §6); `value="err"` returns `result="Error"`; and `SetMode`
resets `rate` to `0` (mode swaps the lists rate is relative to), which lets a
test prove apply order (mode before rate).

The port-8088 HTTP fake lives in `fake_http`; its fixtures are at the bottom."""

import asyncio
import functools
import socket
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from defusedxml.ElementTree import fromstring as _fromstring
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.control import ControlClient
from hqptuner.manager import ConnectionManager

XML = '<?xml version="1.0" encoding="UTF-8"?>'


@pytest.fixture(autouse=True)
def virtual_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retry/verify loops pay their waits in virtual time, not wall clock.

    Every lane deadline loop is paced by `ConnectionManager.sleep` against a
    deadline read from `ConnectionManager.monotonic` — the two public seams the
    lanes are written to. Here `sleep` advances an offset that `monotonic` reads
    back, so a loop still runs the same iterations against the fake daemon and
    still exits on the same condition, without the seconds. Real sleeps cost the
    offline suite ~80 s of its 84 s.

    The manager's own poll loop is deliberately left on the wall clock: `run()`
    paces on the private stop-event wait (`_sleep`), which this does not touch,
    so a running manager does not spin."""
    offset = 0.0

    async def sleep(_self: ConnectionManager, seconds: float) -> None:
        nonlocal offset
        offset += seconds
        await asyncio.sleep(0)  # still yield: concurrent tasks must interleave

    def monotonic(_self: ConnectionManager) -> float:
        return time.monotonic() + offset

    monkeypatch.setattr(ConnectionManager, "sleep", sleep)
    monkeypatch.setattr(ConnectionManager, "monotonic", monotonic)


_DEFAULTS = {
    "state": "0",
    "mode": "1",
    "filter1x": "0",
    "filterNx": "0",
    "shaper": "0",
    "rate": "0",
    "filter_junk": "0",
    "adaptive": "0",
    "volume": "-10.0",
    "matrix_profile": "",
    # underscore keys are internal to the fake (VolumeRange source), not emitted in State
    "_vol_min": "-60",
    "_vol_max": "0",
    "_vol_enabled": "1",
    "_vol_adaptive": "0",
    "_metadata": "",  # optional <metadata> child injected into the Status frame
    # Status reports the mode the engine is RUNNING as a display string, which is
    # not always the configured one: in [source] mode it follows the source. The
    # string is the same one GetModes gives that mode — verified against the live
    # daemon (hqplayerd 6.0.4, 2026-07-27): configured mode 2 reports
    # active_mode="SDM (DSD)", byte-identical to ModesItem index 2.
    "_active_mode": "PCM",
}


def _apply(name: str, attrs: dict[str, str], state: dict[str, str]) -> None:
    value = attrs.get("value", "")
    if name == "SetMode":
        state["mode"] = value
        state["rate"] = "0"  # mode resets rate to auto (protocol.md §6)
    elif name == "SetFilter":
        state["filterNx"] = value
        state["filter1x"] = attrs.get("value1x", value)
    elif name == "SetShaping":
        state["shaper"] = value
    elif name == "SetRate":
        state["rate"] = value
    elif name == "SetJunkFilter":
        state["filter_junk"] = value
    elif name == "SetAdaptiveVolume":
        state["adaptive"] = value
    elif name == "Volume":
        state["volume"] = value
    elif name == "MatrixSetProfile":
        state["matrix_profile"] = value  # live switch; State reports it back


# Enumerations are MODE-DEPENDENT on the real daemon: GetFilters/GetShapers
# answer for the ACTIVE mode only, and the two chains number their enum IDs
# differently — poly-sinc-gauss-long is enum 40 under PCM `filter` and 38 under
# SDM `oversampling` (protocol.md §4, readme §1.5/§1.6). The fake models both
# facts because the live-routing chain gate exists precisely to protect them.
_MODES = (("0", "[source]", "-1"), ("1", "PCM", "0"), ("2", "SDM (DSD)", "1"))
_PCM_FILTERS = (("0", "none", "0"), ("1", "poly-sinc-gauss-long", "40"), ("2", "sinc-M", "25"))
_SDM_FILTERS = (("0", "poly-sinc-gauss-long", "38"), ("1", "sinc-M", "23"))
_PCM_SHAPERS = (("0", "none", "0"), ("1", "NS9", "5"))
_SDM_SHAPERS = (("0", "ASDM5", "0"), ("1", "ASDM7EC", "3"))
_JUNK_FILTERS = (("0", "none", "0"), ("1", "20k", "1"), ("2", "30k", "2"))

# `RatesItem` carries no `value`: it is `<RatesItem index rate/>` with the actual
# rate in Hz and index 0 = auto (protocol.md §6). Mode-dependent for real — SDM
# mode enumerates DSD rates, PCM mode 44.1k-768k — which is why the live rate
# list has to be re-read after a mode change.
_PCM_RATES = (("0", "0"), ("1", "44100"), ("2", "352800"), ("3", "705600"))
_SDM_RATES = (("0", "0"), ("1", "2822400"), ("2", "5644800"))


def _items(tag: str, rows: tuple[tuple[str, str, str], ...]) -> str:
    return "".join(f'<{tag} index="{i}" name="{n}" value="{v}"/>' for i, n, v in rows)


def _rate_items(rows: tuple[tuple[str, str], ...]) -> str:
    return "".join(f'<RatesItem index="{i}" rate="{r}"/>' for i, r in rows)


def _enumeration(name: str, state: dict[str, str]) -> str | None:
    """GetModes/GetFilters/GetShapers, scoped to the mode the fake is in."""
    sdm = state.get("mode") == "2"
    if name == "GetModes":
        return f"<GetModes>{_items('ModesItem', _MODES)}</GetModes>"
    if name == "GetFilters":
        return f"<GetFilters>{_items('FiltersItem', _SDM_FILTERS if sdm else _PCM_FILTERS)}</GetFilters>"
    if name == "GetShapers":
        return f"<GetShapers>{_items('ShapersItem', _SDM_SHAPERS if sdm else _PCM_SHAPERS)}</GetShapers>"
    if name == "GetRates":
        return f"<GetRates>{_rate_items(_SDM_RATES if sdm else _PCM_RATES)}</GetRates>"
    if name == "GetJunkFilters":
        return f"<GetJunkFilters>{_items('JunkFiltersItem', _JUNK_FILTERS)}</GetJunkFilters>"
    return None


def _query(name: str, state: dict[str, str]) -> str | None:
    """Read-only commands answered from state; None for setters."""
    enumerated = _enumeration(name, state)
    if enumerated is not None:
        return enumerated
    if name == "GetInfo":
        return '<GetInfo name="Fake" engine="6.0.4" version="6"/>'
    if name == "GetLicense":
        return '<GetLicense valid="1" name="Fake Licensee" fingerprint="AAAA"/>'
    if name == "ConfigurationGet":
        return f'<ConfigurationGet result="OK" value="{state.get("_active_config", "")}"/>'
    if name == "MatrixListProfiles":
        items = "".join(f'<MatrixProfile name="{n}"/>' for n in ("Default", "Mch-to-Stereo mixdown"))
        return f'<MatrixListProfiles result="OK">{items}</MatrixListProfiles>'
    if name == "MatrixGetProfile":
        return f'<MatrixGetProfile result="OK" value="{state.get("_matrix_profile", "")}"/>'
    if name == "State":
        return "<State " + " ".join(f'{k}="{v}"' for k, v in state.items() if not k.startswith("_")) + "/>"
    if name == "VolumeRange":
        return (
            f'<VolumeRange min="{state["_vol_min"]}" max="{state["_vol_max"]}" '
            f'enabled="{state["_vol_enabled"]}" adaptive="{state["_vol_adaptive"]}"/>'
        )
    if name == "Status":
        # active_* live on the Status root; the track <metadata> child is where the
        # daemon emits unescaped chars mid-playback (_metadata override).
        return (
            f'<Status state="{state["state"]}" active_mode="{state["_active_mode"]}" '
            f'active_filter="poly-sinc-gauss-long" active_shaper="NS9" '
            f'active_rate="192000" volume="{state["volume"]}">'
            f'{state["_metadata"]}</Status>'
        )
    return None


def _handle(body: str, state: dict[str, str]) -> str:
    el = _fromstring(body)
    name, attrs = el.tag, el.attrib
    answer = _query(name, state)
    if answer is not None:
        return answer
    if name == "Volume" and state["_vol_enabled"] == "0":
        return '<Volume result="Error"/>'  # volume control disabled (protocol.md §6)
    value = attrs.get("value")
    if value == "err":
        return f'<{name} result="Error">bad value</{name}>'
    if value != "999":  # 999 = OK but not applied (readback-verify caveat)
        _apply(name, attrs, state)
    return f'<{name} result="OK"/>'


async def _serve(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    overrides: dict[str, str] | None = None,
) -> None:
    state = {**_DEFAULTS, **(overrides or {})}
    while True:
        data = await reader.read(4096)
        if not data:
            break
        body = data.split(b"?>", 1)[-1].strip().decode()
        writer.write(f"{XML}{_handle(body, state)}\n".encode())
        await writer.drain()


@pytest.fixture
async def live_daemon_port() -> AsyncIterator[int]:
    server = await asyncio.start_server(_serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    yield port
    server.close()
    await server.wait_closed()


@pytest.fixture
async def split_filter_daemon_port() -> AsyncIterator[int]:
    """Daemon whose 1x and Nx filter slots DIFFER (1x=2, Nx=0). The default fake
    has both at index 0, where a preserved sibling and a clobbered one are the
    same value — so any test of the one-sided SetFilter case needs this one."""
    serve = functools.partial(_serve, overrides={"filter1x": "2", "filterNx": "0"})
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    yield port
    server.close()
    await server.wait_closed()


@pytest.fixture
async def live_client(live_daemon_port: int) -> AsyncIterator[ControlClient]:
    client = ControlClient("127.0.0.1", live_daemon_port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()


@pytest.fixture
async def garbled_metadata_client() -> AsyncIterator[ControlClient]:
    """Daemon whose Status carries a track <metadata> child with unescaped chars
    — the real 6.0.4 quirk that hangs a strict receiver during playback. A bare
    '<' inside an attribute can't be repaired by the bare-'&' fix, so the root's
    active_* must be recovered by dropping the child (control.py _recover_root)."""
    bad = '<metadata artist="A&B" album="Foo <Bar> Baz"/>'
    serve = functools.partial(_serve, overrides={"_metadata": bad})
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


@pytest.fixture
async def disabled_volume_client() -> AsyncIterator[ControlClient]:
    """A fake daemon with volume control disabled (VolumeRange enabled=0), so a
    Volume write is rejected — the live-slider gray/error case."""
    serve = functools.partial(_serve, overrides={"_vol_enabled": "0"})
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


# --- the same control-daemon fake, served from a background thread ----------
# `TestClient` runs the app (and its ConnectionManager) inside its own thread's
# event loop, where the in-loop asyncio fakes above are unreachable: their
# server only accepts while the test's loop is running, and it is parked for
# the duration of a sync test body. These serve the identical `_serve` protocol
# from a dedicated thread over real TCP, reachable from any loop.


def spawn_threaded_daemon(overrides: dict[str, str] | None = None) -> Iterator[int]:
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    serve = functools.partial(_serve, overrides=overrides)
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(serve, "127.0.0.1", 0), loop).result()
    port: int = server.sockets[0].getsockname()[1]
    yield port
    loop.call_soon_threadsafe(server.close)
    asyncio.run_coroutine_threadsafe(server.wait_closed(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()


@pytest.fixture
def threaded_daemon_port() -> Iterator[int]:
    yield from spawn_threaded_daemon()


@pytest.fixture
def threaded_disabled_volume_port() -> Iterator[int]:
    """Threaded daemon with volume control disabled — a Volume write is refused."""
    yield from spawn_threaded_daemon({"_vol_enabled": "0"})


# --- fake HTTP config daemon (port 8088 lane), implemented in fake_http ---


@pytest.fixture
def http_daemon() -> Iterator[dict[str, Any]]:
    yield from fake_http.spawn(fake_http.state())


@pytest.fixture
def stale_http_daemon() -> Iterator[dict[str, Any]]:
    # serves the pre-restart archive for one backup read before catching up
    yield from fake_http.spawn(fake_http.state(_lag=1))


@pytest.fixture
def clamping_http_daemon() -> Iterator[dict[str, Any]]:
    # rewrites the startup volume into the volume range on every restore, so a
    # field no apply ever stages comes back different from what was uploaded
    yield from fake_http.spawn(fake_http.state(_clamps=True, defaults_volume="-60", volume_min="-40"))


@pytest.fixture
def dying_http_daemon() -> Iterator[dict[str, Any]]:
    # accepts the restore, then goes unreachable and never returns
    yield from fake_http.spawn(fake_http.state(_die=True))


@pytest.fixture
def restore_refusing_http_daemon() -> Iterator[dict[str, Any]]:
    # refuses every POST /restore: the daemon that is still restarting when a
    # write lands on it and never recovers inside the deadline
    yield from fake_http.spawn(fake_http.state(_restore_refusals=99))


@pytest.fixture
def restore_recovering_http_daemon() -> Iterator[dict[str, Any]]:
    # refuses the first two POST /restore arrivals, then accepts — the restart
    # window a retrying lane is supposed to ride through
    yield from fake_http.spawn(fake_http.state(_restore_refusals=2))


# --- a manager wired to the fake HTTP config daemon -------------------------

ManagerFactory = Callable[..., ConnectionManager]


@pytest.fixture
async def http_manager_factory(tmp_path: Path) -> AsyncIterator[ManagerFactory]:
    """Build managers on a fake 8088 daemon, closing every client at teardown.

    Six write-lane suites each hand-rolled this. The daemon is an argument
    because the outage suites want the ``dying``/``stale`` variants; keyword
    arguments override the Config for the suites that need a different one (a
    longer ``alarm_threshold`` for the stale-readback case, ``hqp_home`` for the
    filter-upload path assertions).

    ``alarm_threshold`` defaults to 1.0 so a rejected apply gives up after a
    couple of virtual polls rather than the production 15 s window; the backup
    and preset directories land in ``tmp_path``, never in the repo.
    """
    clients: list[HttpConfigClient] = []

    def build(daemon: dict[str, Any], **overrides: Any) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
        clients.append(http)
        defaults: dict[str, Any] = {
            "alarm_threshold": 1.0,
            "backup_dir": tmp_path,
            "preset_dir": tmp_path / "presets",
        }
        return ConnectionManager(Config(**{**defaults, **overrides}), http)

    yield build
    for http in clients:
        await http.aclose()


@pytest.fixture
def http_manager(http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]) -> ConnectionManager:
    """The common case: one manager on the healthy fake daemon."""
    return http_manager_factory(http_daemon)


@pytest.fixture
def clamping_manager(http_manager_factory: ManagerFactory, clamping_http_daemon: dict[str, Any]) -> ConnectionManager:
    """A manager whose daemon rewrites a setting the user never staged."""
    return http_manager_factory(clamping_http_daemon)


# --- the REST app under test ------------------------------------------------


def _closed_port() -> int:
    """A port nothing listens on: bind one, read the number, hand back the hole."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port


@pytest.fixture
def closed_port() -> int:
    return _closed_port()


@pytest.fixture
def api_client() -> Iterator[TestClient]:
    """The REST surface with no daemon behind it (control lane at a closed port,
    no credentials) — for the routes whose behavior is guards and buffering
    rather than daemon traffic."""
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=_closed_port())
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


@pytest.fixture
def http_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """The REST surface with its http lane wired to the faithful fake 8088
    daemon; control lane at a closed port (http-only operations never touch it).
    Small alarm so a rejected apply times out fast; backups, presets, and parked
    filters land in tmp, never in the repo; `hqp_home` is pinned so filter-upload
    path assertions read verbatim."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        hqp_home="/x/home",
    )
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


def wait_for_api(client: TestClient, ready: Callable[[TestClient], bool], tries: int = 10_000) -> None:
    """Spin on real requests — never a wall-clock sleep — until the app under
    test reports ready. The app's ConnectionManager loads from the fakes inside
    the client's own loop, which progresses between requests, so this converges
    in a handful of passes; the bound only turns a hang into a loud failure."""
    for _ in range(tries):
        if ready(client):
            return
    pytest.fail("app never became ready against the fake daemons")
