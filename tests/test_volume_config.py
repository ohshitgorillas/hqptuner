"""The Volume tab's persistent settings, end to end through the write lane.

Every field here was previously unreachable by the suite: the fake daemon's
config XML carried no ``<fixed>`` element and no ``volume_max``/``volume_min``/
``volume_adaptive``/``defaults@volume``, so a writer bug in any of them read as
a fixture gap and shipped green. The fake now expresses them, and these are the
behaviors that were going untested.

``adaptive_volume`` is the odd one: it is a LIVE setting (``SetAdaptiveVolume``),
so it never touches the config file — and a preset saved off that file therefore
stored a value the user was not hearing. ``mgr.state`` is assigned directly to
stand in for the poll loop that normally fills it; it is the manager's public
snapshot of the engine, the same seam ``virtual_clock`` uses for the clock.
"""

from typing import Any

from hqptuner.manager import ConnectionManager


async def test_max_volume_survives_an_apply(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"volume_max": "-6"})
    assert (await http_manager.load_file_config())["volume_max"] == "-6"


async def test_min_volume_survives_an_apply(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"volume_min": "-40"})
    assert (await http_manager.load_file_config())["volume_min"] == "-40"


async def test_startup_volume_survives_an_apply(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"defaults_volume": "-12"})
    assert (await http_manager.load_file_config())["defaults_volume"] == "-12"


async def test_enabling_fixed_volume_reads_back_as_enabled(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    assert (await http_manager.load_file_config())["fixed_volume_enabled"] == "1"


async def test_enabling_fixed_volume_stores_the_level(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    assert (await http_manager.load_file_config())["fixed_volume"] == "-6"


async def test_disabling_fixed_volume_reads_back_as_disabled(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    await http_manager.apply({}, {"fixed_volume_enabled": "0"})
    assert (await http_manager.load_file_config())["fixed_volume_enabled"] == "0"


async def test_a_volume_apply_reports_applied(http_manager: ConnectionManager) -> None:
    report = await http_manager.apply({}, {"volume_max": "-6"})
    assert report["persistent"]["applied"] is True


async def test_a_live_adaptive_volume_is_saved_into_the_preset(http_manager: ConnectionManager) -> None:
    # the file says off (fake default volume_adaptive="0"); the engine says on
    http_manager.state = {"adaptive": "1"}
    await http_manager.save_preset("Loud")
    assert (await http_manager.read_preset("Loud"))["adaptive_volume"] == "1"


async def test_a_saved_preset_reports_success(http_manager: ConnectionManager) -> None:
    result: dict[str, Any] = await http_manager.save_preset("Quiet")
    assert result["ok"] is True


async def test_an_apply_succeeds_though_the_daemon_rewrote_an_untouched_field(
    clamping_manager: ConnectionManager,
) -> None:
    # this daemon pulls the startup volume into the volume range on every
    # restore. Holding the apply to the whole config made that one field fail
    # every apply, on every tab, forever — the user's changes stuck staged with
    # nothing naming the setting at fault.
    report = await clamping_manager.apply({}, {"volume_max": "-6"})
    assert report["persistent"]["applied"] is True


async def test_the_daemon_really_did_rewrite_the_untouched_field(clamping_manager: ConnectionManager) -> None:
    # the precondition of the test above: without this divergence it would pass
    # for the wrong reason
    await clamping_manager.apply({}, {"volume_max": "-6"})
    assert (await clamping_manager.load_file_config())["defaults_volume"] == "-40"


async def test_the_field_the_apply_wrote_is_still_verified(clamping_manager: ConnectionManager) -> None:
    await clamping_manager.apply({}, {"volume_max": "-6"})
    assert (await clamping_manager.load_file_config())["volume_max"] == "-6"
