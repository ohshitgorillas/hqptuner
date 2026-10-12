"""A live write whose control connection dies before its readback still leaves its audit row.

Every attempted live write is supposed to be on the record, including one whose
connection died, with what is known at that point: the setting, the value sent,
and that nothing came back to verify it. Each case drives the real REST surface
against a threaded fake 4321 daemon whose setter is answered, after which the
next ``State`` is received and the connection dropped under it (the fake's
``_close`` knob, armed by a hook on the setter's arrival so every read before the
write is answered normally). The rows are read back over ``GET /api/audit``,
whose ``fields`` bag is the event vocabulary's public shape.
"""

import contextlib
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from apps import wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import DEFAULTS, CommandHooks, CommandLog, OnNextArrival
from fastapi.testclient import TestClient
from fixtures_clients import app

#: The command a write is read back by, which the fake drops the connection on.
READBACK = "State"

#: The level written, inside the fake's default volume range and off its resting -10.0.
LEVEL = "-24.5"

#: A noise-shaper index the fake's State reports back as written.
SHAPER = "5"

#: A main-filter value the live route accepts.
FILTER = "25"

LIVE_WRITE = "live.write"
VOLUME_WRITE = "volume.write"


class Drive(NamedTuple):
    """One way to reach the live lane: the setter command it puts on the wire, and
    the REST calls that put it there."""

    setter: str
    run: Callable[[TestClient], None]


def live_batch_filter(client: TestClient) -> None:
    client.post("/api/config/live", json={"fields": {"filter": FILTER}})


def staged_apply_shaper(client: TestClient) -> None:
    client.post("/api/config/stage", json={"live": {"shaper": {"value": SHAPER}}})
    client.post("/api/config/apply")


def volume_endpoint(client: TestClient) -> None:
    client.post("/api/volume", json={"level": LEVEL})


def staged_apply_volume(client: TestClient) -> None:
    client.post("/api/config/stage", json={"live": {"volume": {"value": LEVEL}}})
    client.post("/api/config/apply")


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


#: Build the app on a fresh threaded fake 4321 daemon and return the client and
#: the daemon's command log. With ``drop`` the connection dies on the first
#: ``State`` after ``setter`` arrives; without it every command is answered, the
#: same write with its readback arriving.
Factory = Callable[..., tuple[TestClient, CommandLog]]


@pytest.fixture
def control_client(http_daemon: dict[str, Any], tmp_path: Path, audit_log: Path) -> Iterator[Factory]:
    stack = contextlib.ExitStack()

    def build(setter: str, *, drop: bool) -> tuple[TestClient, CommandLog]:
        engine = dict(DEFAULTS)
        log: CommandLog = []

        def arm() -> None:
            engine["_close"] = READBACK

        hooks: CommandHooks = {setter: OnNextArrival(arm)} if drop else {}
        ports = spawn_threaded_daemon(state=engine, log=log, hooks=hooks)
        port = next(ports)
        stack.callback(next, ports, None)
        clients = app(http_daemon, tmp_path, port, audit_log)
        client = next(clients)
        stack.callback(next, clients, None)
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        return client, log

    yield build
    stack.close()


#: Whether the connection dies on the write's readback, and the id that says so.
DROPPED, ANSWERED = True, False

#: What a reading returns when the write left no row at all, distinct from every
#: value a row's ``ok`` or ``readback`` can hold.
NO_ROW = "no row"


def rows_of_a_write(factory: Factory, drive: Drive, event: str, *, drop: bool = DROPPED) -> list[dict[str, Any]] | None:
    """The ``fields`` of every ``event`` row ``GET /api/audit`` returns after the
    write, or None when the setter never went out or no ``State`` followed it,
    so a drop would not have been the readback's."""
    client, log = factory(drive.setter, drop=drop)
    drive.run(client)
    names = [name for name, _attrs in list(log)]
    if drive.setter not in names or READBACK not in names[names.index(drive.setter) :]:
        return None
    audit = client.get("/api/audit").json()["records"]
    return [dict(record["fields"]) for record in audit if record["event"] == event]


def count_of_rows(factory: Factory, drive: Drive, event: str) -> int | None:
    rows = rows_of_a_write(factory, drive, event)
    return None if rows is None else len(rows)


def recorded(factory: Factory, drive: Drive, event: str, key: str, *, drop: bool) -> object:
    """What the write's newest ``event`` row carries under ``key``; ``NO_ROW``
    when there is no such row, or the key is absent from it."""
    rows = rows_of_a_write(factory, drive, event, drop=drop)
    return rows[-1].get(key, NO_ROW) if rows else NO_ROW


def readback_is_null(factory: Factory, drive: Drive, event: str, *, drop: bool) -> bool | None:
    """Whether the write's newest ``event`` row carries a null ``readback``; None
    when there is no such row or it has no ``readback`` key at all."""
    value = recorded(factory, drive, event, "readback", drop=drop)
    return None if value == NO_ROW else value is None


def readback_level(factory: Factory, drive: Drive, *, drop: bool) -> float | str | None:
    """The newest ``volume.write`` row's ``readback`` as a number, since the
    string form of a level is formatting rather than contract; ``NO_ROW`` when
    there is none, None when it is null."""
    value = recorded(factory, drive, VOLUME_WRITE, "readback", drop=drop)
    return value if value is None or value == NO_ROW else float(str(value))


LIVE_LANE_SETTER_WRITES = {
    "live batch": Drive("SetFilter", live_batch_filter),
    "live half of a staged apply": Drive("SetShaping", staged_apply_shaper),
}

VOLUME_WRITES = {
    "volume endpoint": Drive("Volume", volume_endpoint),
    "staged apply through the live lane": Drive("Volume", staged_apply_volume),
}

#: Each write on each lane, dropped and answered, beside what a claim expects of it.
LIVE_SCENES = [
    pytest.param(drive, drop, id=f"{name}-{'dropped' if drop else 'answered'}")
    for name, drive in LIVE_LANE_SETTER_WRITES.items()
    for drop in (DROPPED, ANSWERED)
]


# --- the live lane's setter writes --------------------------------------------


@pytest.mark.parametrize("drive", LIVE_LANE_SETTER_WRITES.values(), ids=LIVE_LANE_SETTER_WRITES.keys())
def test_a_live_setter_write_whose_connection_died_before_readback_leaves_its_live_write_row(
    control_client: Factory, drive: Drive
) -> None:
    assert count_of_rows(control_client, drive, LIVE_WRITE) == 1


@pytest.mark.parametrize(("drive", "drop"), LIVE_SCENES)
def test_a_live_setter_write_is_recorded_as_verified_only_when_its_readback_arrived(
    control_client: Factory, *, drive: Drive, drop: bool
) -> None:
    # a row written as if the readback had confirmed the write is the wrong fix
    # this case exists to catch: the engine never said what it holds
    assert recorded(control_client, drive, LIVE_WRITE, "ok", drop=drop) is (not drop)


@pytest.mark.parametrize(("drive", "drop"), LIVE_SCENES)
def test_a_live_setter_write_carries_a_null_readback_only_when_its_connection_died_before_it(
    control_client: Factory, *, drive: Drive, drop: bool
) -> None:
    # a readback filled in from the value sent would read as the engine's answer
    assert readback_is_null(control_client, drive, LIVE_WRITE, drop=drop) is drop


# --- the volume writes --------------------------------------------------------


@pytest.mark.parametrize("drive", VOLUME_WRITES.values(), ids=VOLUME_WRITES.keys())
def test_a_volume_write_whose_connection_died_before_readback_leaves_its_volume_trace_row(
    control_client: Factory, drive: Drive
) -> None:
    assert count_of_rows(control_client, drive, VOLUME_WRITE) == 1


#: The level the fake reports after an answered ``Volume`` write is the one sent.
SENT_LEVEL = float(LEVEL)

VOLUME_SCENES = [
    pytest.param(drive, drop, expected, id=f"{name}-{'dropped' if drop else 'answered'}")
    for name, drive in VOLUME_WRITES.items()
    for drop, expected in ((DROPPED, None), (ANSWERED, SENT_LEVEL))
]


@pytest.mark.parametrize(("drive", "drop", "expected"), VOLUME_SCENES)
def test_a_volume_write_carries_the_level_read_back_and_none_when_its_connection_died_before_it(
    control_client: Factory, *, drive: Drive, drop: bool, expected: float | None
) -> None:
    # the trace tells a write from an observation by the readback it carries; a
    # readback filled in from the level sent would claim the engine confirmed it
    assert readback_level(control_client, drive, drop=drop) == expected


# --- a volume write that was never attempted ------------------------------------

#: The setter the volume rides behind in the same staged apply, whose readback
#: the connection dies on before ``Volume`` is ever sent.
EARLIER_SETTER = "SetShaping"
VOLUME_SETTER = "Volume"


def staged_apply_shaper_beside_volume(client: TestClient) -> None:
    client.post("/api/config/stage", json={"live": {"shaper": {"value": SHAPER}, "volume": {"value": LEVEL}}})
    client.post("/api/config/apply")


def volume_rows_beside_an_earlier_setting(factory: Factory, *, drop: bool) -> int | None:
    """How many ``volume.write`` rows the apply left, or None when the scene did
    not happen as named: the earlier setter never went out, no ``State``
    followed it, or ``Volume`` was sent when the drop should have stopped it, or
    not sent when nothing did."""
    client, log = factory(EARLIER_SETTER, drop=drop)
    staged_apply_shaper_beside_volume(client)
    names = [name for name, _attrs in list(log)]
    if EARLIER_SETTER not in names or READBACK not in names[names.index(EARLIER_SETTER) :]:
        return None
    if (VOLUME_SETTER in names) is drop:
        return None
    audit = client.get("/api/audit").json()["records"]
    return sum(1 for record in audit if record["event"] == VOLUME_WRITE)


@pytest.mark.parametrize(("drop", "expected"), [(DROPPED, 0), (ANSWERED, 1)], ids=["never-sent", "sent"])
def test_a_staged_volume_is_traced_only_when_it_was_sent_beside_an_earlier_setting(
    control_client: Factory, *, drop: bool, expected: int
) -> None:
    # only an attempted volume write is traced: a row for the never-sent volume
    # would claim a level went to the engine when the connection died first
    assert volume_rows_beside_an_earlier_setting(control_client, drop=drop) == expected
