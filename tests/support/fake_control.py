"""The fake hqplayerd Control API daemon — real XML over a real socket.

Split out of `conftest` on size alone. It keeps a settings dict and answers
setters plus `State` from it, so a `Set*` followed by `State` reads the change
back, which is what exercises the readback-verify path. Several wire quirks are
modelled because the write-path tests turn on them: `value="999"` answers
`result="OK"` without applying (the OK-is-not-proof caveat, protocol.md §6),
`value="err"` answers `result="Error"`, `SetMode` resets `rate` to `0` (the mode
swaps the lists a rate is relative to), and the filter/shaper/rate enumerations
answer for the chain the engine has LOADED rather than the one configured, which
in `[source]` mode is whatever the source left running (readme §1.7).

The port-8088 HTTP fake is `fake_http`; the fixtures over both are in `conftest`.
"""

import asyncio

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
    # list in is NOT established — `scripts/probes/probe_rates_on_demand.py`
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


def apply_setter(name: str, attrs: dict[str, str], state: dict[str, str]) -> None:
    value = attrs.get("value", "")
    if name == "SetMode":
        state["mode"] = value
        state["rate"] = "0"  # mode resets rate to auto (protocol.md §6)
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
        # tests over the fake's list length rather than over any behaviour.
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
# differently — poly-sinc-gauss-long is enum 40 under PCM `filter` and 38 under
# SDM `oversampling` (protocol.md §4, readme §1.5/§1.6). The fake models both
# facts because the live-routing chain gate exists precisely to protect them.
_MODES = (("0", "[source]", "-1"), ("1", "PCM", "0"), ("2", "SDM (DSD)", "1"))
_PCM_FILTERS = (("0", "none", "0"), ("1", "poly-sinc-gauss-long", "40"), ("2", "sinc-M", "25"))
_SDM_FILTERS = (("0", "poly-sinc-gauss-long", "38"), ("1", "sinc-M", "23"))
_PCM_SHAPERS = (("0", "none", "0"), ("1", "NS9", "5"))
_SDM_SHAPERS = (("0", "ASDM5", "0"), ("1", "ASDM7EC", "3"))
_JUNK_FILTERS = (("0", "none", "0"), ("1", "20k", "1"), ("2", "30k", "2"))

# `RatesItem` carries no `value`: it is `<RatesItem index rate/>` with the actual
# rate in Hz and index 0 = auto (protocol.md §6). Mode-dependent for real, and
# each mode offers BOTH base families; the 48k-base members sit last here so no
# existing index moves, not because the daemon orders them that way.
_PCM_RATES = (("0", "0"), ("1", "44100"), ("2", "352800"), ("3", "705600"), ("4", "384000"))
_SDM_RATES = (("0", "0"), ("1", "2822400"), ("2", "5644800"), ("3", "12288000"))


def restart_into(state: dict[str, str], mode: str, dither: str, modulator: str) -> None:
    """Move the fake's State to what a daemon reports after a restore's
    self-restart: it comes back up running the restored config file
    (docs/architecture.md §1 lane 2). The file speaks ``pcm``/``sdm`` and enum
    IDs; State speaks the mode index and list indices resolved against the
    chain the restart loaded (protocol.md §4 — the domains never mix), so the
    restored shaper is the loaded chain's dither or modulator looked up on that
    chain's own enumeration."""
    state["mode"] = {"pcm": "1", "sdm": "2"}.get(mode, "0")
    sdm = state["mode"] == "2"
    enum_id = modulator if sdm else dither
    for index, _name, value in _SDM_SHAPERS if sdm else _PCM_SHAPERS:
        if value == enum_id:
            state["shaper"] = index


def _items(tag: str, rows: tuple[tuple[str, str, str], ...]) -> str:
    return "".join(f'<{tag} index="{i}" name="{n}" value="{v}"/>' for i, n, v in rows)


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
    return (state.get("_active_mode") or "").upper().startswith(("SDM", "DSD"))


def _reported_mode(state: dict[str, str]) -> str:
    """What ``Status.active_mode`` says on the wire.

    It resolves to the mode's display name only when one is CONFIGURED. In
    ``[source]`` the daemon echoes ``"[source]"`` straight back rather than naming
    the family it settled on — measured 2026-07-29 while playing PCM
    (``scripts/probes/probe_rate_playing.py``). So ``_active_mode`` is the fake's knob for
    which family the SOURCE is, and this is what actually goes out.
    """
    return state.get("_active_mode", "") if state.get("mode") in ("1", "2") else "[source]"


def _active_rate(state: dict[str, str]) -> str:
    """The rate the fake is running at, or ``"0"`` when it is running nothing.

    Carried because it is the only thing on the Status frame that tells ``[source]``
    mode which chain is loaded, ``active_mode`` having declined to
    (``livemap._chain_from_status``). Nothing loaded is nothing running: no
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
        return f"<GetFilters>{_items('FiltersItem', _SDM_FILTERS if sdm else _PCM_FILTERS)}</GetFilters>"
    if name == "GetShapers":
        return f"<GetShapers>{_items('ShapersItem', _SDM_SHAPERS if sdm else _PCM_SHAPERS)}</GetShapers>"
    if name == "GetRates":
        return f"<GetRates>{_rate_items(_rates(state, sdm=sdm))}</GetRates>"
    if name == "GetJunkFilters":
        return f"<GetJunkFilters>{_items('JunkFiltersItem', _JUNK_FILTERS)}</GetJunkFilters>"
    return None


def _query(name: str, state: dict[str, str]) -> str | None:
    """Read-only commands answered from state; None for setters."""
    enumerated = _enumeration(name, state)
    if enumerated is not None:
        return enumerated
    if name == "GetInfo":
        return '<GetInfo name="Fake" engine="6.0.4" version="6"/>'
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
    overrides: dict[str, str] | None = None,
    log: CommandLog | None = None,
    state: dict[str, str] | None = None,
) -> None:
    # A caller that passes `state` shares ONE dict across every connection, the
    # way a real daemon does — which is what lets a test move the fake mid-session
    # (a new track changing `_active_mode`) and have the manager's open connection
    # see it. Without it each connection gets its own, and the move is invisible.
    state = state if state is not None else {**DEFAULTS, **(overrides or {})}
    while True:
        data = await reader.read(4096)
        if not data:
            break
        body = data.split(b"?>", 1)[-1].strip().decode()
        answer = handle(body, state, log)
        if isinstance(answer, Close):
            break  # dropped: the socket goes away with nothing on it
        if answer is None:
            continue  # stalled: keep the connection open and say nothing
        writer.write(f"{XML}{answer}\n".encode())
        await writer.drain()
    writer.close()
