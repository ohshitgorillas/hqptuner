"""The register's rows: every field, the setters in apply order, host interfaces, device fields; data only."""

from collections.abc import Mapping
from dataclasses import replace
from types import MappingProxyType
from typing import Literal

from hqptuner.fields.model import (
    Attr,
    BoundsSelector,
    Carry,
    Chain,
    Choice,
    Codec,
    Decimal,
    EngineAttr,
    Enumeration,
    Field,
    FileSelector,
    Flag,
    Integer,
    Join,
    Live,
    Plugin,
    ReadDescriptor,
    Setter,
    Text,
)

# A field the File keeps and no other column marks; every row below starts from it.
_KEPT = Field(
    name="",
    location=None,
    domain=Text(),
    live=None,
    staged_route=False,
    live_control=False,
    snapshot=False,
    drop_on_snapshot_read=False,
    carry=None,
    forced=None,
    lossy_form=False,
    volume_traced=False,
    reenumerates=False,
)

# A field a staged edit routes live, the live control takes, a snapshot holds and the realized config carries.
_ROUTED = replace(_KEPT, staged_route=True, live_control=True, snapshot=True, carry=Carry.REALIZED)

_SETTER_FIELDS: tuple[Field, ...] = (
    replace(
        _ROUTED,
        name="mode",
        reenumerates=True,
        location=Attr("mode", "value"),
        live=Live(
            setter="SetMode", arg="value", state="mode", enumeration=Enumeration.MODES, join=Join.MODE_NAME, chain=None
        ),
    ),
    replace(
        _ROUTED,
        name="filter1x",
        reenumerates=True,
        location=Attr("pcm", "filter1x"),
        live=Live(
            setter="SetFilter",
            arg="value1x",
            state="filter1x",
            enumeration=Enumeration.FILTERS,
            join=Join.ENUM_ID,
            chain=Chain.PCM,
        ),
    ),
    replace(
        _ROUTED,
        name="filter",
        reenumerates=True,
        location=Attr("pcm", "filter"),
        live=Live(
            setter="SetFilter",
            arg="value",
            state="filterNx",
            enumeration=Enumeration.FILTERS,
            join=Join.ENUM_ID,
            chain=Chain.PCM,
        ),
    ),
    replace(
        _ROUTED,
        name="dither",
        location=Attr("pcm", "dither"),
        live=Live(
            setter="SetShaping",
            arg="value",
            state="shaper",
            enumeration=Enumeration.SHAPERS,
            join=Join.ENUM_ID,
            chain=Chain.PCM,
        ),
    ),
    replace(
        _ROUTED,
        name="oversampling1x",
        reenumerates=True,
        location=Attr("sdm", "oversampling1x"),
        live=Live(
            setter="SetFilter",
            arg="value1x",
            state="filter1x",
            enumeration=Enumeration.FILTERS,
            join=Join.ENUM_ID,
            chain=Chain.SDM,
        ),
    ),
    replace(
        _ROUTED,
        name="oversampling",
        reenumerates=True,
        location=Attr("sdm", "oversampling"),
        live=Live(
            setter="SetFilter",
            arg="value",
            state="filterNx",
            enumeration=Enumeration.FILTERS,
            join=Join.ENUM_ID,
            chain=Chain.SDM,
        ),
    ),
    replace(
        _ROUTED,
        name="modulator",
        location=Attr("sdm", "modulator"),
        live=Live(
            setter="SetShaping",
            arg="value",
            state="shaper",
            enumeration=Enumeration.SHAPERS,
            join=Join.ENUM_ID,
            chain=Chain.SDM,
        ),
    ),
    replace(
        _KEPT,
        name="adaptive_volume",
        location=Attr("engine", "volume_adaptive"),
        domain=Flag(),
        live=Live(setter="SetAdaptiveVolume", arg="value", state="adaptive", enumeration=None, join=None, chain=None),
        live_control=True,
        snapshot=True,
        carry=Carry.REALIZED,
        volume_traced=True,
    ),
    replace(
        _KEPT,
        name="junk_filter",
        drop_on_snapshot_read=True,
        live=Live(
            setter="SetJunkFilter",
            arg="value",
            state="filter_junk",
            enumeration=Enumeration.JUNK_FILTERS,
            join=Join.INDEX,
            chain=None,
        ),
        live_control=True,
        carry=Carry.AUTOPILOT,
    ),
    replace(
        _KEPT,
        name="rate",
        live=Live(setter="SetRate", arg="value", state="rate", enumeration=Enumeration.RATES, join=Join.HZ, chain=None),
        live_control=True,
        carry=Carry.NOTHING,
    ),
    replace(
        _KEPT,
        name="volume",
        domain=Decimal(),
        live=Live(setter="Volume", arg="value", state="volume", enumeration=None, join=None, chain=None),
        carry=Carry.NOTHING,
    ),
    # MatrixSetProfile names no argument, and its list is not one of the five enumerations.
    replace(
        _KEPT,
        name="matrix_profile",
        live=Live(
            setter="MatrixSetProfile",
            arg="",
            state="matrix_profile",
            enumeration=None,
            join=Join.PROFILE_NAME,
            chain=None,
        ),
        snapshot=True,
        carry=Carry.NOTHING,
    ),
)

_ONE_ATTRIBUTE_FIELDS: tuple[Field, ...] = (
    replace(_KEPT, name="title", location=Attr("title", "value")),
    replace(_KEPT, name="backend", location=Attr("output", "type")),
    replace(_KEPT, name="samplerate", location=Attr("pcm", "samplerate"), forced="0"),
    replace(_KEPT, name="bitrate", location=Attr("sdm", "bitrate"), forced="0"),
    replace(_KEPT, name="defaults_samplerate", location=Attr("defaults", "samplerate")),
    replace(_KEPT, name="defaults_bitrate", location=Attr("defaults", "bitrate")),
    replace(_KEPT, name="defaults_volume", location=Attr("defaults", "volume"), volume_traced=True),
    replace(_KEPT, name="alsa_device", location=Attr("alsa", "device")),
    replace(_KEPT, name="alsa_bits", location=Attr("alsa", "dac_bits")),
    replace(_KEPT, name="alsa_period", location=Attr("alsa", "period_time")),
    replace(_KEPT, name="alsa_offset", location=Attr("alsa", "channel_offset")),
    replace(_KEPT, name="alsa_anydsd", location=Attr("alsa", "any_dsd")),
    replace(_KEPT, name="alsa_dop", location=Attr("alsa", "pack_sdm")),
    replace(_KEPT, name="net_bits", location=Attr("network", "dac_bits")),
    replace(_KEPT, name="net_period", location=Attr("network", "period_time")),
    replace(_KEPT, name="net_anydsd", location=Attr("network", "any_dsd")),
    replace(_KEPT, name="net_ipv6", location=Attr("network", "ipv6")),
    replace(_KEPT, name="net_dop", location=Attr("network", "pack_sdm")),
    replace(_KEPT, name="asio_device", location=Attr("asio", "device")),
    replace(_KEPT, name="asio_bits", location=Attr("asio", "dac_bits")),
    replace(_KEPT, name="asio_period", location=Attr("asio", "period_time")),
    replace(_KEPT, name="asio_offset", location=Attr("asio", "channel_offset")),
    replace(_KEPT, name="asio_anydsd", location=Attr("asio", "any_dsd")),
    replace(_KEPT, name="asio_dop", location=Attr("asio", "pack_sdm")),
    replace(_KEPT, name="wasapi_device", location=Attr("wasapi", "device")),
    replace(_KEPT, name="wasapi_bits", location=Attr("wasapi", "dac_bits")),
    replace(_KEPT, name="wasapi_period", location=Attr("wasapi", "period_time")),
    replace(_KEPT, name="wasapi_offset", location=Attr("wasapi", "channel_offset")),
    replace(_KEPT, name="wasapi_anydsd", location=Attr("wasapi", "any_dsd")),
    replace(_KEPT, name="wasapi_dop", location=Attr("wasapi", "pack_sdm")),
    replace(_KEPT, name="auto_family", location=Attr("engine", "auto_family"), forced="1"),
    replace(_KEPT, name="idle_time", location=Attr("engine", "idle_time")),
    replace(_KEPT, name="channels", location=Attr("engine", "channels")),
    replace(_KEPT, name="fft_size", location=Attr("engine", "fft_size")),
    replace(_KEPT, name="pipelines", location=Attr("engine", "pipelines")),
    replace(_KEPT, name="direct_sdm", location=Attr("engine", "direct_sdm")),
    replace(_KEPT, name="dsd_6db", location=Attr("engine", "dsd_6db")),
    replace(_KEPT, name="sdm_conversion", location=Attr("engine", "sdm_conversion")),
    replace(_KEPT, name="gain_comp", location=Attr("engine", "gain_comp")),
    replace(_KEPT, name="playlist_album_gain", location=Attr("engine", "playlist_album_gain")),
    replace(_KEPT, name="pre_before_meter", location=Attr("engine", "pre_before_meter")),
    replace(_KEPT, name="quick_pause", location=Attr("engine", "quick_pause")),
    replace(_KEPT, name="short_buffer", location=Attr("engine", "short_buffer")),
    replace(_KEPT, name="volume_max", location=Attr("engine", "volume_max"), volume_traced=True),
    replace(_KEPT, name="volume_min", location=Attr("engine", "volume_min"), volume_traced=True),
    replace(_KEPT, name="volume_fixed", location=Attr("engine", "volume_fixed"), lossy_form=True, volume_traced=True),
    replace(_KEPT, name="integrator", location=Attr("engine", "sdm_integrator")),
    replace(_KEPT, name="pcm_conversion", location=Attr("engine", "pdm_conv")),
    replace(_KEPT, name="noise_filter", location=Attr("engine", "pdm_filt")),
    replace(_KEPT, name="matrix_enabled", location=Attr("matrix", "enabled")),
    replace(_KEPT, name="matrix_engine", location=Attr("matrix", "engine")),
    replace(_KEPT, name="matrix_expand_hf", location=Attr("matrix", "expand_hf")),
    replace(_KEPT, name="matrix_iir2fir", location=Attr("matrix", "iir2fir")),
    replace(_KEPT, name="log_enabled", location=Attr("log", "enabled")),
    replace(_KEPT, name="log_file", location=Attr("log", "file")),
    replace(_KEPT, name="upnp_freewheel", location=Attr("upnp", "freewheel")),
)

_PLUGIN_FIELDS: tuple[Field, ...] = (
    replace(_KEPT, name="post_bauer_enabled", location=Plugin("bauer", "enabled")),
    replace(_KEPT, name="post_bauer_preset", location=Plugin("bauer", "preset")),
    replace(_KEPT, name="post_bauer_frequency", location=Plugin("bauer", "frequency")),
    replace(_KEPT, name="post_bauer_level", location=Plugin("bauer", "level")),
    replace(_KEPT, name="post_correction_enabled", location=Plugin("correction", "enabled")),
    replace(_KEPT, name="post_correction_dac0", location=Plugin("correction", "dac0")),
    replace(_KEPT, name="post_loudness_enabled", location=Plugin("loudness", "enabled")),
    replace(_KEPT, name="post_loudness_lowfreq", location=Plugin("loudness", "low_frequency")),
    replace(_KEPT, name="post_loudness_lowlevel", location=Plugin("loudness", "low_level")),
    replace(_KEPT, name="post_loudness_lowsteep", location=Plugin("loudness", "low_steepness")),
    replace(_KEPT, name="post_loudness_lowtype", location=Plugin("loudness", "low_type")),
    replace(_KEPT, name="post_loudness_highfreq", location=Plugin("loudness", "high_frequency")),
    replace(_KEPT, name="post_loudness_highlevel", location=Plugin("loudness", "high_level")),
    replace(_KEPT, name="post_loudness_highsteep", location=Plugin("loudness", "high_steepness")),
    replace(_KEPT, name="post_loudness_hightype", location=Plugin("loudness", "high_type")),
    replace(_KEPT, name="post_loudness_rangelow", location=Plugin("loudness", "range_low")),
    replace(_KEPT, name="post_loudness_rangehigh", location=Plugin("loudness", "range_high")),
)

_CODEC_FIELDS: tuple[Field, ...] = (
    replace(_KEPT, name="net_device", location=Codec.NET_DEVICE),
    replace(_KEPT, name="fixed_volume_enabled", location=Codec.FIXED_ENABLED, volume_traced=True),
    replace(_KEPT, name="fixed_volume", location=Codec.FIXED_LEVEL, volume_traced=True),
    replace(_KEPT, name="matrix_pipelines", location=Codec.PIPELINES),
    replace(_KEPT, name="matrix_profiles", location=Codec.PROFILES),
    replace(_KEPT, name="matrix_profile_save", location=Codec.PROFILE_SAVE),
    replace(_KEPT, name="matrix_profile_delete", location=Codec.PROFILE_DELETE),
)

_HARDWARE_FIELDS: tuple[Field, ...] = (
    replace(_KEPT, name="cuda", location=EngineAttr("cuda"), domain=Choice(values=("0", "1", "convolution"))),
    replace(_KEPT, name="multicore", location=EngineAttr("multicore"), domain=Choice(values=("auto", "0", "1"))),
    replace(_KEPT, name="ecores", location=EngineAttr("ecores"), domain=Choice(values=("default", "pool", "filter"))),
    replace(_KEPT, name="nblocks", location=EngineAttr("nblocks"), domain=Integer()),
    replace(_KEPT, name="cuda_dev", location=EngineAttr("cuda_dev"), domain=Integer()),
    replace(_KEPT, name="cuda_cdev", location=EngineAttr("cuda_cdev"), domain=Integer()),
)

_CONFIG_NUMBERS = frozenset(
    {
        "fixed_volume",
        "volume_max",
        "volume_min",
        "defaults_volume",
        "gain_comp",
        "channels",
        "alsa_offset",
        "alsa_bits",
        "alsa_period",
        "net_bits",
        "net_period",
        "asio_offset",
        "asio_bits",
        "asio_period",
        "wasapi_offset",
        "wasapi_bits",
        "wasapi_period",
    }
)
_MATRIX_NUMBERS = frozenset(
    {
        "post_bauer_frequency",
        "post_bauer_level",
        "post_loudness_lowfreq",
        "post_loudness_lowsteep",
        "post_loudness_lowlevel",
        "post_loudness_highfreq",
        "post_loudness_highsteep",
        "post_loudness_highlevel",
        "post_loudness_rangelow",
        "post_loudness_rangehigh",
    }
)


def _bounds(row: Field) -> BoundsSelector | None:
    if row.name in _CONFIG_NUMBERS:
        return BoundsSelector("config_form", row.name)
    if row.name in _MATRIX_NUMBERS:
        return BoundsSelector("matrix_form", row.name)
    if row.live is not None and row.live.setter == "Volume":
        return BoundsSelector("volume_range", row.name)
    return BoundsSelector(None, row.name) if isinstance(row.domain, (Integer, Decimal)) else None


def _file_selector(row: Field) -> FileSelector | None:
    if isinstance(row.location, EngineAttr):
        return FileSelector("engine", row.location.attr)
    return FileSelector("file_config", row.name) if row.location is not None else None


def _read_lane(row: Field) -> Literal["live", "restore", "form", "matrix", "volume"]:
    if row.live is None:
        return "form" if isinstance(row.location, Attr) and row.location.tag == "matrix" else "restore"
    lanes: dict[str, Literal["live", "volume", "matrix"]] = {"Volume": "volume", "MatrixSetProfile": "matrix"}
    return lanes.get(row.live.setter, "live")


def _read_descriptor(row: Field) -> ReadDescriptor | None:
    if row.forced is not None or row.location in (Codec.PROFILE_SAVE, Codec.PROFILE_DELETE):
        return None
    return ReadDescriptor(
        file=_file_selector(row),
        bounds=_bounds(row),
        lane=_read_lane(row),
        show="engine" if row.live is not None else "file",
        restarts=row.live is None,
    )


FIELDS: tuple[Field, ...] = tuple(
    replace(row, read=_read_descriptor(row))
    for row in (*_SETTER_FIELDS, *_ONE_ATTRIBUTE_FIELDS, *_PLUGIN_FIELDS, *_CODEC_FIELDS, *_HARDWARE_FIELDS)
)

SETTERS: tuple[Setter, ...] = (  # in apply order
    Setter(
        key="mode",
        command="SetMode",
        stageable=True,
        tolerance=None,
        value_fills=False,
    ),
    Setter(
        key="filter",
        command="SetFilter",
        stageable=True,
        tolerance=None,
        value_fills=True,
    ),
    Setter(
        key="shaper",
        command="SetShaping",
        stageable=True,
        tolerance=None,
        value_fills=False,
    ),
    Setter(
        key="rate",
        command="SetRate",
        stageable=False,
        tolerance=None,
        value_fills=False,
    ),
    Setter(
        key="junk_filter",
        command="SetJunkFilter",
        stageable=True,
        tolerance=None,
        value_fills=False,
    ),
    Setter(
        key="adaptive_volume",
        command="SetAdaptiveVolume",
        stageable=True,
        tolerance=None,
        value_fills=False,
    ),
    Setter(
        key="volume",
        command="Volume",
        stageable=True,
        tolerance=0.05,
        value_fills=False,
    ),
)

HOST_INTERFACES: tuple[Attr, ...] = (Attr("upnp", "interface"), Attr("network", "mcast_interface"))

DEVICE_FIELDS: Mapping[str, str | None] = MappingProxyType(  # backend -> the field naming its device
    {
        "network": "net_device",
        "alsa": "alsa_device",
        "asio": "asio_device",
        "wasapi": "wasapi_device",
        "combo": None,  # it drives both devices and the daemon announces one
    }
)

PROOFS: Mapping[Codec, Codec] = MappingProxyType(  # write-only verb -> the read-only codec whose readback proves it
    {Codec.PROFILE_SAVE: Codec.PROFILES, Codec.PROFILE_DELETE: Codec.PROFILES}
)
