"""The Volume tab's persistent settings, end to end through the write lane.

The fake daemon re-reads none of these fields from an uploaded config unless the
test writes its row into ``_adopts``, so each apply test here names the rows its
read-back needs. The top-level ``<fixed>`` element is tested on hand-written XML
through ``presetconf`` alone: whether that line is live or commented is not
something an adoption row can state.

``adaptive_volume`` is the odd one: it is a LIVE setting (``SetAdaptiveVolume``),
so it never touches the config file — and a preset saved off that file therefore
stored a value the user was not hearing. ``mgr.readings.state`` is assigned directly to
stand in for the poll loop that normally fills it; it is the manager's public
snapshot of the engine, the same seam ``virtual_clock`` uses for the clock.
"""

from typing import Any

import pytest

from hqptuner.conf import presetconf
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import restore
from hqptuner.lanes.http.restore import RestoreOutcome
from hqptuner.presets import fileconfig
from hqptuner.presets.presetfields import restore_hooks

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


#: The rows the fake daemon re-reads on restore for the fields applied here:
#: state key to the element and attribute the daemon takes it from.
MAX_VOLUME_ROW = {"volume_max": ("engine", "volume_max")}
MIN_VOLUME_ROW = {"volume_min": ("engine", "volume_min")}
STARTUP_VOLUME_ROW = {"defaults_volume": ("defaults", "volume")}


async def test_max_volume_survives_an_apply(http_daemon: dict[str, Any], http_manager: ConnectionManager) -> None:
    http_daemon["_adopts"] = MAX_VOLUME_ROW
    await http_manager.applyops.apply({}, {"volume_max": "-6"})
    assert (await fileconfig.load_file_config(http_manager))["volume_max"] == "-6"


async def test_min_volume_survives_an_apply(http_daemon: dict[str, Any], http_manager: ConnectionManager) -> None:
    http_daemon["_adopts"] = MIN_VOLUME_ROW
    await http_manager.applyops.apply({}, {"volume_min": "-40"})
    assert (await fileconfig.load_file_config(http_manager))["volume_min"] == "-40"


async def test_startup_volume_survives_an_apply(http_daemon: dict[str, Any], http_manager: ConnectionManager) -> None:
    http_daemon["_adopts"] = STARTUP_VOLUME_ROW
    await http_manager.applyops.apply({}, {"defaults_volume": "-12"})
    assert (await fileconfig.load_file_config(http_manager))["defaults_volume"] == "-12"


# --- fixed volume: presence is the flag, and the comment is the memory --------
#
# There is no enabled attribute. The top-level <fixed volume="…"/> line existing
# IS "on", and 6.0.4 remembers the level while off by commenting that line out.


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


@pytest.mark.parametrize(
    ("volume", "level"),
    [
        pytest.param(b"-6", "-6", id="a-level"),
        pytest.param(b"", None, id="empty"),
    ],
)
def test_a_live_fixed_element_reports_the_level_it_carries(volume: bytes, level: str | None) -> None:
    xml = b'<hqplayerd><fixed volume="' + volume + b'"/><engine channels="2"/></hqplayerd>'
    assert presetconf.read_config(xml).get("fixed_volume") == level


async def test_a_volume_apply_reports_applied(http_daemon: dict[str, Any], http_manager: ConnectionManager) -> None:
    http_daemon["_adopts"] = MAX_VOLUME_ROW
    assert (
        await restore.apply(http_manager, {"volume_max": "-6"}, restore_hooks(http_manager))
    ).outcome is RestoreOutcome.APPLIED


#: A startup volume the restarted daemon writes back on its own: the fixture
#: daemon starts at -3 and the apply below never stages it.
DAEMON_REWRITTEN_STARTUP_VOLUME = {"defaults_volume": "-40"}


async def test_an_apply_with_a_daemon_rewrite_reports_applied(
    http_daemon: dict[str, Any],
    http_manager: ConnectionManager,
) -> None:
    http_daemon["_adopts"] = MAX_VOLUME_ROW
    http_daemon["_restart_state"] = DAEMON_REWRITTEN_STARTUP_VOLUME
    assert (
        await restore.apply(http_manager, {"volume_max": "-6"}, restore_hooks(http_manager))
    ).outcome is RestoreOutcome.APPLIED
