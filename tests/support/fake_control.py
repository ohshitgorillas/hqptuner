"""The fake hqplayerd Control API daemon — real XML over a real socket.

Split out of `conftest` on size alone. It keeps a settings dict and answers
setters plus `State` from it, so a `Set*` followed by `State` reads the change
back, which is what exercises the readback-verify path. Several wire quirks are
modeled because the write-path tests turn on them: `value="999"` answers
`result="OK"` without applying (the OK-is-not-proof caveat, protocol.md §6),
`value="err"` answers `result="Error"`, `SetMode` resets `rate` to `0` (the mode
swaps the lists a rate is relative to), and the filter/shaper/rate enumerations
answer for the chain the engine has LOADED rather than the one configured, which
in `[source]` mode is whatever the source left running (readme §1.7).

The port-8088 HTTP fake is `fake_http`; the fixtures over both are in `conftest`.
"""

import asyncio
from collections.abc import Mapping
from types import MappingProxyType

from defusedxml.ElementTree import fromstring as _fromstring

XML = '<?xml version="1.0" encoding="UTF-8"?>'

#: Every command the fake was asked, in order: (name, attrs).
CommandLog = list[tuple[str, dict[str, str]]]


DEFAULTS = {
    "state": "0",
    "mode": "1",
    "filter1x": "0",
    "filterNx": "0",
    "shaper": "0",
    "rate": "0",
    "filter_junk": "0",
    "adaptive": "0",
    "volume": "-10.0",
    "matrix_profile": "",
    # The profile names `MatrixListProfiles` answers with, newline separated (a
    # profile name may contain spaces, so the space-separated convention the
    # `_deaf`/`_stall` knobs use cannot carry them). Which names a daemon knows is
    # per-machine and changes across a restart — a profile whose <matrix_profile>
    # element left the config is one the restarted daemon no longer lists.
    "_profile_names": "Default\nMch-to-Stereo mixdown",
    # underscore keys are internal to the fake (VolumeRange source), not emitted in State
    "_vol_min": "-60",
    "_vol_max": "0",
    "_vol_enabled": "1",
    "_vol_adaptive": "0",
    "_metadata": "",  # optional <metadata> child injected into the Status frame
    # The junk-filter enumeration this daemon answers with, space separated in
    # list order (protocol.md §6: `<JunkFiltersItem index name value/>`); empty
    # means the built-in list below.
    "_junk_filters": "",
    # Space-separated commands answered `result="OK"` without applying: the
    # `value="999"` caveat above (protocol.md §4), keyed by command instead.
    "_deaf": "",
    # Space-separated commands answered NOT AT ALL — the connection stays open and
    # nothing comes back, so the client's read deadline is what ends the wait. What
    # hqplayerd 6.0.4 did with SetMode when the mode switch took the engine down
    # under it (2026-07-29, /tmp/hqplayerd.log): command accepted, no response,
    # connection dropped later. Distinct from `_deaf`, which does answer.
    "_stall": "",
    # Space-separated commands on which the connection is DROPPED: the command is
    # received and logged, nothing comes back, and the socket closes under the
    # client. The other half of what hqplayerd 6.0.4 does while SetFilter/SetMode
    # take the audio engine down (2026-07-29) — the setter itself is answered and
    # a LATER command dies with the connection. Distinct from `_stall`, which
    # keeps the connection open, so the client waits out its deadline instead.
    "_close": "",
    # Space-separated commands the daemon REFUSES, reads as readily as writes: the
    # command is received and answered `result="Error"`, with the daemon's
    # diagnostic as the element's own text (protocol.md §6). `_error_text` is that
    # diagnostic. What hqplayerd 6.0.4 does to `MatrixSetProfile` with an empty
    # playlist: the switch is refused, not stalled and not silently dropped.
    "_error": "",
    "_error_text": "refused",
    # Which family the SOURCE is, which in [source] mode is which chain the engine
    # has loaded (readme §1.7). Named for the Status attribute it used to be
    # emitted as verbatim; it no longer is, because the daemon echoes "[source]"
    # there rather than resolving (see _reported_mode). With a mode configured the
    # string does go out as-is — verified against the live daemon (hqplayerd 6.0.4,
    # 2026-07-27): configured mode 2 reports active_mode="SDM (DSD)",
    # byte-identical to ModesItem index 2. Empty means nothing is playing.
    "_active_mode": "PCM",
    # The rates enumeration each family answers with, space separated in Hz and
    # in list order, index 0 first (protocol.md §6: `<RatesItem index rate/>`,
    # index 0 is rate="0" = auto). `_rates` is the PCM family's, `_sdm_rates` the
    # SDM one; empty means that family's built-in list below, so the enumeration
    # stays mode-dependent whichever knob a test sets.
    #
    # What is established about the real list: `GetRates` is answered per mode AND
    # per transport state, and a snapshot taken right after a reconnect with the
    # transport idle held the auto entry alone. Whether asking again fills such a
    # list in is NOT established — `scripts/probes/rate/probe_rates_on_demand.py`
    # against 6.0.4 could not reproduce the short answer at all (two fresh
    # connections, three `GetRates` each, all six the full 11-item ladder). So the
    # knob says only what a daemon answered, never why.
    "_rates": "",
    "_sdm_rates": "",
    # What Status.active_filter reports — the ACTIVE main filter as a display
    # string (protocol.md: Status reports display strings, State numeric
    # indices). Empty means the frame carries no active_filter attribute at all.
    "_active_filter": "poly-sinc-gauss-long",
}


def _reload_shaper(state: dict[str, str]) -> None:
    """What a mode switch does to the shaper pin: SetMode loads the entered
    chain from the daemon's config file, so the fresh chain's shaper is the
    FILE's dither/modulator — never the previous chain's pin carried across
    (protocol.md §SetMode: the enumeration lists swap wholesale). Opt-in via
    the ``_cfg_dither`` / ``_cfg_modulator`` knobs (enum IDs, config-file
    domain), resolved on the loaded chain's own list; a state without the knobs
    keeps the fake's old carry-the-pin behavior, so existing suites see no
    change."""
    sdm = _active_sdm(state)
    enum_id = state.get("_cfg_modulator" if sdm else "_cfg_dither")
    if enum_id is None:
        return
    for index, _name, value in _SDM_SHAPERS if sdm else _PCM_SHAPERS:
        if value == enum_id:
            state["shaper"] = index


def apply_setter(name: str, attrs: dict[str, str], state: dict[str, str]) -> None:
    value = attrs.get("value", "")
    if name == "SetMode":
        state["mode"] = value
        state["rate"] = "0"  # mode resets rate to auto (protocol.md §6)
        _reload_shaper(state)  # the entered chain comes up on the FILE's shaper
    elif name == "SetFilter":
        state["filterNx"] = value
        state["filter1x"] = attrs.get("value1x", value)
    elif name == "SetShaping":
        state["shaper"] = value
    elif name == "SetRate":
        # Stores whatever arrived. The real daemon accepts and silently IGNORES a
        # value that is not a current `RatesItem` index (protocol.md §6, verified
        # 2026-07-29), which this does not model: `tests/apply/test_apply.py` pins
        # rate index "5", a legitimate index of the real 11-item ladder that the
        # abbreviated lists below do not reach, so enforcing it here would red two
        # tests over the fake's list length rather than over any behavior.
        state["rate"] = value
    elif name == "SetJunkFilter":
        state["filter_junk"] = value
    elif name == "SetAdaptiveVolume":
        state["adaptive"] = value
    elif name == "Volume":
        state["volume"] = value
    elif name == "MatrixSetProfile":
        state["matrix_profile"] = value  # live switch; State reports it back


# Enumerations are MODE-DEPENDENT on the real daemon: GetFilters/GetShapers
# answer for the ACTIVE mode only, and the two chains number their enum IDs
# differently — poly-sinc-gauss-long is enum 37 under PCM `filter` and 40 under
# SDM `oversampling` (protocol.md §4, readme §1.5/§1.6). The fake models both
# facts because the live-routing chain gate exists precisely to protect them.
#
# The lists are the captured 6.0.4 config page's `filter`, `oversampling`,
# `dither` and `modulator` selects, option for option in the page's order (the
# index is the position, the name the option label, the enum ID the option
# value), so a test's choices come from the page.
#
# The two lists also deliberately SHARE enum IDs under different names: enum 0
# is `none` at PCM index 0 and `poly-sinc-lp` at SDM index 6, and enum 57 is
# `IIR2` at PCM index 2 and `poly-sinc-hb-s-2s` at SDM index 15. Without a
# shared ID a lookup against the stale chain's list simply misses, so the
# outcome an index resolved against the wrong list really has — a different
# filter, silently — could not be expressed.
_MODES = (("0", "[source]", "-1"), ("1", "PCM", "0"), ("2", "SDM (DSD)", "1"))
_PCM_FILTERS = (
    ("0", "none", "0"),
    ("1", "IIR", "1"),
    ("2", "IIR2", "57"),
    ("3", "FIR", "2"),
    ("4", "asymFIR", "3"),
    ("5", "minphaseFIR", "4"),
    ("6", "FFT", "5"),
    ("7", "poly-sinc-lp", "6"),
    ("8", "poly-sinc-mp", "7"),
    ("9", "poly-sinc-short-lp", "8"),
    ("10", "poly-sinc-short-mp", "9"),
    ("11", "poly-sinc-long-lp", "26"),
    ("12", "poly-sinc-long-ip", "27"),
    ("13", "poly-sinc-long-mp", "28"),
    ("14", "poly-sinc-hb", "14"),
    ("15", "poly-sinc-hb-xs", "53"),
    ("16", "poly-sinc-hb-s", "54"),
    ("17", "poly-sinc-hb-m", "55"),
    ("18", "poly-sinc-hb-l", "56"),
    ("19", "poly-sinc-ext", "15"),
    ("20", "poly-sinc-ext2", "24"),
    ("21", "poly-sinc-ext2-short", "60"),
    ("22", "poly-sinc-ext2-medium", "61"),
    ("23", "poly-sinc-ext2-long", "62"),
    ("24", "poly-sinc-ext2-xla", "32"),
    ("25", "poly-sinc-ext2-xl", "63"),
    ("26", "poly-sinc-ext2-hires-lp", "64"),
    ("27", "poly-sinc-ext2-hires-ip", "65"),
    ("28", "poly-sinc-ext2-hires-mp", "66"),
    ("29", "poly-sinc-mqa/mp3-lp", "18"),
    ("30", "poly-sinc-mqa/mp3-mp", "19"),
    ("31", "poly-sinc-xtr-lp", "21"),
    ("32", "poly-sinc-xtr-mp", "22"),
    ("33", "poly-sinc-xtr-short-lp", "33"),
    ("34", "poly-sinc-xtr-short-mp", "34"),
    ("35", "poly-sinc-gauss-short", "35"),
    ("36", "poly-sinc-gauss-medium", "36"),
    ("37", "poly-sinc-gauss-long", "37"),
    ("38", "poly-sinc-gauss-xla", "39"),
    ("39", "poly-sinc-gauss-xl", "38"),
    ("40", "poly-sinc-gauss-hires-lp", "40"),
    ("41", "poly-sinc-gauss-hires-ip", "41"),
    ("42", "poly-sinc-gauss-hires-mp", "42"),
    ("43", "poly-sinc-gauss-halfband", "51"),
    ("44", "poly-sinc-gauss-halfband-s", "52"),
    ("45", "ASRC", "10"),
    ("46", "polynomial-1", "11"),
    ("47", "polynomial-2", "12"),
    ("48", "minringFIR-lp", "13"),
    ("49", "minringFIR-mp", "20"),
    ("50", "closed-form", "16"),
    ("51", "closed-form-fast", "17"),
    ("52", "closed-form-M", "23"),
    ("53", "sinc-S", "29"),
    ("54", "sinc-M", "25"),
    ("55", "sinc-Mx", "31"),
    ("56", "sinc-MG", "46"),
    ("57", "sinc-MGa", "47"),
    ("58", "sinc-L", "30"),
    ("59", "sinc-Ls", "43"),
    ("60", "sinc-Lm", "44"),
    ("61", "sinc-Ll", "45"),
    ("62", "sinc-Lh", "58"),
    ("63", "sinc-short", "48"),
    ("64", "sinc-medium", "49"),
    ("65", "sinc-long", "50"),
    ("66", "sinc-long-h", "59"),
)
_SDM_FILTERS = (
    ("0", "IIR", "64"),
    ("1", "IIR2", "65"),
    ("2", "FIR", "61"),
    ("3", "asymFIR", "62"),
    ("4", "minphaseFIR", "63"),
    ("5", "FFT", "60"),
    ("6", "poly-sinc-lp", "0"),
    ("7", "poly-sinc-mp", "1"),
    ("8", "poly-sinc-short-lp", "2"),
    ("9", "poly-sinc-short-mp", "3"),
    ("10", "poly-sinc-long-lp", "24"),
    ("11", "poly-sinc-long-ip", "25"),
    ("12", "poly-sinc-long-mp", "26"),
    ("13", "poly-sinc-hb", "5"),
    ("14", "poly-sinc-hb-xs-2s", "56"),
    ("15", "poly-sinc-hb-s-2s", "57"),
    ("16", "poly-sinc-hb-m-2s", "58"),
    ("17", "poly-sinc-hb-l-2s", "59"),
    ("18", "poly-sinc-ext", "11"),
    ("19", "poly-sinc-ext2", "22"),
    ("20", "poly-sinc-ext2-short", "70"),
    ("21", "poly-sinc-ext2-medium", "71"),
    ("22", "poly-sinc-ext2-long", "72"),
    ("23", "poly-sinc-ext2-xla", "32"),
    ("24", "poly-sinc-ext2-xl", "73"),
    ("25", "poly-sinc-ext2-hires-lp", "74"),
    ("26", "poly-sinc-ext2-hires-ip", "75"),
    ("27", "poly-sinc-ext2-hires-mp", "76"),
    ("28", "poly-sinc-mqa/mp3-lp", "14"),
    ("29", "poly-sinc-mqa/mp3-mp", "15"),
    ("30", "poly-sinc-xtr-lp", "17"),
    ("31", "poly-sinc-xtr-mp", "18"),
    ("32", "poly-sinc-xtr-short-lp", "34"),
    ("33", "poly-sinc-xtr-short-mp", "35"),
    ("34", "poly-sinc-lp-2s", "6"),
    ("35", "poly-sinc-mp-2s", "7"),
    ("36", "poly-sinc-short-lp-2s", "8"),
    ("37", "poly-sinc-short-mp-2s", "9"),
    ("38", "poly-sinc-long-lp-2s", "27"),
    ("39", "poly-sinc-long-ip-2s", "28"),
    ("40", "poly-sinc-long-mp-2s", "29"),
    ("41", "poly-sinc-hb-2s", "10"),
    ("42", "poly-sinc-xtr-lp-2s", "19"),
    ("43", "poly-sinc-xtr-mp-2s", "20"),
    ("44", "poly-sinc-xtr-short-lp-2s", "36"),
    ("45", "poly-sinc-xtr-short-mp-2s", "37"),
    ("46", "poly-sinc-gauss-short", "38"),
    ("47", "poly-sinc-gauss-medium", "39"),
    ("48", "poly-sinc-gauss-long", "40"),
    ("49", "poly-sinc-gauss-xla", "42"),
    ("50", "poly-sinc-gauss-xl", "41"),
    ("51", "poly-sinc-gauss-hires-lp", "43"),
    ("52", "poly-sinc-gauss-hires-ip", "44"),
    ("53", "poly-sinc-gauss-hires-mp", "45"),
    ("54", "poly-sinc-gauss-halfband", "54"),
    ("55", "poly-sinc-gauss-halfband-s", "55"),
    ("56", "polynomial-1", "66"),
    ("57", "polynomial-2", "67"),
    ("58", "minringFIR-lp", "4"),
    ("59", "minringFIR-mp", "16"),
    ("60", "closed-form", "12"),
    ("61", "closed-form-fast", "13"),
    ("62", "closed-form-16M", "21"),
    ("63", "sinc-S", "30"),
    ("64", "sinc-M", "23"),
    ("65", "sinc-Mx", "33"),
    ("66", "sinc-MG", "49"),
    ("67", "sinc-MGa", "50"),
    ("68", "sinc-L", "31"),
    ("69", "sinc-Ls", "46"),
    ("70", "sinc-Lm", "47"),
    ("71", "sinc-Ll", "48"),
    ("72", "sinc-Lh", "68"),
    ("73", "sinc-short", "51"),
    ("74", "sinc-medium", "52"),
    ("75", "sinc-long", "53"),
    ("76", "sinc-long-h", "69"),
)
_PCM_SHAPERS = (
    ("0", "none", "0"),
    ("1", "NS1", "1"),
    ("2", "NS4", "2"),
    ("3", "NS5", "7"),
    ("4", "NS9", "3"),
    ("5", "LNS15", "9"),
    ("6", "RPDF", "4"),
    ("7", "TPDF", "5"),
    ("8", "Gauss1", "8"),
    ("9", "shaped", "6"),
)
_SDM_SHAPERS = (
    ("0", "DSD5", "0"),
    ("1", "DSD5v2", "1"),
    ("2", "DSD5v2 256+fs", "3"),
    ("3", "DSD5EC", "9"),
    ("4", "ASDM5", "5"),
    ("5", "ASDM5EC", "10"),
    ("6", "ASDM5ECv2", "13"),
    ("7", "ASDM5ECv3", "15"),
    ("8", "ASDM5EC-ul", "28"),
    ("9", "ASDM5EC-light", "17"),
    ("10", "ASDM5EC-fast", "32"),
    ("11", "ASDM5EC-super", "19"),
    ("12", "ASDM5EC-ul 512+fs", "30"),
    ("13", "ASDM5EC-light 512+fs", "21"),
    ("14", "ASDM5EC-fast 512+fs", "34"),
    ("15", "ASDM5EC-super 512+fs", "23"),
    ("16", "DSD7", "2"),
    ("17", "DSD7 256+fs", "4"),
    ("18", "ASDM7", "6"),
    ("19", "ASDM7EC", "11"),
    ("20", "ASDM7ECv2", "14"),
    ("21", "ASDM7ECv3", "16"),
    ("22", "ASDM7EC-ul", "29"),
    ("23", "ASDM7EC-light", "18"),
    ("24", "ASDM7EC-fast", "33"),
    ("25", "ASDM7EC-super", "20"),
    ("26", "ASDM7EC-ul 512+fs", "31"),
    ("27", "ASDM7EC-light 512+fs", "22"),
    ("28", "ASDM7EC-fast 512+fs", "35"),
    ("29", "ASDM7EC-super 512+fs", "24"),
    ("30", "AMSDM7 512+fs", "7"),
    ("31", "AMSDM7EC 512+fs", "12"),
    ("32", "AHM5EC5L", "26"),
    ("33", "AHM7EC5L", "8"),
    ("34", "AHM5EC8B", "27"),
    ("35", "AHM7EC8B", "25"),
)
_JUNK_FILTERS = (("0", "none", "0"), ("1", "20k", "1"), ("2", "30k", "2"))

# `RatesItem` carries no `value`: it is `<RatesItem index rate/>` with the actual
# rate in Hz and index 0 = auto (protocol.md §6). Mode-dependent for real, and
# each mode offers BOTH base families; the 48k-base members sit last here so no
# existing index moves, not because the daemon orders them that way.
_PCM_RATES = (("0", "0"), ("1", "44100"), ("2", "352800"), ("3", "705600"), ("4", "384000"))
_SDM_RATES = (("0", "0"), ("1", "2822400"), ("2", "5644800"), ("3", "12288000"))


def take_lane_down(state: dict[str, str]) -> None:
    """Take the control lane down for good: the connection already open is
    severed the next time either side uses it (a generation bump: the daemon
    reading a stale generation off a live connection closes it unanswered), and
    every later connect attempt is refused outright. Nothing here ever comes
    back up."""
    state["_generation"] = str(int(state.get("_generation", "0")) + 1)
    state["_down"] = "1"


def restart_into(state: dict[str, str], mode: str, dither: str, modulator: str) -> None:
    """Move the fake's State to what a daemon reports after a restore's
    self-restart: it comes back up running the restored config file
    (docs/architecture.md §2.2 lane 2). The file speaks ``pcm``/``sdm`` and enum
    IDs; State speaks the mode index and list indices resolved against the
    chain the restart loaded (protocol.md §4 — the domains never mix), so the
    restored shaper is the loaded chain's dither or modulator looked up on that
    chain's own enumeration. The restored file also becomes the per-chain
    shaper a later ``SetMode`` loads (``_reload_shaper``)."""
    state["mode"] = {"pcm": "1", "sdm": "2"}.get(mode, "0")
    state["_cfg_dither"] = dither
    state["_cfg_modulator"] = modulator
    _reload_shaper(state)
    # the restart itself, as the wire sees it: every open connection is severed,
    # and the first connect inside the restart window is turned away
    state["_generation"] = str(int(state.get("_generation", "0")) + 1)
    state["_refuse_connects"] = "1"


def _items(tag: str, rows: tuple[tuple[str, str, str], ...]) -> str:
    return "".join(f'<{tag} index="{i}" name="{n}" value="{v}"/>' for i, n, v in rows)


#: A `FiltersItem` carries `arg` and `description` as well, and it is the only
#: enumeration that carries either (protocol.md §GetFilters). `description` is
#: the engine's own facet string, `"<quality>/5 [focus] <glyph> <ratio>"`, and
#: every filter the daemon enumerates carries one — so a filter served without
#: it is narrowed out of the dropdowns by the quality facet. `arg` is a flags
#: bitfield whose bit 0 (`0x00000001`) is the apodizing flag.
#:
#: The pass-through's description is the engine's own, and its `arg` is 0: it
#: resamples nothing, so it apodizes nothing. The resamplers carry a rating that
#: clears the quality facet's default floor and the apodizing bit set, no case
#: here being about either facet.
_FILTER_DESCRIPTIONS = {"none": "1/5 ⥮ 1:1"}
_DEFAULT_FILTER_DESCRIPTION = "4/5 ⥮ Any"
_FILTER_ARGS = {"none": "0"}
_DEFAULT_FILTER_ARG = "1"


def _filter_items(rows: tuple[tuple[str, str, str], ...]) -> str:
    return "".join(
        f'<FiltersItem index="{i}" name="{n}" value="{v}" '
        f'arg="{_FILTER_ARGS.get(n, _DEFAULT_FILTER_ARG)}" '
        f'description="{_FILTER_DESCRIPTIONS.get(n, _DEFAULT_FILTER_DESCRIPTION)}"/>'
        for i, n, v in rows
    )


def _junk_filters(state: dict[str, str]) -> tuple[tuple[str, str, str], ...]:
    """The junk filters this daemon answers `GetJunkFilters` with.

    The `_junk_filters` knob names the list outright, space separated, so a test
    can serve an enumeration that differs from the built-in one — which is what a
    different engine build really does answer (architecture §3.1: the running
    engine is the authority on the names and the ordering). Empty means the
    built-in list.
    """
    named = state.get("_junk_filters", "")
    if named:
        return tuple((str(i), n, str(i)) for i, n in enumerate(named.split()))
    return _JUNK_FILTERS


def _rate_items(rows: tuple[tuple[str, str], ...]) -> str:
    return "".join(f'<RatesItem index="{i}" rate="{r}"/>' for i, r in rows)


def _rates(state: dict[str, str], *, sdm: bool) -> tuple[tuple[str, str], ...]:
    """The rates this daemon answers `GetRates` with for the loaded family.

    The knobs name the list outright, per family, so a test can serve an
    enumeration that differs from the built-in one — and can move it between one
    `GetRates` and the next, which is what tells a lane that re-asks apart from
    one that answers out of a list it took earlier."""
    named = state.get("_sdm_rates", "") if sdm else state.get("_rates", "")
    if named:
        return tuple((str(i), hz) for i, hz in enumerate(named.split()))
    return _SDM_RATES if sdm else _PCM_RATES


def _modes(state: dict[str, str]) -> tuple[tuple[str, str, str], ...]:
    """The modes this device offers. Real ones differ: a DAC that cannot do DSD
    gets a list with no SDM entry at all, which is why nothing may key a mode off
    a fixed index. ``_no_sdm`` asks the fake for such a device — and the remaining
    entries keep their own indices, so a caller that hardcoded them still finds
    something and still gets it wrong."""
    if not state.get("_no_sdm"):
        return _MODES
    return tuple(mode for mode in _MODES if not mode[1].startswith("SDM"))


def _active_sdm(state: dict[str, str]) -> bool:
    """Whether the chain the fake currently has LOADED is the SDM one.

    Not the same question as the configured mode. In ``[source]`` the engine
    follows the source (readme §1.7) and ``Status.active_mode`` is what reports
    which chain that left loaded — so a fake that scoped its lists by the
    configured mode alone could not represent the source changing family, which
    is the one thing ``[source]`` mode does.
    """
    mode = state.get("mode")
    if mode in ("1", "2"):
        return mode == "2"
    return state["_active_mode"].upper().startswith(("SDM", "DSD"))


def _reported_mode(state: dict[str, str]) -> str:
    """What ``Status.active_mode`` says on the wire.

    It resolves to the mode's display name only when one is CONFIGURED. In
    ``[source]`` the daemon echoes ``"[source]"`` straight back rather than naming
    the family it settled on — measured 2026-07-29 while playing PCM
    (``scripts/probes/rate/probe_rate_playing.py``). So ``_active_mode`` is the fake's knob for
    which family the SOURCE is, and this is what actually goes out.
    """
    return state.get("_active_mode", "") if state.get("mode") in ("1", "2") else "[source]"


def _active_rate(state: dict[str, str]) -> str:
    """The rate the fake is running at, or ``"0"`` when it is running nothing.

    Carried because it is the only thing on the Status frame that tells ``[source]``
    mode which chain is loaded, ``active_mode`` having declined to
    (``routing._chain_from_status``). Nothing loaded is nothing running: no
    configured family and no source family means no rate, which is what says
    "unknowable" rather than guessing PCM.
    """
    if state.get("mode") not in ("1", "2") and not state.get("_active_mode"):
        return "0"
    return "2822400" if _active_sdm(state) else "192000"


def _enumeration(name: str, state: dict[str, str]) -> str | None:
    """GetModes/GetFilters/GetShapers, scoped to the chain the fake has loaded."""
    sdm = _active_sdm(state)
    if name == "GetModes":
        return f"<GetModes>{_items('ModesItem', _modes(state))}</GetModes>"
    if name == "GetFilters":
        return f"<GetFilters>{_filter_items(_SDM_FILTERS if sdm else _PCM_FILTERS)}</GetFilters>"
    if name == "GetShapers":
        return f"<GetShapers>{_items('ShapersItem', _SDM_SHAPERS if sdm else _PCM_SHAPERS)}</GetShapers>"
    if name == "GetRates":
        return f"<GetRates>{_rate_items(_rates(state, sdm=sdm))}</GetRates>"
    if name == "GetJunkFilters":
        return f"<GetJunkFilters>{_items('JunkFiltersItem', _junk_filters(state))}</GetJunkFilters>"
    return None


def _query(name: str, state: dict[str, str]) -> str | None:
    """Read-only commands answered from state; None for setters."""
    enumerated = _enumeration(name, state)
    if enumerated is not None:
        return enumerated
    if name == "GetInfo":
        # The full attribute set of docs/protocol.md:157, in the order the
        # verified 6.0.4 response carries them (docs/protocol.md:160).
        return (
            '<GetInfo engine="6.0.4" name="Fake" platform="Linux"'
            ' product="Signalyst HQPlayer Embedded" version="6"/>'
        )
    if name == "GetLicense":
        return '<GetLicense valid="1" name="Fake Licensee" fingerprint="AAAA"/>'
    if name == "ConfigurationGet":
        return f'<ConfigurationGet result="OK" value="{state.get("_active_config", "")}"/>'
    if name == "MatrixListProfiles":
        names = [n for n in state.get("_profile_names", "").split("\n") if n]
        items = "".join(f'<MatrixProfile name="{n}"/>' for n in names)
        return f'<MatrixListProfiles result="OK">{items}</MatrixListProfiles>'
    if name == "MatrixGetProfile":
        return f'<MatrixGetProfile result="OK" value="{state.get("_matrix_profile", "")}"/>'
    if name == "State":
        return "<State " + " ".join(f'{k}="{v}"' for k, v in state.items() if not k.startswith("_")) + "/>"
    if name == "VolumeRange":
        return (
            f'<VolumeRange min="{state["_vol_min"]}" max="{state["_vol_max"]}" '
            f'enabled="{state["_vol_enabled"]}" adaptive="{state["_vol_adaptive"]}"/>'
        )
    if name == "Status":
        # active_* live on the Status root; the track <metadata> child is where the
        # daemon emits unescaped chars mid-playback (_metadata override).
        active_filter = state["_active_filter"]
        filter_attr = f'active_filter="{active_filter}" ' if active_filter else ""
        return (
            f'<Status state="{state["state"]}" active_mode="{_reported_mode(state)}" '
            f'{filter_attr}active_shaper="NS9" '
            f'active_rate="{_active_rate(state)}" volume="{state["volume"]}">'
            f'{state["_metadata"]}</Status>'
        )
    return None


class Close:
    """What the fake returns instead of a frame when it drops the connection."""


#: Singleton of the above: the daemon received the command, logged it, answered
#: nothing, and closed the socket (the `_close` knob).
CLOSE = Close()


def handle(body: str, state: dict[str, str], log: CommandLog | None = None) -> str | Close | None:
    """The answer to one command: a frame, `CLOSE` for a command the fake drops
    the connection on, or None for one it stalls on."""
    el = _fromstring(body)
    name, attrs = el.tag, el.attrib
    if log is not None:
        log.append((name, dict(attrs)))
    if name in state.get("_close", "").split():
        return CLOSE  # received, logged, connection dropped without an answer
    if name in state["_stall"].split():
        return None  # received, logged, never answered
    if name in state.get("_error", "").split():
        # above the query dispatch: a daemon refuses reads as readily as writes
        return f'<{name} result="Error">{state.get("_error_text", "refused")}</{name}>'
    answer = _query(name, state)
    if answer is not None:
        return answer
    if name == "Volume" and state["_vol_enabled"] == "0":
        return '<Volume result="Error"/>'  # volume control disabled (protocol.md §6)
    value = attrs.get("value")
    if value == "err":
        return f'<{name} result="Error">bad value</{name}>'
    deaf = state["_deaf"].split()
    if value != "999" and name not in deaf:  # 999 = OK but not applied (readback-verify caveat)
        apply_setter(name, attrs, state)
    return f'<{name} result="OK"/>'


async def serve(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    overrides: Mapping[str, str] = MappingProxyType({}),
    log: CommandLog | None = None,
) -> None:
    """One connection to a daemon of its own: a State built from `DEFAULTS` and `overrides`."""
    await serve_shared(reader, writer, {**DEFAULTS, **overrides}, log)


async def serve_shared(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    state: dict[str, str],
    log: CommandLog | None = None,
) -> None:
    # A caller that passes `state` shares ONE dict across every connection, the
    # way a real daemon does — which is what lets a test move the fake mid-session
    # (a new track changing `_active_mode`) and have the manager's open connection
    # see it. Without it each connection gets its own, and the move is invisible.
    if state.get("_down") == "1":
        # `take_lane_down`: refuse every connection from here on, the way a
        # daemon that has gone away answers nothing at all
        writer.close()
        return
    refused = int(state.get("_refuse_connects", "0"))
    if refused:
        # inside a restart window: the connect lands and goes away unanswered
        state["_refuse_connects"] = str(refused - 1)
        writer.close()
        return
    generation = state.get("_generation", "0")
    while True:
        data = await reader.read(4096)
        if not data or state.get("_generation", "0") != generation:
            break  # closed by the client, or severed by a restart since it connected
        body = data.split(b"?>", 1)[-1].strip().decode()
        answer = handle(body, state, log)
        if isinstance(answer, Close):
            break  # dropped: the socket goes away with nothing on it
        if answer is None:
            continue  # stalled: keep the connection open and say nothing
        writer.write(f"{XML}{answer}\n".encode())
        await writer.drain()
    writer.close()
