"""What the engine's live settings look like when they are read off the manager.

`live_snapshot` is a pure read of the manager's public snapshot of the engine —
the `state` mapping the daemon's `State` filled and the `enums` mapping its
enumeration queries filled — joined into a display record per live field. Both
halves arrive here off the fake control daemon over a real socket, so the shapes
under test are the wire's own (`docs/testing.md`: fakes speak the protocol); the
cases that need a state attribute or an enumeration item the daemon would not
have produced edit those two public mappings afterwards, the way
`tests/apply/test_volume_config.py` stands in for the poll loop.

Fixture facts these lean on (`tests/support/fake_control.py`): the PCM chain
numbers `poly-sinc-gauss-long` enum 40 at list index 1 and the SDM chain numbers
it 38 at index 0, `sinc-M` is enum 23 at SDM index 1, the PCM rates ladder is
`0/44100/352800/705600/384000`, and the modes list is `[source]`/`PCM`/
`SDM (DSD)` at indices 0/1/2.
"""

from collections.abc import Iterator
from typing import Any

import fake_http
import pytest
from conftest import LiveManager, StartManager
from narrow import present

from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live.snapshot import live_snapshot


def _snapshot(manager: ConnectionManager) -> dict[str, dict[str, str]]:
    """The snapshot, with the "no chain" answer ruled out as a fixture problem."""
    return present(live_snapshot(manager))


def _without(manager: ConnectionManager, attribute: str) -> None:
    """Drop one attribute from the manager's State — an engine that never
    reported it (`filter1x`/`filterNx` are documented optional, protocol.md §6)."""
    manager.readings.state = {k: v for k, v in present(manager.readings.state).items() if k != attribute}


def _with_enum(manager: ConnectionManager, name: str, items: list[dict[str, str]]) -> None:
    """Serve one enumeration list in place of the one the daemon answered with."""
    enums: dict[str, Any] = dict(present(manager.readings.enums))
    enums[name] = items
    manager.readings.enums = enums


# --- the chain has to be knowable at all --------------------------------------


async def test_a_state_that_names_no_loaded_chain_reports_nothing(live_manager: LiveManager) -> None:
    # `[source]` with nothing playing: the configured mode names no family and the
    # engine has not settled on one either, so every chain-bound field would be a
    # guess. Half a snapshot would read as the engine's settings, so there is none.
    manager, _, _ = await live_manager(mode="0", _active_mode="")
    assert live_snapshot(manager) is None


# --- a field whose backing state attribute or enumeration entry is missing -----


async def test_a_field_the_engine_never_reported_is_left_out(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    _without(manager, "filter_junk")
    assert "junk_filter" not in _snapshot(manager)


async def test_a_field_whose_enumeration_has_no_entry_at_that_index_is_left_out(
    live_manager: LiveManager,
) -> None:
    # The PCM filters list carries three entries; the engine reporting index 9 is
    # an enumeration that moved under the snapshot, and there is no filter to name.
    manager, _, _ = await live_manager(filterNx="9")
    assert "filter" not in _snapshot(manager)


async def test_a_field_whose_enumeration_entry_carries_no_value_is_left_out(
    live_manager: LiveManager,
) -> None:
    # A `FiltersItem` with a name but no enum ID: nothing to store or write back,
    # so the field is absent rather than present with an empty value.
    manager, _, _ = await live_manager(filterNx="0")
    _with_enum(manager, "filters", [{"index": "0", "name": "none"}])
    assert "filter" not in _snapshot(manager)


# --- only the loaded chain's fields are reported -------------------------------


async def test_a_field_of_the_chain_the_engine_is_not_running_is_left_out(
    live_manager: LiveManager,
) -> None:
    # Running PCM, `oversampling` is the SDM chain's filter: the engine's `filterNx`
    # answers for the chain it loaded, so reporting it under both names would put
    # a PCM filter on the SDM card.
    manager, _, _ = await live_manager(mode="1")
    assert "oversampling" not in _snapshot(manager)


async def test_the_loaded_pcm_chains_filter_is_reported_by_enum_id_and_name(
    live_manager: LiveManager,
) -> None:
    # State says index 1; the PCM list has `poly-sinc-gauss-long` there under enum
    # ID 40, which is the domain everything downstream of the snapshot speaks.
    manager, _, _ = await live_manager(mode="1", filterNx="1")
    assert _snapshot(manager)["filter"] == {"value": "40", "name": "poly-sinc-gauss-long"}


async def test_the_loaded_sdm_chains_filter_is_reported_by_enum_id_and_name(
    live_manager: LiveManager,
) -> None:
    # Same index, other chain: index 1 of the SDM list is `sinc-M` under enum ID 23.
    manager, _, _ = await live_manager(mode="2", filterNx="1")
    assert _snapshot(manager)["oversampling"] == {"value": "23", "name": "sinc-M"}


async def test_the_loaded_pcm_chains_dither_is_reported_by_enum_id_and_name(
    live_manager: LiveManager,
) -> None:
    # The shapers half of the same join, on the chain-bound pair `dither`
    # (PCM) / `modulator` (SDM): State says shaper index 1, and the PCM list has
    # `NS9` there under enum ID 5.
    manager, _, _ = await live_manager(mode="1", shaper="1")
    assert _snapshot(manager)["dither"] == {"value": "5", "name": "NS9"}


# --- the rates enumeration, whose items have no name (protocol.md §6) ----------


@pytest.fixture
def limited_http_daemon() -> Iterator[dict[str, Any]]:
    """The 8088 fake serving a config file that caps the PCM chain at 384000.

    The rate a snapshot reports is the LIMIT slot for the loaded chain
    (`<defaults samplerate>` for PCM, `<defaults bitrate>` for SDM), stored as
    the 48k member of the tier the user picked — not the engine's exact-rate
    pin, which HQPTuner leaves on auto. 384000 is off the fake's own default of
    192000, so the value asserted can only have come from this file."""
    yield from fake_http.spawn(fake_http.state(mode="pcm", defaults_samplerate="384000"))


async def test_a_rate_is_named_by_its_own_value(
    start_manager: StartManager, limited_http_daemon: dict[str, Any]
) -> None:
    # A rate has no name of its own anywhere — `<RatesItem index rate/>` carries
    # none and the config attribute is a bare number — so the rate in Hz is the
    # label. Reporting the ladder index (384000 sits at PCM index 4) or an empty
    # name would leave the card with nothing to show.
    manager = await start_manager(limited_http_daemon["_port"])
    assert _snapshot(manager)["rate"] == {"value": "384000", "name": "384000"}


# --- the output mode ------------------------------------------------------------


async def test_the_output_mode_is_reported_in_its_configuration_form(live_manager: LiveManager) -> None:
    # State reports the modes-list index; the value here is what the configuration
    # form calls that mode, so it means the same thing on a device whose list is
    # shorter.
    manager, _, _ = await live_manager(mode="2")
    assert _snapshot(manager)["mode"]["value"] == "sdm"


async def test_the_output_mode_is_labeled_with_the_engines_own_name_for_it(
    live_manager: LiveManager,
) -> None:
    manager, _, _ = await live_manager(mode="2")
    assert _snapshot(manager)["mode"]["name"] == "SDM (DSD)"


async def test_a_running_mode_the_modes_list_does_not_carry_is_left_out(
    live_manager: LiveManager,
) -> None:
    # A DAC that cannot do DSD gets a modes list with no SDM entry while the
    # remaining entries keep their indices, so index 2 names nothing — and naming
    # some other mode instead would report a setting the engine is not in.
    manager, _, _ = await live_manager(mode="2", _no_sdm="1")
    assert "mode" not in _snapshot(manager)


# --- the flags that are a bare 0/1 on State, with no enumeration behind them ----


async def test_a_flag_is_reported_as_its_own_value_and_label(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(adaptive="1")
    assert _snapshot(manager)["adaptive_volume"] == {"value": "1", "name": "1"}


async def test_a_flag_the_engine_never_reported_is_left_out(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager()
    _without(manager, "adaptive")
    assert "adaptive_volume" not in _snapshot(manager)
