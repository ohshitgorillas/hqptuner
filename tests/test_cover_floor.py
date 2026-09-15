"""Characterization of five modules' less-travelled branches, each driven
through its public entry point against the fake control daemon or plain bytes
(docs/testing.md: one condition per test, public API only, fakes speak the
wire).

The matrix-scope helpers take config bytes and hand back bytes or a span; the
rescan replay, the live lane's chain memory and the live snapshot run on a
manager connected to the fake daemon; the control client is driven against a
raw socket where the fake's framing is the thing under test.
"""

import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest
from conftest import DaemonFactory, LiveManager

from hqptuner.conf.matrixscope import has_profile, matrix_body_span, matrix_scope
from hqptuner.conf.xmledit import GroundingError
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlClient, ControlError
from hqptuner.lanes.live.lane import mode_then_split, reassert_chain, remember_routed
from hqptuner.lanes.live.snapshot import live_snapshot
from hqptuner.lanes.rescan import NO_DAEMON, WRITE_FAILED, replay

#: A snapshot holding two stored profiles, each with a body of its own.
XML0 = (
    b"<hqplayerd><engine><matrix>"
    b'<matrix_profile name="A"><a/></matrix_profile>'
    b'<matrix_profile name="B"><b/></matrix_profile>'
    b"</matrix></engine></hqplayerd>"
)

#: The same snapshot with profile A stored bodyless (self-closing).
XML1 = (
    b"<hqplayerd><engine><matrix>"
    b'<matrix_profile name="A"/>'
    b'<matrix_profile name="B"><b/></matrix_profile>'
    b"</matrix></engine></hqplayerd>"
)

#: The live field the fake's PCM shaper list resolves: enum ID "5" is NS9 at
#: list index "1"; enum ID "0" is none at index "0"; "999" is on no list.
DITHER_NS9 = {"dither": "5"}


# --- matrixscope ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("profile", "expected"),
    [
        pytest.param(None, (True, True, True), id="unscoped-is-identity"),
        pytest.param("A", (False, True, False), id="scoped-to-A-drops-B"),
    ],
)
def test_matrix_scope_returns_the_whole_snapshot_unscoped_and_one_profiles_body_scoped(
    profile: str | None, expected: tuple[bool, bool, bool]
) -> None:
    out = matrix_scope(XML0, profile)
    assert (out == XML0, b"<a/>" in out, b"<b/>" in out) == expected


@pytest.mark.parametrize(("name", "expected"), [("B", True), ("Z", False)])
def test_has_profile_reports_only_the_profiles_the_snapshot_carries(name: str, *, expected: bool) -> None:
    assert has_profile(XML0, name) is expected


def _body_or_error(locate: Callable[[], bytes | tuple[int, int]], xml: bytes) -> bytes | type[GroundingError]:
    """The bytes the located span selects from ``xml``, or the error class the
    locator raised: one value either way, so a sweep can compare it."""
    try:
        located = locate()
    except GroundingError:
        return GroundingError
    if isinstance(located, bytes):
        return located
    start, end = located
    return xml[start:end]


@pytest.mark.parametrize(
    ("xml", "locate", "expected"),
    [
        pytest.param(
            b"<matrix><a/></matrix>",
            lambda: matrix_body_span(b"<matrix><a/></matrix>"),
            b"<a/>",
            id="body-present",
        ),
        pytest.param(b"<matrix/>", lambda: matrix_body_span(b"<matrix/>"), GroundingError, id="self-closing"),
        pytest.param(b"<matrix>", lambda: matrix_body_span(b"<matrix>"), GroundingError, id="unclosed"),
        pytest.param(XML1, lambda: matrix_scope(XML1, "A"), GroundingError, id="bodyless-profile"),
    ],
)
def test_matrix_body_span_selects_the_body_and_refuses_a_bodyless_element(
    xml: bytes, locate: Callable[[], bytes | tuple[int, int]], expected: bytes | type[GroundingError]
) -> None:
    assert _body_or_error(locate, xml) == expected


# --- rescan replay -------------------------------------------------------------


@pytest.fixture
async def dead_manager(closed_port: int) -> AsyncIterator[ConnectionManager]:
    """A running manager whose control lane points at a port nothing listens on."""
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=closed_port))
    task = asyncio.create_task(manager.run())
    yield manager
    manager.stop()
    await task
    await manager.aclose()


async def _loaded(manager: ConnectionManager) -> dict[str, Any]:
    """Spin on the loop — never a wall-clock wait — until the manager's first
    load has landed, and hand back the live snapshot it read. The bound turns
    a manager that never connects into a loud failure."""
    for _ in range(100_000):
        snapshot = live_snapshot(manager)
        if snapshot is not None:
            return dict(snapshot)
        await asyncio.sleep(0)
    raise AssertionError("the manager never loaded the fake engine")


async def test_a_replay_with_no_daemon_restores_nothing_and_says_the_engine_is_gone(
    dead_manager: ConnectionManager,
) -> None:
    assert await replay(dead_manager, dict(DITHER_NS9)) == {"restored": {}, "warning": NO_DAEMON}


async def test_a_replay_of_fields_the_engine_already_holds_restores_nothing_and_warns_of_nothing(
    live_manager: LiveManager,
) -> None:
    manager, _log, _state = await live_manager()
    await _loaded(manager)
    assert await replay(manager, {"dither": "0"}) == {"restored": {}}


async def test_a_replay_the_daemon_refuses_restores_nothing_and_warns_of_the_loss(
    live_manager: LiveManager,
) -> None:
    manager, _log, _state = await live_manager(_error="SetShaping")
    await _loaded(manager)
    assert await replay(manager, dict(DITHER_NS9)) == {"restored": {}, "warning": WRITE_FAILED}


async def test_a_replay_whose_readback_disagrees_restores_nothing_and_warns_of_the_loss(
    live_manager: LiveManager,
) -> None:
    manager, _log, _state = await live_manager(_deaf="SetShaping")
    await _loaded(manager)
    assert await replay(manager, dict(DITHER_NS9)) == {"restored": {}, "warning": WRITE_FAILED}


# --- the live lane's restore tail and chain memory ----------------------------


@pytest.mark.parametrize(
    ("http_fields", "expected"),
    [
        pytest.param(
            {"mode": "pcm", "not_routable_field": "x"},
            ([], {}, {"mode": "pcm", "not_routable_field": "x"}),
            id="mode-stays-in-the-remainder",
        ),
        pytest.param({"mode": "pcm", "dither": "5"}, ([], {"shaper": {"value": "1"}}, {}), id="routable-field-splits"),
    ],
)
async def test_a_mode_the_engine_already_runs_is_skipped_and_the_rest_is_split(
    live_manager: LiveManager,
    http_fields: dict[str, str],
    expected: tuple[list[Any], dict[str, Any], dict[str, str]],
) -> None:
    manager, _log, _state = await live_manager()
    await _loaded(manager)
    assert await mode_then_split(manager, dict(http_fields), {}) == expected


@pytest.fixture
async def manager_and_client(daemon: DaemonFactory) -> AsyncIterator[tuple[ConnectionManager, ControlClient]]:
    """A running manager on a fake daemon, plus a second control connection to
    that same daemon (its State is shared across connections), for the lane
    entry points that take the client to write through as an argument."""
    port, _log, _state = await daemon()
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port))
    task = asyncio.create_task(manager.run())
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield manager, client
    await client.close()
    manager.stop()
    await task
    await manager.aclose()


@pytest.mark.parametrize(
    ("remembered", "expected"),
    [
        pytest.param("5", ([{"setting": "shaper", "ok": True}], {"dither": "5"}), id="value-on-the-list"),
        pytest.param("999", ([], {}), id="value-off-the-list-is-dropped"),
    ],
)
async def test_reasserting_a_chain_sends_a_listed_value_and_forgets_an_unlisted_one(
    manager_and_client: tuple[ConnectionManager, ControlClient],
    remembered: str,
    expected: tuple[list[Any], dict[str, str]],
) -> None:
    manager, client = manager_and_client
    await _loaded(manager)
    manager.readings.live.chain["pcm"] = {"dither": remembered}
    report = await reassert_chain(manager, client)
    assert (report, manager.readings.live.chain["pcm"]) == expected


def _no_chain(manager: ConnectionManager) -> ConnectionManager:
    """The same manager with its readings naming no active chain: the mode at
    ``[source]`` and the status frame carrying neither active_mode nor
    active_rate."""
    manager.readings.state["mode"] = "0"
    manager.readings.status.pop("active_mode", None)
    manager.readings.status.pop("active_rate", None)
    return manager


@pytest.mark.parametrize(
    ("reshape", "expected"),
    [
        pytest.param(lambda manager: manager, {"pcm": {"dither": "5"}}, id="active-chain-records"),
        pytest.param(_no_chain, {}, id="no-chain-records-nothing"),
    ],
)
async def test_routed_fields_are_remembered_under_the_active_chain_only(
    live_manager: LiveManager,
    reshape: Callable[[ConnectionManager], ConnectionManager],
    expected: dict[str, dict[str, str]],
) -> None:
    manager, _log, _state = await live_manager()
    await _loaded(manager)
    remember_routed(reshape(manager), [{"setting": "shaper", "ok": True}], dict(DITHER_NS9))
    assert manager.readings.live.chain == expected


# --- the live snapshot ---------------------------------------------------------


async def test_a_field_the_enumeration_cannot_name_is_left_out_of_the_snapshot(live_manager: LiveManager) -> None:
    manager, _log, _state = await live_manager()
    before = await _loaded(manager)
    state = manager.readings.state
    state["mode"] = "99"  # a mode index no enumerated mode carries
    del state["shaper"]  # a routable field's state attribute gone
    next(item for item in manager.readings.enums["filters"] if item["index"] == "0").pop("value")
    del state["adaptive"]
    after = live_snapshot(manager) or {}
    assert sorted(before) == sorted([*after, "adaptive_volume", "dither", "filter", "filter1x", "mode"])


# --- the control client --------------------------------------------------------


async def _request_error_code(client: ControlClient) -> str:
    """The code of the ControlError a request raised, or "" for no raise."""
    try:
        await client.request("<GetInfo/>")
    except ControlError as exc:
        return str(exc.code)
    return ""


async def test_a_request_before_connect_is_refused_as_daemon_unavailable(closed_port: int) -> None:
    client = ControlClient("127.0.0.1", closed_port)
    assert await _request_error_code(client) == "daemon_unavailable"


async def _serve_split(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """A daemon whose reply arrives in two pieces, the first cut mid-tag."""
    await reader.read(4096)
    writer.write(b"<Sta")
    await writer.drain()
    writer.write(b'te result="OK"/>\n')
    await writer.drain()


@pytest.fixture
async def split_reply_client() -> AsyncIterator[ControlClient]:
    server = await asyncio.start_server(_serve_split, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


async def test_a_reply_cut_mid_tag_is_read_to_its_end_before_parsing(split_reply_client: ControlClient) -> None:
    el = await split_reply_client.request("<State/>")
    assert (el.tag, el.attrib) == ("State", {"result": "OK"})
