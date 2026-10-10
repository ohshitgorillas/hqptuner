"""Characterization of five modules' less-travelled branches, each driven
through its public entry point against the fake control daemon or plain bytes.

The matrix-scope helpers take config bytes and hand back bytes or a span; the
rescan replay, the live lane's chain memory and the live snapshot run on a
manager connected to the fake daemon; the control client is driven against a
raw socket where the fake's framing is the thing under test.
"""

import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Any
from xml.etree import ElementTree as ET

import pytest
from conftest import DaemonFactory, LiveManager
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.conf.matrixscope import find_matrix_body_span, has_profile, matrix_body_span, matrix_scope
from hqptuner.conf.xmledit import GroundingError
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError
from hqptuner.engine.frames import parse_frame
from hqptuner.lanes.live.lane import mode_then_split, reassert_chain, remember_routed
from hqptuner.lanes.live.snapshot import ChainUnknownError, live_snapshot
from hqptuner.lanes.rescan import ReplayOutcome, ReplayResult, replay
from hqptuner.lanes.writer import LiveWriteOk, LiveWriteOutcome

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


def test_matrix_scope_returns_the_whole_snapshot_unscoped() -> None:
    assert matrix_scope(XML0, None) == XML0


@pytest.mark.parametrize(("body", "kept"), [(b"<a/>", True), (b"<b/>", False)], ids=["A's body", "B's body"])
def test_matrix_scope_to_one_profile_keeps_only_that_profiles_body(body: bytes, *, kept: bool) -> None:
    assert (body in matrix_scope(XML0, "A")) is kept


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


#: What ``_found_body`` answers where the locator found no body: a ``str``, so no
#: bytes the span could select from a snapshot can ever equal it.
NO_BODY = "no body found"


def _found_body(xml: bytes) -> bytes | str:
    """The bytes the found span selects from ``xml``, or ``NO_BODY`` where no body was found."""
    span = find_matrix_body_span(xml)
    return NO_BODY if span is None else xml[span[0] : span[1]]


@pytest.mark.parametrize(
    ("xml", "body"), [(b"<matrix><a/></matrix>", b"<a/>"), (b"<matrix/>", NO_BODY)], ids=["body", "self-closing"]
)
def test_find_matrix_body_span_locates_the_body_and_answers_absent_without_raising(
    xml: bytes, body: bytes | str
) -> None:
    assert _found_body(xml) == body


# --- rescan replay -------------------------------------------------------------


@pytest.fixture
async def dead_manager(closed_port: int, clock: VirtualClock) -> AsyncIterator[ConnectionManager]:
    """A running manager whose control lane points at a port nothing listens on."""
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=closed_port), clock=clock)
    task = clock.spawn(manager.run())
    yield manager
    manager.stop()
    await task
    await manager.aclose()


async def _loaded(manager: ConnectionManager) -> dict[str, Any]:
    """Spin on the loop — never a wall-clock wait — until the manager's first
    load has landed, and hand back the live snapshot it read. The bound turns
    a manager that never connects into a loud failure."""
    for _ in range(100_000):
        try:
            return dict(live_snapshot(manager).fields)
        except ChainUnknownError:
            await asyncio.sleep(0)
    raise FixtureError(reason="the manager never loaded the fake engine")


async def test_a_replay_with_no_daemon_says_the_engine_is_gone(dead_manager: ConnectionManager) -> None:
    assert (await replay(dead_manager, dict(DITHER_NS9))).outcome is ReplayOutcome.UNREACHABLE


async def _replayed(live_manager: LiveManager, overrides: dict[str, str], fields: dict[str, str]) -> ReplayResult:
    """Replay ``fields`` onto a loaded manager whose fake daemon carries ``overrides``."""
    manager, _log, _state = await live_manager(**overrides)
    await _loaded(manager)
    return await replay(manager, dict(fields))


async def test_a_replay_of_fields_the_engine_already_holds_warns_of_nothing(live_manager: LiveManager) -> None:
    assert (await _replayed(live_manager, {}, {"dither": "0"})).outcome is ReplayOutcome.NOTHING_TO_RESTORE


async def test_a_replay_the_daemon_refuses_warns_of_the_loss(live_manager: LiveManager) -> None:
    assert (await _replayed(live_manager, {"_error": "SetShaping"}, DITHER_NS9)).outcome is ReplayOutcome.WRITE_FAILED


async def test_a_replay_whose_readback_disagrees_warns_of_the_loss(live_manager: LiveManager) -> None:
    assert (await _replayed(live_manager, {"_deaf": "SetShaping"}, DITHER_NS9)).outcome is ReplayOutcome.WRITE_FAILED


async def _replayed_on(
    live_manager: LiveManager, dead_manager: ConnectionManager, overrides: dict[str, str] | None, fields: dict[str, str]
) -> ReplayResult:
    """Replay ``fields`` onto a loaded manager whose fake daemon carries ``overrides``, or, where
    ``overrides`` is None, onto the manager with no daemon behind it."""
    if overrides is None:
        return await replay(dead_manager, dict(fields))
    return await _replayed(live_manager, overrides, fields)


#: What a replay reports restored: the field whose setter verified, and nothing
#: where the daemon is gone, or the engine already held it, refused it, or read
#: back something else.
RESTORED_FIELDS = [
    pytest.param({}, DITHER_NS9, DITHER_NS9, id="verified"),
    pytest.param(None, DITHER_NS9, {}, id="no-daemon"),
    pytest.param({}, {"dither": "0"}, {}, id="already-held"),
    pytest.param({"_error": "SetShaping"}, DITHER_NS9, {}, id="refused"),
    pytest.param({"_deaf": "SetShaping"}, DITHER_NS9, {}, id="readback-disagrees"),
]


@pytest.mark.parametrize(("overrides", "fields", "restored"), RESTORED_FIELDS)
async def test_a_replay_reports_restored_only_the_fields_whose_setter_verified(
    live_manager: LiveManager,
    dead_manager: ConnectionManager,
    overrides: dict[str, str] | None,
    fields: dict[str, str],
    restored: dict[str, str],
) -> None:
    assert (await _replayed_on(live_manager, dead_manager, overrides, fields)).restored == restored


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
async def manager_and_client(
    daemon: DaemonFactory, clock: VirtualClock
) -> AsyncIterator[tuple[ConnectionManager, ControlClient]]:
    """A running manager on a fake daemon, plus a second control connection to
    that same daemon (its State is shared across connections), for the lane
    entry points that take the client to write through as an argument."""
    port, _log, _state = await daemon()
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port), clock=clock)
    task = clock.spawn(manager.run())
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield manager, client
    await client.close()
    manager.stop()
    await task
    await manager.aclose()


async def _reasserted(
    manager_and_client: tuple[ConnectionManager, ControlClient], remembered: str
) -> list[tuple[str, LiveWriteOutcome]]:
    """Reassert a PCM chain remembering ``dither`` at ``remembered``; each setter sent, with its outcome."""
    manager, client = manager_and_client
    await _loaded(manager)
    manager.readings.live.chain["pcm"] = {"dither": remembered}
    return [(r.setting, r.outcome) for r in await reassert_chain(manager, client)]


@pytest.mark.parametrize(
    ("remembered", "sent"),
    [
        pytest.param("5", [("shaper", LiveWriteOutcome.OK)], id="value-on-the-list"),
        pytest.param("999", [], id="value-off-the-list"),
    ],
)
async def test_reasserting_a_chain_sends_a_listed_value_and_not_an_unlisted_one(
    manager_and_client: tuple[ConnectionManager, ControlClient],
    remembered: str,
    sent: list[tuple[str, LiveWriteOutcome]],
) -> None:
    assert await _reasserted(manager_and_client, remembered) == sent


@pytest.mark.parametrize(
    ("remembered", "kept"),
    [
        pytest.param("5", {"dither": "5"}, id="value-on-the-list"),
        pytest.param("999", {}, id="value-off-the-list-is-dropped"),
    ],
)
async def test_reasserting_a_chain_keeps_a_listed_value_and_forgets_an_unlisted_one(
    manager_and_client: tuple[ConnectionManager, ControlClient],
    remembered: str,
    kept: dict[str, str],
) -> None:
    await _reasserted(manager_and_client, remembered)
    assert manager_and_client[0].readings.live.chain["pcm"] == kept


def _readings(
    manager: ConnectionManager,
) -> tuple[dict[str, str], dict[str, str], dict[str, list[dict[str, str]]]]:
    """The manager's state, status and enums, each present after a load."""
    state = manager.readings.state
    status = manager.readings.status
    enums = manager.readings.enums
    if state is None or status is None or enums is None:
        raise FixtureError(reason="readings not loaded")
    return state, status, enums


def _no_chain(manager: ConnectionManager) -> ConnectionManager:
    """The same manager with its readings naming no active chain: the mode at
    ``[source]`` and the status frame carrying neither active_mode nor
    active_rate."""
    state, status, _enums = _readings(manager)
    state["mode"] = "0"
    status.pop("active_mode", None)
    status.pop("active_rate", None)
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
    remember_routed(reshape(manager), [LiveWriteOk(setting="shaper")], dict(DITHER_NS9))
    assert manager.readings.live.chain == expected


# --- the live snapshot ---------------------------------------------------------


async def test_a_field_the_enumeration_cannot_name_is_left_out_of_the_snapshot(live_manager: LiveManager) -> None:
    manager, _log, _state = await live_manager()
    before = await _loaded(manager)
    state, _status, enums = _readings(manager)
    state["mode"] = "99"  # a mode index no enumerated mode carries
    del state["shaper"]  # a routable field's state attribute gone
    next(item for item in enums["filters"] if item["index"] == "0").pop("value")
    del state["adaptive"]
    after = live_snapshot(manager).fields
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
    assert (await split_reply_client.request("<State/>")).attrib == {"result": "OK"}


def _attrib(el: ET.Element | None) -> dict[str, str]:
    """The root's attributes, or none where nothing parsed."""
    return dict(el.attrib) if el is not None else {}


def test_parse_frame_recovers_the_root_from_a_complete_frame_with_unparseable_children() -> None:
    body = '<Status result="OK"><metadata artist="Foo "Bar""/></Status>'
    assert _attrib(parse_frame(body, "Status")) == {"result": "OK"}


def test_parse_frame_recovers_the_root_from_a_frame_with_an_unescaped_ampersand_attribute() -> None:
    body = '<Status result="Rock & Roll"/>'
    assert _attrib(parse_frame(body, "Status")) == {"result": "Rock & Roll"}


def test_parse_frame_raises_control_error_on_a_frame_carrying_an_entity_declaration() -> None:
    body = '<!DOCTYPE x [<!ENTITY a "b">]><Status result="OK"/>'
    with pytest.raises(ControlError):
        parse_frame(body, "Status")
