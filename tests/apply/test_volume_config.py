"""The Volume tab's persistent settings, end to end through the write lane.

Every field here was previously unreachable by the suite: the fake daemon's
config XML carried no ``<fixed>`` element and no ``volume_max``/``volume_min``/
``volume_adaptive``/``defaults@volume``, so a writer bug in any of them read as
a fixture gap and shipped green. The fake now expresses them, and these are the
behaviors that were going untested.

``adaptive_volume`` is the odd one: it is a LIVE setting (``SetAdaptiveVolume``),
so it never touches the config file — and a preset saved off that file therefore
stored a value the user was not hearing. ``mgr.readings.state`` is assigned directly to
stand in for the poll loop that normally fills it; it is the manager's public
snapshot of the engine, the same seam ``virtual_clock`` uses for the clock.
"""

from typing import Any

from hqptuner.conf import presetconf
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane

# 6.0.4 shape, fixed volume OFF: the daemon keeps the last level in a COMMENTED
# top-level line, and that comment is its memory. HQPTuner used to delete the
# line outright on disable, destroying a level staged in the same apply.
_PARKED_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>\n<hqplayerd>'
    b'<!--<fixed volume="-3"/>-->'
    b'<title value="Opal"/>'
    b'<engine channels="2" volume_fixed="0"><defaults volume="-3"/></engine>'
    b"</hqplayerd>"
)

# a config that has never had a fixed volume at all — no line, live or parked
_NEVER_FIXED_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>\n<hqplayerd>'
    b'<title value="Opal"/>'
    b'<engine channels="2" volume_fixed="0"><defaults volume="-3"/></engine>'
    b"</hqplayerd>"
)


async def test_max_volume_survives_an_apply(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"volume_max": "-6"})
    assert (await http_manager.load_file_config())["volume_max"] == "-6"


async def test_min_volume_survives_an_apply(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"volume_min": "-40"})
    assert (await http_manager.load_file_config())["volume_min"] == "-40"


async def test_startup_volume_survives_an_apply(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"defaults_volume": "-12"})
    assert (await http_manager.load_file_config())["defaults_volume"] == "-12"


async def test_enabling_fixed_volume_reads_back_as_enabled(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    assert (await http_manager.load_file_config())["fixed_volume_enabled"] == "1"


async def test_enabling_fixed_volume_stores_the_level(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    assert (await http_manager.load_file_config())["fixed_volume"] == "-6"


async def test_disabling_fixed_volume_reads_back_as_disabled(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "0"})
    assert (await http_manager.load_file_config())["fixed_volume_enabled"] == "0"


# --- fixed volume: presence is the flag, and the comment is the memory --------
#
# There is no enabled attribute. The top-level <fixed volume="…"/> line existing
# IS "on", and 6.0.4 remembers the level while off by commenting that line out —
# a live config on the dev host carries literally <!--<fixed volume="-3"/>-->.
# HQPTuner deleted the line instead, so a level staged alongside a disable was
# destroyed and the box fell back to the daemon form's own remembered number:
# the user's value silently reverting. The apply reported success too, because
# the dropped field is also the field read back to confirm it.


async def test_disabling_fixed_volume_keeps_a_level_staged_with_it(http_manager: ConnectionManager) -> None:
    # the core regression: level and untick in ONE apply
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "0", "fixed_volume": "-20"})
    assert (await http_manager.load_file_config())["fixed_volume"] == "-20"


async def test_disabling_fixed_volume_with_a_level_still_reports_it_off(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "0", "fixed_volume": "-20"})
    assert (await http_manager.load_file_config())["fixed_volume_enabled"] == "0"


async def test_a_level_staged_alone_switches_fixed_volume_on(http_manager: ConnectionManager) -> None:
    # there is nowhere to park a level for a disabled feature, so setting one
    # means turning it on — otherwise the edit is silently discarded
    await http_manager.applyops.apply({}, {"fixed_volume": "-12"})
    assert (await http_manager.load_file_config())["fixed_volume_enabled"] == "1"


async def test_an_explicit_untick_beats_a_level_staged_beside_it(http_manager: ConnectionManager) -> None:
    # "turn it off" must never be resurrected by the level traveling with it
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "0", "fixed_volume": "-20"})
    assert (await http_manager.load_file_config())["fixed_volume_enabled"] == "0"


async def test_re_enabling_fixed_volume_restores_the_remembered_level(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "1", "fixed_volume": "-6"})
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "0"})
    await http_manager.applyops.apply({}, {"fixed_volume_enabled": "1"})
    assert (await http_manager.load_file_config())["fixed_volume"] == "-6"


def test_toggling_fixed_volume_leaves_exactly_one_parked_line() -> None:
    # a disable that appended without clearing the old comment would stack them,
    # and the stale first hit is what a remembered-level read would then find
    xml = _PARKED_XML
    for enabled in ("1", "0", "1", "0"):
        xml = presetconf.apply_edits(xml, {"fixed_volume_enabled": enabled})
    assert xml.count(b"<!--<fixed") == 1


def test_a_config_that_never_had_a_fixed_volume_reports_no_level() -> None:
    # absent is not 0 dBFS — reporting a bogus level would write one on the next apply
    assert "fixed_volume" not in presetconf.read_config(_NEVER_FIXED_XML)


def test_a_parked_level_is_reported_though_the_feature_is_off() -> None:
    assert presetconf.read_config(_PARKED_XML)["fixed_volume"] == "-3"


async def test_a_volume_apply_reports_applied(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, {"volume_max": "-6"})
    assert report["persistent"]["applied"] is True


async def test_a_live_adaptive_volume_is_saved_into_the_preset(http_manager: ConnectionManager) -> None:
    # the file says off (fake default volume_adaptive="0"); the engine says on
    http_manager.readings.state = {"adaptive": "1"}
    await http_manager.presetops.save_preset("Loud")
    assert (await presetlane.read(http_manager, "Loud"))["adaptive_volume"] == "1"


async def test_a_saved_preset_reports_success(http_manager: ConnectionManager) -> None:
    result: dict[str, Any] = await http_manager.presetops.save_preset("Quiet")
    assert result["ok"] is True


async def test_an_apply_succeeds_though_the_daemon_rewrote_an_untouched_field(
    clamping_manager: ConnectionManager,
) -> None:
    # this daemon pulls the startup volume into the volume range on every
    # restore. Holding the apply to the whole config made that one field fail
    # every apply, on every tab, forever — the user's changes stuck staged with
    # nothing naming the setting at fault.
    report = await clamping_manager.applyops.apply({}, {"volume_max": "-6"})
    assert report["persistent"]["applied"] is True


async def test_the_daemon_really_did_rewrite_the_untouched_field(clamping_manager: ConnectionManager) -> None:
    # the precondition of the test above: without this divergence it would pass
    # for the wrong reason
    await clamping_manager.applyops.apply({}, {"volume_max": "-6"})
    assert (await clamping_manager.load_file_config())["defaults_volume"] == "-40"


async def test_the_field_the_apply_wrote_is_still_verified(clamping_manager: ConnectionManager) -> None:
    await clamping_manager.applyops.apply({}, {"volume_max": "-6"})
    assert (await clamping_manager.load_file_config())["volume_max"] == "-6"
