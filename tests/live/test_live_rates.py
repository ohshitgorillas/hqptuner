"""How a rate is classified and reported to the config side (docs/testing.md).

A rate in Hz belongs to one of the two output families, PCM or SDM, and the
config side carries a separate limit field for each — `defaults_samplerate` and
`defaults_bitrate` — in the 48k-base domain those menus speak. What this file
covers is that classification, the conversion into each family's limit field,
and the fact that a mode switch puts no rate write on the wire.

Everything here runs against the stateful fake daemon over a real socket: the
assertions are on the traffic that reached it and on what the manager reports,
never on how either was produced. The fake models the two wire facts this
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


# --- what a mode switch puts on the wire -------------------------------------


async def test_a_mode_write_that_never_verified_re_asserts_nothing(live_manager: LiveManager) -> None:
    # The daemon answers the SetMode OK and stays in PCM, where the remembered
    # 44100 is still resolvable — so a lane that re-asserted without checking the
    # readback would put a SetRate on the wire here.
    manager, log, _ = await live_manager(_deaf="SetMode")
    await lane.apply_now(manager, {"rate": "44100"})
    log.clear()
    await lane.apply_now(manager, {"mode": "sdm"})
    assert _rate_writes(log) == []
