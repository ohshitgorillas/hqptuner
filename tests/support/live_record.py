"""An engine to hold LIVE's record of confirmed writes against, written as tables.

The enumerations are the PCM chain's lists, in the shapes the Control API answers them in:
``ModesItem``, ``FiltersItem`` and ``ShapersItem`` carry index, name and enum ID, a
``JunkFiltersItem`` is index-domain, and a ``RatesItem`` carries a rate in Hz and no name.
The config file holds every setting on its first list entry, which is the State a restart
brings the engine back on. Each write moves one State attribute off that file.
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import NamedTuple

from hqptuner.engine.chainfamily import PCM
from hqptuner.lanes.live import dropped
from hqptuner.lanes.live.memory import LiveMemory
from hqptuner.lanes.writer import LiveWriteFailed, LiveWriteOk

MODES = [
    {"index": "0", "name": "[source]", "value": "-1"},
    {"index": "1", "name": "PCM", "value": "0"},
    {"index": "2", "name": "SDM (DSD)", "value": "1"},
]
PCM_FILTERS = [
    {"index": "0", "name": "none", "value": "0"},
    {"index": "1", "name": "poly-sinc-gauss-long", "value": "38"},
    {"index": "2", "name": "sinc-M", "value": "25"},
    {"index": "3", "name": "poly-sinc-short-mp", "value": "40"},
]
PCM_SHAPERS = [
    {"index": "0", "name": "none", "value": "0"},
    {"index": "1", "name": "NS9", "value": "5"},
]
JUNK_FILTERS = [
    {"index": "0", "name": "none"},
    {"index": "1", "name": "20k"},
    {"index": "2", "name": "30k"},
]
PCM_RATES = [
    {"index": "0", "rate": "0"},
    {"index": "1", "rate": "44100"},
    {"index": "3", "rate": "705600"},
]
ENUMS = {
    "modes": MODES,
    "filters": PCM_FILTERS,
    "shapers": PCM_SHAPERS,
    "junk_filters": JUNK_FILTERS,
    "rates": PCM_RATES,
}

#: The State the config file brings the engine up on: the PCM chain, every setting on index 0.
CONFIG_FILE_STATE = {
    "mode": "1",
    "filter1x": "0",
    "filterNx": "0",
    "shaper": "0",
    "rate": "0",
    "filter_junk": "0",
    "adaptive": "0",
}


class Write(NamedTuple):
    """One live write: the setter it goes out as and its arguments as sent (list indices), the
    State attributes the engine reports once it took it, and the record entry it amounts to."""

    setting: str
    args: dict[str, str]
    state: dict[str, str]
    entry: dropped.WrittenSetting


MODE_SDM = Write("mode", {"value": "2"}, {"mode": "2"}, dropped.WrittenSetting("mode", "sdm", "SDM (DSD)"))
FILTER_SINC_M = Write(
    "filter",
    {"value": "2", "value1x": "0"},
    {"filterNx": "2", "filter1x": "0"},
    dropped.WrittenSetting("filter", "25", "sinc-M"),
)
DITHER_NS9 = Write("shaper", {"value": "1"}, {"shaper": "1"}, dropped.WrittenSetting("dither", "5", "NS9"))
JUNK_20K = Write("junk_filter", {"value": "1"}, {"filter_junk": "1"}, dropped.WrittenSetting("junk_filter", "1", "20k"))
JUNK_30K = Write("junk_filter", {"value": "2"}, {"filter_junk": "2"}, dropped.WrittenSetting("junk_filter", "2", "30k"))
RATE_705600 = Write("rate", {"value": "3"}, {"rate": "3"}, dropped.WrittenSetting("rate", "705600", None))
ADAPTIVE_ON = Write(
    "adaptive_volume", {"value": "1"}, {"adaptive": "1"}, dropped.WrittenSetting("adaptive_volume", "1", None)
)

#: One write per live field a restart can drop.
WRITES = [MODE_SDM, FILTER_SINC_M, DITHER_NS9, JUNK_20K, RATE_705600, ADAPTIVE_ON]


#: No State attribute moved off what the engine holds.
NOTHING_MOVED: Mapping[str, str] = MappingProxyType({})


def engine(*held: Write, moved: Mapping[str, str] = NOTHING_MOVED, chain: str | None = PCM) -> dropped.EngineView:
    """The engine on its config file, still holding each of ``held``, with ``moved`` over that, on ``chain``."""
    state = dict(CONFIG_FILE_STATE)
    for write in held:
        state.update(write.state)
    state.update(moved)
    return dropped.EngineView(state, ENUMS, chain)


#: The engine on its config file, holding no write.
ON_CONFIG_FILE = engine()


def confirmed(
    live: LiveMemory, write: Write, *, verified: bool = True, before: dropped.EngineView = ON_CONFIG_FILE
) -> None:
    """Send ``write`` to an engine reading ``before`` (the config file's State by default), its readback
    verifying or not as ``verified`` says, and have ``live`` record it."""
    result = LiveWriteOk(write.setting) if verified else LiveWriteFailed(write.setting, "readback", "mismatch")
    live.confirm({write.setting: write.args}, [result], before)


def remembering(*writes: Write) -> LiveMemory:
    """LIVE's memory once each of ``writes`` was confirmed, in turn."""
    live = LiveMemory()
    for write in writes:
        confirmed(live, write)
    return live


def by_field(report: tuple[dropped.WrittenSetting, ...]) -> dict[str, dropped.WrittenSetting]:
    """``report`` keyed by field, so a comparison ignores the order it lists them in."""
    return {entry.field: entry for entry in report}
