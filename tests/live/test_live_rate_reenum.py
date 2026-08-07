"""A LIVE batch carrying a rate resolves it against the list the engine answers
with NOW, not against a copy HQPTuner took earlier (docs/testing.md).

`SetRate` takes a `RatesItem` index and never the Hz (protocol.md §6), so every
rate the user picks has to be joined against the engine's own `GetRates` list
before it can go on the wire. `GetRates` is answered per mode AND per transport
state, and a snapshot taken right after a reconnect with the transport idle held
the auto entry alone — a list with an index for nothing the user can pick.
Joining against that refuses rates the engine would have taken.

Whether asking again fills such a list back in is not established on the real
daemon: `scripts/probes/probe_rates_on_demand.py` against 6.0.4 could not
reproduce the short answer at all (two fresh connections, three `GetRates` each,
all six the full 11-item ladder). So what these cases pin is which list a rate is
resolved against, never a claim about why the daemon's list moved.

Everything here runs against the stateful fake daemon over a real socket, its
enumeration moved through the fake's `_rates` knob. Assertions are on what the
public call reported, on what the daemon ended up holding, and on the traffic
that reached it.
"""

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from conftest import LiveManager, _live_app, spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog
from fastapi.testclient import TestClient

from hqptuner.lanes import livelane

#: The PCM rates the fake enumerates once a case has moved it: auto, then 352800
#: at index 1 and 44100 at index 2. The order is deliberate — 352800 is index 2
#: of the fake's built-in PCM ladder, so an index of "1" for it can only have
#: come from a join against THIS list.
DEVICE_RATES = "0 352800 44100"

#: A REST client over a fake daemon, and that daemon's live State to move.
RateApi = Callable[..., tuple[TestClient, dict[str, str]]]


def _enumerations(log: CommandLog) -> list[str]:
    """Every `GetRates` the daemon was asked, in order."""
    return [name for name, _ in log if name == "GetRates"]


@pytest.fixture
def rate_api(tmp_path: Path) -> Iterator[RateApi]:
    """Build the control-only app on a threaded fake daemon and hand back its
    State dict alongside the client.

    `chain_api` bakes its overrides in at construction and keeps the State to
    itself, so a case built on it can only ever serve ONE enumeration — cached
    and fresh alike — and cannot say which of the two a rate was joined against.
    This shares one State across the daemon's connections, the way the async
    `daemon` fixture does, so a test can move the enumeration mid-session."""
    daemons: list[Iterator[int]] = []
    apps: list[Iterator[TestClient]] = []

    def build(**overrides: str) -> tuple[TestClient, dict[str, str]]:
        state = {**DEFAULTS, **overrides}
        daemon = spawn_threaded_daemon(state=state)
        daemons.append(daemon)
        app = _live_app(next(daemon), tmp_path)
        apps.append(app)
        return next(app), state

    yield build
    for app in apps:
        next(app, None)
    for daemon in daemons:
        next(daemon, None)


async def test_a_rate_the_engine_offers_now_is_applied_though_the_held_list_lacks_it(
    live_manager: LiveManager,
) -> None:
    # The daemon answers auto alone at first — nothing pinnable — and answers the
    # fuller list afterwards, with neither `mode` nor `state` moving, so nothing
    # tells HQPTuner the copy it took is out of date.
    manager, _, state = await live_manager(mode="1", _rates="0")
    state["_rates"] = DEVICE_RATES
    report = await livelane.apply_now(manager, {"rate": "352800"})
    assert [r["ok"] for r in report["live"] if r["setting"] == "rate"] == [True]


async def test_an_applied_rate_leaves_the_engine_pinned_at_the_fresh_lists_index(
    live_manager: LiveManager,
) -> None:
    # `State.rate` is a `RatesItem` index. 352800 is index 1 of the list the
    # daemon is answering with by now and index 2 of the built-in PCM ladder, so
    # "1" is proof of the join AND of the index rather than the Hz going out.
    manager, _, state = await live_manager(mode="1", _rates="0")
    state["_rates"] = DEVICE_RATES
    await livelane.apply_now(manager, {"rate": "352800"})
    assert state["rate"] == "1"


async def test_a_rate_the_engine_accepts_but_does_not_pin_is_reported_failed(
    live_manager: LiveManager,
) -> None:
    # `result="OK"` is no proof for `SetRate` (protocol.md §6): this daemon
    # answers the write and leaves `State.rate` where it was. Re-asking for the
    # list buys nothing without the readback, so the report must still say no.
    manager, _, state = await live_manager(mode="1", _rates="0", _deaf="SetRate")
    state["_rates"] = DEVICE_RATES
    report = await livelane.apply_now(manager, {"rate": "352800"})
    assert [r["ok"] for r in report["live"] if r["setting"] == "rate"] == [False]


def test_a_rate_the_engine_no_longer_offers_is_refused(rate_api: RateApi) -> None:
    # The mirror of the first case, and the half that says the FRESH list is the
    # authority rather than merely a second opinion: the list HQPTuner took at
    # connect carries 352800, the one the daemon answers with by the time the user
    # picks it does not, and there is no wire form that pins it.
    client, state = rate_api(mode="1", _rates=DEVICE_RATES)
    state["_rates"] = "0 44100"
    assert client.post("/api/config/live", json={"fields": {"rate": "352800"}}).status_code == 409


async def test_applying_a_batch_with_no_rate_puts_no_getrates_on_the_wire(live_manager: LiveManager) -> None:
    # The re-ask is what a rate costs, and nothing else pays it: a junk-filter
    # edit resolves against a list of its own.
    manager, log, _ = await live_manager(mode="1")
    log.clear()
    await livelane.apply_now(manager, {"junk_filter": "1"})
    assert _enumerations(log) == []
