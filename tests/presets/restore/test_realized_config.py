"""What a restore boots on and a save stores: the File, the Staged edits, the Engine's live-domain fields.

Each input is handed in as the shapes its reader returns: the File as the form
field names and enum IDs ``presetconf.read_config`` gives, the Staged edits in
the same terms, and the Engine as one stamped reading of the ``State``,
``Status`` and enumeration frames the 4321 client returns, which speak list
indices. On every wire below the Engine and the File disagree on each live-domain
field, and an Engine list index never equals the enum ID it joins to, so a
composition that takes the wrong store, or writes an index where an enum ID
belongs, reads differently from one that does not.
"""

from typing import NamedTuple

import pytest

from hqptuner.core.readings import EngineSnapshot, Source, Stamp
from hqptuner.presets.realized import realized_config

#: The generation every Engine reading here was read in.
GENERATION = 3

#: The modes enumeration, as ``GetModes`` answers it.
MODES = [
    {"index": "0", "name": "[source]", "value": "0"},
    {"index": "1", "name": "PCM", "value": "1"},
    {"index": "2", "name": "SDM (DSD)", "value": "2"},
]

#: The PCM chain's filters and shapers. No item's list index equals its enum ID.
PCM_FILTERS = [
    {"index": "0", "name": "none", "value": "10"},
    {"index": "1", "name": "IIR", "value": "22"},
    {"index": "2", "name": "poly-sinc-gauss", "value": "31"},
    {"index": "3", "name": "sinc-M", "value": "40"},
    {"index": "4", "name": "sinc-L", "value": "57"},
]
PCM_SHAPERS = [
    {"index": "0", "name": "none", "value": "7"},
    {"index": "1", "name": "TPDF", "value": "3"},
]

#: The SDM chain's filters and shapers, a different list from the PCM chain's.
SDM_FILTERS = [
    {"index": "0", "name": "none", "value": "15"},
    {"index": "1", "name": "IIR", "value": "26"},
    {"index": "2", "name": "poly-sinc-ext2", "value": "44"},
    {"index": "3", "name": "sinc-S", "value": "45"},
    {"index": "4", "name": "sinc-Mx", "value": "48"},
]
SDM_SHAPERS = [
    {"index": "0", "name": "DSD5", "value": "11"},
    {"index": "1", "name": "ASDM7EC", "value": "9"},
]

#: Where the Engine stands on either chain: ``State.mode`` index, ``Status``, enumerations.
CHAIN_MODE_INDEX = {"pcm": "1", "sdm": "2"}
CHAIN_STATUS = {
    "pcm": {"state": "2", "active_mode": "PCM", "active_rate": "192000"},
    "sdm": {"state": "2", "active_mode": "SDM (DSD)", "active_rate": "2822400"},
}
CHAIN_ENUMS = {
    "pcm": {"modes": MODES, "filters": PCM_FILTERS, "shapers": PCM_SHAPERS},
    "sdm": {"modes": MODES, "filters": SDM_FILTERS, "shapers": SDM_SHAPERS},
}

#: The list indices ``State`` reports on either chain, and the rate pin it holds.
ENGINE_FILTER1X_INDEX = "2"
ENGINE_FILTERNX_INDEX = "4"
ENGINE_SHAPER_INDEX = "1"
ENGINE_RATE_PIN = "6"

#: The adaptive volume flag the Engine and the File each hold, never the same.
ENGINE_ADAPTIVE = "1"
FILE_ADAPTIVE = "0"

#: The File as ``/backup`` last returned it: every live-domain field on a value the
#: Engine does not hold, its fixed rate slots and its rate limits.
FILE_CONFIG = {
    "mode": "auto",
    "filter1x": "10",
    "filter": "22",
    "dither": "7",
    "oversampling1x": "15",
    "oversampling": "26",
    "modulator": "11",
    "adaptive_volume": FILE_ADAPTIVE,
    "samplerate": "0",
    "bitrate": "0",
    "auto_family": "1",
    "defaults_samplerate": "384000",
    "defaults_bitrate": "12288000",
    "pipelines": "16",
    "title": "Living room",
}

#: A File field no live setter reaches, and two values the File may hold for it.
NO_SETTER_FIELD = "pipelines"
NO_SETTER_VALUES = ["16", "64"]

#: The chain fields of either chain, in form field names.
PCM_CHAIN_FIELDS = ["filter1x", "filter", "dither"]
SDM_CHAIN_FIELDS = ["oversampling1x", "oversampling", "modulator"]

#: The rate fields a restore never takes from the Engine.
RATE_FIELDS = ["samplerate", "bitrate", "defaults_samplerate", "defaults_bitrate"]

#: A Staged value per field that neither the File nor the Engine holds. A flag has two
#: values, so the Engine reading this is staged over holds the File's adaptive volume.
STAGED_EDITS = {
    "filter1x": "40",
    "filter": "40",
    "dither": "5",
    "mode": "sdm",
    "adaptive_volume": "1",
    "pipelines": "32",
}

#: A Staged edit to a field the File did not carry.
STAGED_NEW_FIELD = {"buffer": "100"}


def engine_on(chain: str, adaptive: str = ENGINE_ADAPTIVE) -> EngineSnapshot:
    """One stamped Engine reading with the Engine loaded on ``chain``."""
    state = {
        "state": "2",
        "mode": CHAIN_MODE_INDEX[chain],
        "filter1x": ENGINE_FILTER1X_INDEX,
        "filterNx": ENGINE_FILTERNX_INDEX,
        "shaper": ENGINE_SHAPER_INDEX,
        "rate": ENGINE_RATE_PIN,
        "volume": "-12.0",
        "adaptive": adaptive,
    }
    return EngineSnapshot(
        stamp=Stamp(source=Source.ENGINE, generation=GENERATION),
        state=state,
        status=CHAIN_STATUS[chain],
        enums=CHAIN_ENUMS[chain],
    )


def unread_engine() -> EngineSnapshot:
    """The Engine after an outcome and before its first ``State`` reading."""
    return EngineSnapshot(stamp=Stamp(source=Source.ENGINE, generation=GENERATION))


@pytest.mark.parametrize("value", NO_SETTER_VALUES)
def test_a_field_no_live_setter_reaches_is_the_files(value: str) -> None:
    file_config = {**FILE_CONFIG, NO_SETTER_FIELD: value}
    realized = realized_config(file_config, {}, engine_on("pcm"))
    assert realized.get(NO_SETTER_FIELD) == value


class ChainCase(NamedTuple):
    """A chain the Engine is loaded on, one of its chain fields, and the enum ID
    the Engine's own enumeration gives at the index ``State`` reports for it."""

    chain: str
    field: str
    engine_enum_id: str


LOADED_CHAIN_CASES = [
    ChainCase("pcm", "filter1x", "31"),
    ChainCase("pcm", "filter", "57"),
    ChainCase("pcm", "dither", "3"),
    ChainCase("sdm", "oversampling1x", "44"),
    ChainCase("sdm", "oversampling", "48"),
    ChainCase("sdm", "modulator", "9"),
]


@pytest.mark.parametrize("case", LOADED_CHAIN_CASES, ids=[f"{c.chain}-{c.field}" for c in LOADED_CHAIN_CASES])
def test_a_chain_field_of_the_loaded_chain_carries_the_engines_enum_id(case: ChainCase) -> None:
    realized = realized_config(FILE_CONFIG, {}, engine_on(case.chain))
    assert realized.get(case.field) == case.engine_enum_id


NOT_LOADED_CASES = [("pcm", field) for field in SDM_CHAIN_FIELDS] + [("sdm", field) for field in PCM_CHAIN_FIELDS]


@pytest.mark.parametrize(("chain", "field"), NOT_LOADED_CASES)
def test_a_chain_field_of_the_chain_not_loaded_is_the_files(chain: str, field: str) -> None:
    realized = realized_config(FILE_CONFIG, {}, engine_on(chain))
    assert realized.get(field) == FILE_CONFIG[field]


@pytest.mark.parametrize("chain", ["pcm", "sdm"])
def test_the_output_mode_carries_the_mode_the_engine_is_on(chain: str) -> None:
    realized = realized_config(FILE_CONFIG, {}, engine_on(chain))
    assert realized.get("mode") == chain


ADAPTIVE_CASES = [(ENGINE_ADAPTIVE, FILE_ADAPTIVE), (FILE_ADAPTIVE, ENGINE_ADAPTIVE)]


@pytest.mark.parametrize(("engine_flag", "file_flag"), ADAPTIVE_CASES)
def test_adaptive_volume_carries_the_engines_flag(engine_flag: str, file_flag: str) -> None:
    file_config = {**FILE_CONFIG, "adaptive_volume": file_flag}
    realized = realized_config(file_config, {}, engine_on("pcm", adaptive=engine_flag))
    assert realized.get("adaptive_volume") == engine_flag


@pytest.mark.parametrize("field", RATE_FIELDS)
def test_a_pinned_engine_rate_is_never_carried_into_a_rate_field(field: str) -> None:
    realized = realized_config(FILE_CONFIG, {}, engine_on("pcm"))
    assert realized.get(field) == FILE_CONFIG[field]


@pytest.mark.parametrize("field", sorted(STAGED_EDITS))
def test_a_staged_edit_outranks_both_the_engine_and_the_file(field: str) -> None:
    staged = {field: STAGED_EDITS[field]}
    realized = realized_config(FILE_CONFIG, staged, engine_on("pcm", adaptive=FILE_ADAPTIVE))
    assert realized.get(field) == STAGED_EDITS[field]


#: Live-domain fields a composition with no Engine reading must leave as the File's.
UNREAD_FIELDS = ["mode", "filter1x", "adaptive_volume"]
NO_ENGINE_CASES = [pytest.param(None, field, id=f"no-reading-{field}") for field in UNREAD_FIELDS] + [
    pytest.param(unread_engine(), field, id=f"not-read-yet-{field}") for field in UNREAD_FIELDS
]


@pytest.mark.parametrize(("engine", "field"), NO_ENGINE_CASES)
def test_with_no_engine_reading_a_live_domain_field_is_the_files(engine: EngineSnapshot | None, field: str) -> None:
    realized = realized_config(FILE_CONFIG, {}, engine)
    assert realized.get(field) == FILE_CONFIG[field]


def test_the_realized_config_holds_the_file_and_staged_fields_and_no_engine_attribute() -> None:
    realized = realized_config(FILE_CONFIG, STAGED_NEW_FIELD, engine_on("pcm"))
    assert set(realized) == set(FILE_CONFIG) | set(STAGED_NEW_FIELD)
