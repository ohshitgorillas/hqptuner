"""The field register answers every fact the spec's register tables state.

Every expected value below is a row of those tables, written out here as
the spec gives it. A caller asks through ``hqptuner.fields.query`` only. A question
about a row the register does not hold answers a named ``Absent`` marker rather than
``None``, so a register missing the row never satisfies a test expecting ``None``.
"""

from collections.abc import Mapping
from enum import Enum

import pytest

from hqptuner.fields import query
from hqptuner.fields.model import Attr, Carry, Chain, Codec, EngineAttr, Enumeration, Join, Location, Plugin, Setter


class Absent(Enum):
    """What a helper answers when the register holds nothing to ask."""

    ROW = "the register has no row for this field"
    LIVE = "the row has no live setter"
    SETTER = "the register has no setter under this key"


#: "Fields with a setter": each row's Setter, argument, State attribute, Enumeration, join and Chain.
#: The matrix profile's list is not one of the five enumerations and its setter names no argument.
LIVE_FACTS: dict[str, dict[str, object]] = {
    "mode": {
        "setter": "SetMode",
        "arg": "value",
        "state": "mode",
        "enumeration": Enumeration.MODES,
        "join": Join.MODE_NAME,
        "chain": None,
    },
    "filter1x": {
        "setter": "SetFilter",
        "arg": "value1x",
        "state": "filter1x",
        "enumeration": Enumeration.FILTERS,
        "join": Join.ENUM_ID,
        "chain": Chain.PCM,
    },
    "filter": {
        "setter": "SetFilter",
        "arg": "value",
        "state": "filterNx",
        "enumeration": Enumeration.FILTERS,
        "join": Join.ENUM_ID,
        "chain": Chain.PCM,
    },
    "dither": {
        "setter": "SetShaping",
        "arg": "value",
        "state": "shaper",
        "enumeration": Enumeration.SHAPERS,
        "join": Join.ENUM_ID,
        "chain": Chain.PCM,
    },
    "oversampling1x": {
        "setter": "SetFilter",
        "arg": "value1x",
        "state": "filter1x",
        "enumeration": Enumeration.FILTERS,
        "join": Join.ENUM_ID,
        "chain": Chain.SDM,
    },
    "oversampling": {
        "setter": "SetFilter",
        "arg": "value",
        "state": "filterNx",
        "enumeration": Enumeration.FILTERS,
        "join": Join.ENUM_ID,
        "chain": Chain.SDM,
    },
    "modulator": {
        "setter": "SetShaping",
        "arg": "value",
        "state": "shaper",
        "enumeration": Enumeration.SHAPERS,
        "join": Join.ENUM_ID,
        "chain": Chain.SDM,
    },
    "adaptive_volume": {
        "setter": "SetAdaptiveVolume",
        "arg": "value",
        "state": "adaptive",
        "enumeration": None,
        "join": None,
        "chain": None,
    },
    "junk_filter": {
        "setter": "SetJunkFilter",
        "arg": "value",
        "state": "filter_junk",
        "enumeration": Enumeration.JUNK_FILTERS,
        "join": Join.INDEX,
        "chain": None,
    },
    "rate": {
        "setter": "SetRate",
        "arg": "value",
        "state": "rate",
        "enumeration": Enumeration.RATES,
        "join": Join.HZ,
        "chain": None,
    },
    "volume": {
        "setter": "Volume",
        "arg": "value",
        "state": "volume",
        "enumeration": None,
        "join": None,
        "chain": None,
    },
    "matrix_profile": {"setter": "MatrixSetProfile", "state": "matrix_profile", "chain": None},
}

#: "Fields with a setter", column "Across a restart".
CARRY = {
    "mode": Carry.REALIZED,
    "filter1x": Carry.REALIZED,
    "filter": Carry.REALIZED,
    "dither": Carry.REALIZED,
    "oversampling1x": Carry.REALIZED,
    "oversampling": Carry.REALIZED,
    "modulator": Carry.REALIZED,
    "adaptive_volume": Carry.REALIZED,
    "junk_filter": Carry.AUTOPILOT,
    "rate": Carry.NOTHING,
    "volume": Carry.NOTHING,
    "matrix_profile": Carry.NOTHING,
}

#: "Fields with a setter", the four yes/no columns, as the set of rows marked yes.
STAGED_ROUTES = frozenset({"mode", "filter1x", "filter", "dither", "oversampling1x", "oversampling", "modulator"})
LIVE_CONTROLS = STAGED_ROUTES | {"adaptive_volume", "junk_filter", "rate"}
SNAPSHOT_FIELDS = STAGED_ROUTES | {"adaptive_volume", "matrix_profile"}
REALIZED = STAGED_ROUTES | {"adaptive_volume"}
#: "Fields with a setter", the rows whose Chain is not "none".
CHAIN_SCOPED = frozenset({"filter1x", "filter", "dither", "oversampling1x", "oversampling", "modulator"})

#: "Fields with a setter", the rows whose Location is "none".
UNLOCATED = ("junk_filter", "rate", "volume", "matrix_profile")

#: "Fields with a setter", the Location column of the rows the File keeps.
SETTER_LOCATIONS: dict[str, Location] = {
    "mode": Attr("mode", "value"),
    "filter1x": Attr("pcm", "filter1x"),
    "filter": Attr("pcm", "filter"),
    "dither": Attr("pcm", "dither"),
    "oversampling1x": Attr("sdm", "oversampling1x"),
    "oversampling": Attr("sdm", "oversampling"),
    "modulator": Attr("sdm", "modulator"),
    "adaptive_volume": Attr("engine", "volume_adaptive"),
}

#: "Fields the File keeps at one attribute".
ONE_ATTRIBUTE: dict[str, Location] = {
    "title": Attr("title", "value"),
    "backend": Attr("output", "type"),
    "samplerate": Attr("pcm", "samplerate"),
    "bitrate": Attr("sdm", "bitrate"),
    "defaults_samplerate": Attr("defaults", "samplerate"),
    "defaults_bitrate": Attr("defaults", "bitrate"),
    "defaults_volume": Attr("defaults", "volume"),
    "alsa_device": Attr("alsa", "device"),
    "alsa_bits": Attr("alsa", "dac_bits"),
    "alsa_period": Attr("alsa", "period_time"),
    "alsa_offset": Attr("alsa", "channel_offset"),
    "alsa_anydsd": Attr("alsa", "any_dsd"),
    "alsa_dop": Attr("alsa", "pack_sdm"),
    "net_bits": Attr("network", "dac_bits"),
    "net_period": Attr("network", "period_time"),
    "net_anydsd": Attr("network", "any_dsd"),
    "net_ipv6": Attr("network", "ipv6"),
    "net_dop": Attr("network", "pack_sdm"),
    "asio_device": Attr("asio", "device"),
    "asio_bits": Attr("asio", "dac_bits"),
    "asio_period": Attr("asio", "period_time"),
    "asio_offset": Attr("asio", "channel_offset"),
    "asio_anydsd": Attr("asio", "any_dsd"),
    "asio_dop": Attr("asio", "pack_sdm"),
    "wasapi_device": Attr("wasapi", "device"),
    "wasapi_bits": Attr("wasapi", "dac_bits"),
    "wasapi_period": Attr("wasapi", "period_time"),
    "wasapi_offset": Attr("wasapi", "channel_offset"),
    "wasapi_anydsd": Attr("wasapi", "any_dsd"),
    "wasapi_dop": Attr("wasapi", "pack_sdm"),
    "auto_family": Attr("engine", "auto_family"),
    "idle_time": Attr("engine", "idle_time"),
    "channels": Attr("engine", "channels"),
    "fft_size": Attr("engine", "fft_size"),
    "pipelines": Attr("engine", "pipelines"),
    "direct_sdm": Attr("engine", "direct_sdm"),
    "dsd_6db": Attr("engine", "dsd_6db"),
    "sdm_conversion": Attr("engine", "sdm_conversion"),
    "gain_comp": Attr("engine", "gain_comp"),
    "playlist_album_gain": Attr("engine", "playlist_album_gain"),
    "pre_before_meter": Attr("engine", "pre_before_meter"),
    "quick_pause": Attr("engine", "quick_pause"),
    "short_buffer": Attr("engine", "short_buffer"),
    "volume_max": Attr("engine", "volume_max"),
    "volume_min": Attr("engine", "volume_min"),
    "volume_fixed": Attr("engine", "volume_fixed"),
    "integrator": Attr("engine", "sdm_integrator"),
    "pcm_conversion": Attr("engine", "pdm_conv"),
    "noise_filter": Attr("engine", "pdm_filt"),
    "matrix_enabled": Attr("matrix", "enabled"),
    "matrix_engine": Attr("matrix", "engine"),
    "matrix_expand_hf": Attr("matrix", "expand_hf"),
    "matrix_iir2fir": Attr("matrix", "iir2fir"),
    "log_enabled": Attr("log", "enabled"),
    "log_file": Attr("log", "file"),
    "upnp_freewheel": Attr("upnp", "freewheel"),
}

#: "Fields the File keeps on a plugin".
PLUGIN_FIELDS: dict[str, Plugin] = {
    "post_bauer_enabled": Plugin("bauer", "enabled"),
    "post_bauer_preset": Plugin("bauer", "preset"),
    "post_bauer_frequency": Plugin("bauer", "frequency"),
    "post_bauer_level": Plugin("bauer", "level"),
    "post_correction_enabled": Plugin("correction", "enabled"),
    "post_correction_dac0": Plugin("correction", "dac0"),
    "post_loudness_enabled": Plugin("loudness", "enabled"),
    "post_loudness_lowfreq": Plugin("loudness", "low_frequency"),
    "post_loudness_lowlevel": Plugin("loudness", "low_level"),
    "post_loudness_lowsteep": Plugin("loudness", "low_steepness"),
    "post_loudness_lowtype": Plugin("loudness", "low_type"),
    "post_loudness_highfreq": Plugin("loudness", "high_frequency"),
    "post_loudness_highlevel": Plugin("loudness", "high_level"),
    "post_loudness_highsteep": Plugin("loudness", "high_steepness"),
    "post_loudness_hightype": Plugin("loudness", "high_type"),
    "post_loudness_rangelow": Plugin("loudness", "range_low"),
    "post_loudness_rangehigh": Plugin("loudness", "range_high"),
}

#: "Fields the File keeps through a codec".
CODEC_FIELDS: dict[str, Location] = {
    "net_device": Codec.NET_DEVICE,
    "fixed_volume_enabled": Codec.FIXED_ENABLED,
    "fixed_volume": Codec.FIXED_LEVEL,
    "matrix_pipelines": Codec.PIPELINES,
    "matrix_profiles": Codec.PROFILES,
    "matrix_profile_save": Codec.PROFILE_SAVE,
    "matrix_profile_delete": Codec.PROFILE_DELETE,
}

#: "`<engine>` hardware attributes": each is the `<engine>` attribute of its own name.
HARDWARE: dict[str, Location] = {
    name: EngineAttr(name) for name in ("cuda", "multicore", "ecores", "nblocks", "cuda_dev", "cuda_cdev")
}

#: Every field the File keeps, by name, with its location.
LOCATED: dict[str, Location] = SETTER_LOCATIONS | ONE_ATTRIBUTE | PLUGIN_FIELDS | CODEC_FIELDS | HARDWARE

#: "Setters": the setting keys in apply order, each setter's command and State readback by argument.
APPLY_ORDER = ("mode", "filter", "shaper", "rate", "junk_filter", "adaptive_volume", "volume")
SETTER_COMMANDS = {
    "mode": "SetMode",
    "filter": "SetFilter",
    "shaper": "SetShaping",
    "rate": "SetRate",
    "junk_filter": "SetJunkFilter",
    "adaptive_volume": "SetAdaptiveVolume",
    "volume": "Volume",
}
SETTER_READBACK = {
    "mode": {"value": "mode"},
    "filter": {"value": "filterNx", "value1x": "filter1x"},
    "shaper": {"value": "shaper"},
    "rate": {"value": "rate"},
    "junk_filter": {"value": "filter_junk"},
    "adaptive_volume": {"value": "adaptive"},
    "volume": {"value": "volume"},
}
#: "The pending buffer takes every setting key but `rate`."
STAGEABLE = frozenset(APPLY_ORDER) - {"rate"}

#: "Sets the register names".
FORCED = {"auto_family": "1", "samplerate": "0", "bitrate": "0"}
HOST_INTERFACES = frozenset({Attr("upnp", "interface"), Attr("network", "mcast_interface")})
LOSSY_FORM = frozenset({"volume_fixed"})
VOLUME_TRACED = frozenset(
    {
        "defaults_volume",
        "volume_max",
        "volume_min",
        "volume_fixed",
        "fixed_volume",
        "fixed_volume_enabled",
        "adaptive_volume",
    }
)
DEVICE_FIELDS = {"network": "net_device", "alsa": "alsa_device", "asio": "asio_device", "wasapi": "wasapi_device"}
#: The read-only readback proving each write-only matrix profile verb.
PROVEN_BY = {"matrix_profile_save": "matrix_profiles", "matrix_profile_delete": "matrix_profiles"}


def row_fact(name: str, column: str) -> object:
    """The ``column`` of the register's row for ``name``, or ``Absent.ROW``."""
    row = query.field(name)
    return Absent.ROW if row is None else getattr(row, column)


def live_fact(name: str, column: str) -> object:
    """The ``column`` of the live facts on the row for ``name``, or why there are none."""
    row = query.field(name)
    if row is None:
        return Absent.ROW
    return Absent.LIVE if row.live is None else getattr(row.live, column)


def setter_under(key: str) -> Setter | Absent:
    """The setter written under ``key``, or ``Absent.SETTER``."""
    found = [setter for setter in query.setters() if setter.key == key]
    return found[0] if found else Absent.SETTER


def setter_fact(key: str, column: str) -> object:
    """The ``column`` of the setter written under ``key``, or ``Absent.SETTER``."""
    setter = setter_under(key)
    return setter if isinstance(setter, Absent) else getattr(setter, column)


def setter_readback(key: str) -> dict[str, str] | Absent:
    """The setter under ``key``'s readback, argument to State attribute, as a plain dict."""
    setter = setter_under(key)
    if isinstance(setter, Absent):
        return setter
    readback = query.readback(setter)
    return dict(readback) if isinstance(readback, Mapping) else Absent.SETTER


def live_cases(column: str) -> list[tuple[str, object]]:
    """Each setter row's expected value in ``column``, for the rows that state one."""
    return [(name, facts[column]) for name, facts in LIVE_FACTS.items() if column in facts]


@pytest.mark.parametrize(("name", "command"), live_cases("setter"))
def test_a_field_with_a_setter_is_written_by_its_command(name: str, command: str) -> None:
    assert live_fact(name, "setter") == command


@pytest.mark.parametrize(("name", "argument"), live_cases("arg"))
def test_a_field_with_a_setter_is_written_under_its_setter_argument(name: str, argument: str) -> None:
    assert live_fact(name, "arg") == argument


@pytest.mark.parametrize(("name", "attribute"), live_cases("state"))
def test_every_field_with_a_setter_names_the_state_attribute_reporting_it(name: str, attribute: str) -> None:
    assert live_fact(name, "state") == attribute


@pytest.mark.parametrize(("name", "enumeration"), live_cases("enumeration"))
def test_every_field_with_a_setter_names_the_enumeration_it_joins_through(
    name: str, enumeration: Enumeration | None
) -> None:
    assert live_fact(name, "enumeration") == enumeration


@pytest.mark.parametrize(("name", "join"), live_cases("join"))
def test_a_field_with_a_setter_joins_on_its_item_attribute(name: str, join: Join | None) -> None:
    assert live_fact(name, "join") == join


@pytest.mark.parametrize(("name", "chain"), live_cases("chain"))
def test_a_field_with_a_setter_belongs_to_its_chain(name: str, chain: Chain | None) -> None:
    assert live_fact(name, "chain") == chain


@pytest.mark.parametrize(("name", "carry"), CARRY.items())
def test_a_live_value_is_carried_across_a_restart_by_its_carrier(name: str, carry: Carry) -> None:
    assert row_fact(name, "carry") == carry


def test_a_staged_edit_routes_live_for_exactly_the_fields_the_register_marks() -> None:
    assert frozenset(row.name for row in query.staged_routes()) == STAGED_ROUTES


def test_live_control_takes_exactly_the_fields_the_register_marks() -> None:
    assert frozenset(query.live_controls()) == LIVE_CONTROLS


def test_a_snapshot_holds_exactly_the_fields_the_register_marks() -> None:
    assert frozenset(query.snapshot_fields()) == SNAPSHOT_FIELDS


def test_the_realized_config_carries_exactly_the_fields_the_register_marks() -> None:
    assert frozenset(row.name for row in query.realized()) == REALIZED


def test_the_chain_scoped_fields_are_exactly_those_with_a_chain() -> None:
    assert query.chain_scoped() == CHAIN_SCOPED


@pytest.mark.parametrize("name", UNLOCATED)
def test_a_setting_the_file_does_not_keep_has_no_location(name: str) -> None:
    assert (row_fact(name, "name"), row_fact(name, "location")) == (name, None)


@pytest.mark.parametrize(("name", "location"), LOCATED.items())
def test_a_field_the_file_keeps_names_where_the_file_keeps_it(name: str, location: Location) -> None:
    assert row_fact(name, "location") == location


def test_the_located_fields_are_every_field_the_file_keeps_at_its_location() -> None:
    assert dict(query.located()) == LOCATED


def test_each_plugin_attribute_names_the_field_kept_there() -> None:
    assert dict(query.by_plugin()) == {plugin: name for name, plugin in PLUGIN_FIELDS.items()}


@pytest.mark.parametrize("name", ONE_ATTRIBUTE)
def test_no_field_the_file_keeps_at_one_attribute_has_a_setter(name: str) -> None:
    assert (row_fact(name, "location"), row_fact(name, "live")) == (ONE_ATTRIBUTE[name], None)


def test_the_setters_are_written_in_apply_order() -> None:
    assert tuple(setter.key for setter in query.setters()) == APPLY_ORDER


@pytest.mark.parametrize(("key", "command"), SETTER_COMMANDS.items())
def test_a_setting_key_is_written_by_its_setter_command(key: str, command: str) -> None:
    assert setter_fact(key, "command") == command


@pytest.mark.parametrize(("key", "readback"), SETTER_READBACK.items())
def test_a_setter_reads_each_argument_back_as_its_state_attribute(key: str, readback: dict[str, str]) -> None:
    assert setter_readback(key) == readback


@pytest.mark.parametrize("key", APPLY_ORDER)
def test_a_setter_is_stageable_unless_it_writes_the_rate(key: str) -> None:
    assert setter_fact(key, "stageable") is (key in STAGEABLE)


def test_the_pending_buffer_takes_every_setting_key_but_the_rate() -> None:
    assert frozenset(query.stageable()) == STAGEABLE


def test_a_restore_write_forces_exactly_the_forced_fields_to_their_values() -> None:
    assert dict(query.forced()) == FORCED


def test_a_preset_load_keeps_exactly_the_host_interfaces_from_the_running_file() -> None:
    assert frozenset(query.host_interfaces()) == HOST_INTERFACES


def test_the_fields_read_from_backup_are_exactly_the_lossy_ones() -> None:
    assert query.lossy_form() == LOSSY_FORM


def test_the_volume_trace_follows_exactly_the_volume_fields() -> None:
    assert query.volume_traced() == VOLUME_TRACED


@pytest.mark.parametrize(("backend", "name"), DEVICE_FIELDS.items())
def test_a_backend_names_the_field_holding_its_device(backend: str, name: str) -> None:
    assert query.device_field(backend) == name


@pytest.mark.parametrize(("verb", "readback"), PROVEN_BY.items())
def test_a_matrix_profile_verb_is_proven_by_the_stored_profiles(verb: str, readback: str) -> None:
    assert query.proven_by(verb) == readback
