"""The per-family rate memory LIVE keeps for the engine (docs/testing.md).

hqplayerd holds ONE output-rate pin, not one per output family, and `SetMode`
clears it outright (measured 2026-07-28, `scripts/probes/probe_mode_rate_pin.py`): pin
DSD64 in SDM, switch to PCM and `State rate` reads 0, switch back and it still
reads 0. So `State` answers for the family the engine is running and only until
the next mode switch, which is why HQPTuner remembers per family what LIVE
pinned, puts it back when that family comes round again, and reports both
families to the config side.

Everything here runs against the stateful fake daemon over a real socket: the
assertions are on the traffic that reached it and on the memory the manager
kept, never on how either was produced. The fake models the two wire facts this
behavior turns on — `SetMode` resets `rate` to 0, and the rates enumeration is
mode-dependent (manual §4.6), so the PCM and SDM lists share no rate but index
0 (auto).
"""

import pytest
from conftest import LiveManager
from fake_control import CommandLog

from hqptuner.lanes.live import chain, lane, overrides


def _rate_writes(log: CommandLog) -> list[str]:
    """The `RatesItem` index each `SetRate` carried, in the order they went out."""
    return [attrs.get("value", "") for name, attrs in log if name == "SetRate"]


# --- which family a rate belongs to -----------------------------------------
# The split is the lowest SDM rate: DSD64 is 2822400 Hz on a 44.1k base and no
# PCM rate the engine offers reaches it.


@pytest.mark.parametrize(
    ("hz", "family"),
    [("44100", "pcm"), ("192000", "pcm"), ("768000", "pcm"), ("2822400", "sdm"), ("22579200", "sdm")],
)
def test_a_rate_names_the_output_family_it_belongs_to(hz: str, family: str) -> None:
    assert chain.rate_family(hz) == family


# --- joining Hz to the engine's own list ------------------------------------


async def test_a_rate_the_engine_offers_resolves_to_its_list_index(live_manager: LiveManager) -> None:
    # `RatesItem` is `<RatesItem index rate/>` — no name, no value — so the join
    # is on the rate in Hz, and `SetRate` wants the index (protocol.md §6).
    manager, _, _ = await live_manager()
    assert chain.rate_index_for(manager, "352800") == "2"


async def test_a_rate_the_engine_does_not_offer_resolves_to_nothing(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    assert chain.rate_index_for(manager, "88200") is None


# --- what a LIVE rate write remembers ---------------------------------------


async def test_pinning_auto_forgets_the_remembered_pcm_rate(live_manager: LiveManager) -> None:
    # Index 0 is the engine's Auto and pins nothing, so there is nothing to put
    # back when the family comes round again.
    manager, _, _ = await live_manager()
    await lane.apply_now(manager, {"rate": "44100"})
    await lane.apply_now(manager, {"rate": "0"})
    assert "pcm" not in manager.readings.live.rates


async def test_pinning_auto_forgets_the_remembered_sdm_rate(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    await lane.apply_now(manager, {"mode": "sdm"})
    await lane.apply_now(manager, {"rate": "2822400"})
    await lane.apply_now(manager, {"rate": "0"})
    assert "sdm" not in manager.readings.live.rates


# --- what the config side is told --------------------------------------------
# `live_overrides` reports the memory in each family's config limit field —
# `defaults_samplerate` for pcm, `defaults_bitrate` for sdm — as the 48k-base
# member of the tier, which is the domain those menus speak.


async def test_a_dormant_44k_base_pcm_pin_is_reported_as_its_48k_tier(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    await lane.apply_now(manager, {"rate": "352800"})  # 8x on a 44.1k base
    await lane.apply_now(manager, {"mode": "sdm"})
    assert overrides.live_overrides(manager)["defaults_samplerate"] == "384000"


async def test_a_dormant_44k_base_sdm_pin_is_reported_as_its_48k_tier(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    await lane.apply_now(manager, {"mode": "sdm"})
    await lane.apply_now(manager, {"rate": "2822400"})  # DSD64 on a 44.1k base
    await lane.apply_now(manager, {"mode": "pcm"})
    assert overrides.live_overrides(manager)["defaults_bitrate"] == "3072000"


async def test_a_dormant_48k_base_pcm_pin_is_reported_unchanged(live_manager: LiveManager) -> None:
    # Already the 48k member of its tier: converting it again would name a tier
    # the user never picked.
    manager, _, _ = await live_manager()
    await lane.apply_now(manager, {"rate": "384000"})  # 8x on a 48k base
    await lane.apply_now(manager, {"mode": "sdm"})
    assert overrides.live_overrides(manager)["defaults_samplerate"] == "384000"


async def test_a_dormant_48k_base_sdm_pin_is_reported_unchanged(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    await lane.apply_now(manager, {"mode": "sdm"})
    await lane.apply_now(manager, {"rate": "12288000"})  # DSD256 on a 48k base
    await lane.apply_now(manager, {"mode": "pcm"})
    assert overrides.live_overrides(manager)["defaults_bitrate"] == "12288000"


@pytest.mark.parametrize("field", ["defaults_samplerate", "defaults_bitrate"])
async def test_a_family_with_no_pin_reports_no_rate_limit(live_manager: LiveManager, field: str) -> None:
    # `State rate="0"` is the engine's Auto: it pins nothing, and reporting a
    # limit off it would write a rate the user never picked.
    manager, _, _ = await live_manager()
    assert field not in overrides.live_overrides(manager)


# --- putting the pin back when its family comes round again ------------------


async def test_a_remembered_rate_the_entered_mode_lacks_is_forgotten(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    await lane.apply_now(manager, {"mode": "sdm"})
    manager.readings.live.rates["pcm"] = "88200"
    await lane.apply_now(manager, {"mode": "pcm"})
    assert "pcm" not in manager.readings.live.rates


async def test_a_mode_write_that_never_verified_re_asserts_nothing(live_manager: LiveManager) -> None:
    # The daemon answers the SetMode OK and stays in PCM, where the remembered
    # 44100 is still resolvable — so a lane that re-asserted without checking the
    # readback would put a SetRate on the wire here.
    manager, log, _ = await live_manager(_deaf="SetMode")
    await lane.apply_now(manager, {"rate": "44100"})
    log.clear()
    await lane.apply_now(manager, {"mode": "sdm"})
    assert _rate_writes(log) == []


async def test_a_mode_write_that_never_verified_keeps_the_pin_it_left(live_manager: LiveManager) -> None:
    # The engine never left PCM, so the PCM pin is still the truth. A lane that
    # cleared the family it was entering before checking the readback would drop
    # a pin the engine is still holding.
    manager, _, _ = await live_manager(_deaf="SetMode")
    await lane.apply_now(manager, {"rate": "44100"})
    await lane.apply_now(manager, {"mode": "sdm"})
    assert manager.readings.live.rates["pcm"] == "44100"
