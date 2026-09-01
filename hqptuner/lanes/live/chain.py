"""Which chain the engine has loaded, and which output family a rate belongs to."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

PCM = "pcm"
SDM = "sdm"

EnumItems = list[dict[str, str]]

# No PCM rate the engine offers reaches DSD64, so the lowest SDM rate separates
# the two families outright — no rate in Hz is ambiguous between them.
_SDM_FLOOR = 2822400

# The two rate slots. `SetRate` writes the FIXED slot (`samplerate`/`bitrate`),
# which HQPTuner holds at auto ("0") always: an exact rate there overrides automatic
# base-rate selection, so 44.1k material goes out at a 48k base and the engine refuses
# the filter. The LIMIT slot holds the tier as its 48k member, and `auto_family` picks
# the member matching the source per track (http.restore.FORCED_CONFIG forces the pair).
RATE_LIMIT_FIELD = {PCM: "defaults_samplerate", SDM: "defaults_bitrate"}


def rate_family(hz: str) -> str:
    """Which output family a rate in Hz belongs to."""
    return SDM if int(hz) >= _SDM_FLOOR else PCM


def _chain_name(name: str) -> str | None:
    """Return the chain a mode name denotes, or None for ``[source]``/anything unknown."""
    upper = (name or "").upper()
    if upper.startswith("PCM"):
        return PCM
    return SDM if upper.startswith(("SDM", "DSD")) else None


def _chain_from_state(mgr: ConnectionManager) -> str | None:
    """Return the CONFIGURED mode's chain — decisive when it is pcm or sdm, None in auto."""
    index = (mgr.readings.state or {}).get("mode")
    if index is None:
        return None
    for item in (mgr.readings.enums or {}).get("modes", []):
        if str(item.get("index")) == str(index):
            return _chain_name(item.get("name") or "")
    return None


def _chain_from_status(mgr: ConnectionManager) -> str | None:
    """Return the chain the engine is running RIGHT NOW, from what Status reports.

    ``Status.active_mode`` looks like the whole answer and is not: it echoes the
    CONFIGURED mode, so in ``[source]`` — the one case this is reached in on a
    live daemon — it reads ``"[source]"`` and nothing else (probe-verified on
    6.0.4, ``scripts/probes/probe_rate_playing.py``). ``Status.active_rate``
    does answer, and unambiguously: it is the rate coming out, and its family is
    the chain that produced it (``rate_family``, no rate lands between the two).
    """
    status = mgr.readings.status or {}
    named = _chain_name(status.get("active_mode") or "")
    if named is not None:
        return named
    hz = status.get("active_rate") or ""
    return rate_family(hz) if hz.isdigit() and hz != "0" else None


def active_chain(mgr: ConnectionManager) -> str | None:
    """Which filter/shaper chain the engine currently has loaded.

    The configured mode answers it outright when set to pcm or sdm. In ``auto``
    the engine switches per source (readme §1.7, "Automatic switching"), so the
    configured value cannot say and Status answers instead (``_chain_from_status``).
    None when neither can answer, which keeps the fields on the restore lane
    rather than guessing a chain.

    A rate choice is a different question and does not come here: it goes to the
    config LIMIT slot (``RATE_LIMIT_FIELD``), not to the loaded chain.
    """
    chain = _chain_from_state(mgr)
    return chain if chain is not None else _chain_from_status(mgr)
