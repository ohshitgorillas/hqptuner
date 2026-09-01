"""A LIVE rate the engine will not pin is HELD, not refused (docs/testing.md).

`SetRate` takes a `RatesItem` index, `GetRates` is scoped to the CONFIGURED
mode, and the Hz form is accepted and silently ignored (protocol.md §6, verified
2026-07-29) — so the other family's tier has no index to send, and in `[source]`
mode nothing is pinnable at all: with a rate at index 9 of the running list,
`SetRate value="9"` answered OK and left `State.rate` at `"0"`, while `SetMode
PCM` made the identical index take. The LIVE page shows both families at once
and has no Apply button to come back to, so a rate the engine will not take is
held: nothing goes on the wire, the value comes back under `stored`, and it is
put on the engine resolved against that family's own list when that family
becomes the configured mode.

Which chain is LOADED is a different question from which family can be PINNED,
and the two come apart in auto: `[source]` running a PCM source has the PCM
filter/shaper chain loaded and takes those edits live, while no rate is pinnable.

Everything here runs against the stateful fake daemon over a real socket. The
assertions are on the traffic that reached the daemon and on what the public
call reported, never on how either was produced. The fake models the wire facts
this turns on — `SetMode` resets `rate` to 0, the rates enumeration is scoped to
the loaded chain (PCM offers 0/44100/352800/705600/384000, SDM offers
0/2822400/5644800/12288000, sharing no rate but index 0), and `Status` echoes
`"[source]"` rather than resolving the family in auto.
"""

from collections.abc import Callable

import pytest
from conftest import LiveManager
from fake_control import CommandLog
from fastapi.testclient import TestClient

from hqptuner.lanes.live import chain, lane


def _rate_writes(log: CommandLog) -> list[str]:
    """The `RatesItem` index each `SetRate` carried, in the order they went out."""
    return [attrs.get("value", "") for name, attrs in log if name == "SetRate"]


# --- which family the engine will accept a pin for ----------------------------


async def test_a_configured_pcm_mode_accepts_pins_for_the_pcm_family(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    assert chain.pin_family(manager) == "pcm"


async def test_a_configured_sdm_mode_accepts_pins_for_the_sdm_family(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="2")
    assert chain.pin_family(manager) == "sdm"


async def test_auto_mode_accepts_pins_for_no_family_at_all(live_manager: LiveManager) -> None:
    # [source] has no pin slot to write: the rate follows the source, and a
    # SetRate against the running list answers OK and moves nothing.
    manager, _, _ = await live_manager(mode="0", state="2", _active_mode="PCM")
    assert chain.pin_family(manager) is None


# --- which rates the engine will refuse as a pin ------------------------------


async def test_a_pcm_rate_is_pinnable_while_pcm_is_configured(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    assert chain.unpinnable_rate(manager, "352800") is False


async def test_an_sdm_rate_is_unpinnable_while_pcm_is_configured(live_manager: LiveManager) -> None:
    # DSD64 has no index in the PCM list the engine enumerates, so there is no
    # wire form that pins it.
    manager, _, _ = await live_manager(mode="1")
    assert chain.unpinnable_rate(manager, "2822400") is True


async def test_an_sdm_rate_is_pinnable_while_sdm_is_configured(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="2")
    assert chain.unpinnable_rate(manager, "2822400") is False


async def test_a_pcm_rate_is_unpinnable_while_sdm_is_configured(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="2")
    assert chain.unpinnable_rate(manager, "352800") is True


@pytest.mark.parametrize("hz", ["352800", "2822400"])
async def test_no_rate_of_either_family_is_pinnable_in_auto_mode(live_manager: LiveManager, hz: str) -> None:
    # Playing, with the PCM chain loaded: playback is not what blocks the pin,
    # [source] is (protocol.md §6, measured mid-playback).
    manager, _, _ = await live_manager(mode="0", state="2", _active_mode="PCM")
    assert chain.unpinnable_rate(manager, hz) is True


@pytest.mark.parametrize("mode", ["0", "1", "2"])
async def test_the_auto_rate_is_never_unpinnable(live_manager: LiveManager, mode: str) -> None:
    # "0" is the value that means stop pinning; the engine takes it in any mode,
    # and holding it would leave the engine pinned to what the user just cleared.
    manager, _, _ = await live_manager(mode=mode)
    assert chain.unpinnable_rate(manager, "0") is False


# --- splitting the unpinnable rate out of a batch -----------------------------


async def test_the_batch_split_drops_a_rate_the_engine_will_not_pin(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    fields = {"rate": "2822400", "junk_filter": "1"}
    assert chain.split_unpinnable_rate(manager, fields)[0] == {"junk_filter": "1"}


async def test_the_batch_split_hands_back_the_unpinnable_rate_in_hz(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    fields = {"rate": "2822400", "junk_filter": "1"}
    assert chain.split_unpinnable_rate(manager, fields)[1] == "2822400"


async def test_the_batch_split_keeps_a_rate_the_engine_will_pin(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    assert chain.split_unpinnable_rate(manager, {"rate": "352800"})[0] == {"rate": "352800"}


async def test_the_batch_split_hands_back_nothing_for_a_pinnable_rate(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    assert chain.split_unpinnable_rate(manager, {"rate": "352800"})[1] is None


# --- applying a batch that carries an unpinnable rate -------------------------


async def test_a_batch_carrying_an_unpinnable_rate_still_applies_its_other_settings(
    live_manager: LiveManager,
) -> None:
    # Holding the rate must not cost the batch its siblings: the junk filter the
    # user moved in the same write has nothing to do with the output family.
    manager, log, _ = await live_manager(mode="1")
    await lane.apply_now(manager, {"rate": "2822400", "junk_filter": "1"})
    assert [attrs.get("value", "") for name, attrs in log if name == "SetJunkFilter"] == ["1"]


async def test_a_batch_carrying_an_unpinnable_rate_reports_its_other_settings_applied(
    live_manager: LiveManager,
) -> None:
    manager, _, _ = await live_manager(mode="1")
    report = await lane.apply_now(manager, {"rate": "2822400", "junk_filter": "1"})
    assert {"setting": "junk_filter", "ok": True} in report["live"]


async def test_an_unpinnable_sdm_rate_comes_back_stored_in_hz(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    report = await lane.apply_now(manager, {"rate": "2822400"})
    assert report["stored"]["rate"] == "2822400"


async def test_an_unpinnable_pcm_rate_comes_back_stored_in_hz(live_manager: LiveManager) -> None:
    # The mirror: the engine is configured SDM, so the PCM half of the page is
    # the one that cannot be pinned.
    manager, _, _ = await live_manager(mode="2")
    report = await lane.apply_now(manager, {"rate": "352800"})
    assert report["stored"]["rate"] == "352800"


async def test_a_rate_held_in_auto_mode_comes_back_stored_in_hz(live_manager: LiveManager) -> None:
    # Nothing is pinnable in [source], so even the family the engine is running
    # is held rather than written.
    manager, _, _ = await live_manager(mode="0", state="2", _active_mode="PCM")
    report = await lane.apply_now(manager, {"rate": "352800"})
    assert report["stored"]["rate"] == "352800"


async def test_an_unpinnable_rate_puts_no_setrate_on_the_wire(live_manager: LiveManager) -> None:
    # The Hz form is accepted and silently ignored, so any SetRate here is a
    # write that did nothing.
    manager, log, _ = await live_manager(mode="1")
    await lane.apply_now(manager, {"rate": "2822400"})
    assert _rate_writes(log) == []


async def test_a_rate_held_in_auto_mode_puts_no_setrate_on_the_wire(live_manager: LiveManager) -> None:
    manager, log, _ = await live_manager(mode="0", state="2", _active_mode="PCM")
    await lane.apply_now(manager, {"rate": "352800"})
    assert _rate_writes(log) == []


# --- a rate the engine WILL pin goes out at once ------------------------------


async def test_a_pinnable_rate_is_pinned_at_the_engines_own_index(live_manager: LiveManager) -> None:
    # 352800 names the 8x tier, whose 48k member 384000 is index 4 of the PCM
    # list; the Hz would be accepted and ignored.
    manager, log, _ = await live_manager(mode="1")
    await lane.apply_now(manager, {"rate": "352800"})
    assert _rate_writes(log) == ["4"]


async def test_a_pinnable_rate_is_not_held(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    report = await lane.apply_now(manager, {"rate": "352800"})
    assert "rate" not in report["stored"]


@pytest.mark.parametrize("mode", ["1", "2"])
async def test_the_auto_rate_reaches_the_engine_whichever_mode_is_configured(
    live_manager: LiveManager, mode: str
) -> None:
    # Index 0 exists in both lists: un-pinning is always a write the engine takes.
    manager, log, _ = await live_manager(mode=mode, rate="2")
    await lane.apply_now(manager, {"rate": "0"})
    assert _rate_writes(log) == ["0"]


@pytest.mark.parametrize("mode", ["1", "2"])
async def test_the_auto_rate_is_never_held(live_manager: LiveManager, mode: str) -> None:
    manager, _, _ = await live_manager(mode=mode, rate="2")
    report = await lane.apply_now(manager, {"rate": "0"})
    assert "rate" not in report["stored"]


# --- the held rate goes on the engine when its family is configured -----------


async def test_configuring_sdm_pins_the_sdm_rate_held_under_pcm(live_manager: LiveManager) -> None:
    # 2822400 is index 1 of the SDM list and absent from the PCM list the engine
    # was enumerating when the rate was entered, so an index resolved against the
    # old list could not produce this write.
    manager, log, _ = await live_manager(mode="1")
    await lane.apply_now(manager, {"rate": "2822400"})
    log.clear()
    await lane.apply_now(manager, {"mode": "sdm"})
    assert _rate_writes(log) == ["1"]


async def test_configuring_pcm_pins_the_pcm_rate_held_under_sdm(live_manager: LiveManager) -> None:
    # The mirror: the 8x tier is index 4 of the PCM list and nowhere in the SDM one.
    manager, log, _ = await live_manager(mode="2")
    await lane.apply_now(manager, {"rate": "352800"})
    log.clear()
    await lane.apply_now(manager, {"mode": "pcm"})
    assert _rate_writes(log) == ["4"]


async def test_leaving_auto_pins_the_rate_held_while_no_mode_was_configured(live_manager: LiveManager) -> None:
    # Leaving [source] is a mode switch like any other: the rate the engine
    # refused while auto goes out the moment its family is configured.
    manager, log, _ = await live_manager(mode="0", state="2", _active_mode="PCM")
    await lane.apply_now(manager, {"rate": "352800"})
    log.clear()
    await lane.apply_now(manager, {"mode": "pcm"})
    assert _rate_writes(log) == ["4"]


async def test_configuring_one_family_never_pins_the_rate_held_for_the_other(live_manager: LiveManager) -> None:
    # The memory is per family: a DSD64 pin entered while auto was configured is
    # the SDM family's, and entering PCM is not the moment for it.
    manager, log, _ = await live_manager(mode="0", state="2", _active_mode="PCM")
    await lane.apply_now(manager, {"rate": "2822400"})
    log.clear()
    await lane.apply_now(manager, {"mode": "pcm"})
    assert _rate_writes(log) == []


# --- the loaded chain is a different question from the pin family -------------


async def test_auto_mode_running_a_pcm_source_has_the_pcm_chain_loaded(live_manager: LiveManager) -> None:
    # Status echoes "[source]" rather than resolving, so the rate the engine is
    # running is what names the chain — and filter/shaper edits do go live here,
    # in the same situation where no rate is pinnable.
    manager, _, _ = await live_manager(mode="0", state="2", _active_mode="PCM")
    assert chain.active_chain(manager) == "pcm"


async def test_auto_mode_running_nothing_has_no_knowable_chain(live_manager: LiveManager) -> None:
    # Neither lane can answer before playback starts. None, never a guess: a
    # wrong chain resolves filters against the other chain's enum IDs.
    manager, _, _ = await live_manager(mode="0", _active_mode="")
    assert chain.active_chain(manager) is None


def test_state_reports_the_loaded_chain_of_an_auto_mode_pcm_source(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(mode="0", state="2", _active_mode="PCM")
    assert client.get("/api/state").json()["data"]["active_chain"] == "pcm"
