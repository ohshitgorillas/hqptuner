"""Which chain the engine has loaded, and which config slot holds the rate limit for each."""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.engine.chainfamily import PCM, SDM, chain_name, status_chain

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

EnumItems = list[dict[str, str]]

# The two rate slots. `SetRate` writes the FIXED slot (`samplerate`/`bitrate`): an
# exact rate there overrides automatic base-rate selection, so 44.1k material goes out
# at a 48k base and the engine can refuse the filter. The config file holds that slot
# at auto ("0") always, and LIVE sends a pin only when the user asks for one, exactly
# as asked, until the next mode switch drops it (`lanes/live/rate`). The LIMIT slot
# holds the tier as its 48k member, and `auto_family` picks the member matching the
# source per track (http.restore.FORCED_CONFIG forces the pair).
RATE_LIMIT_FIELD = {PCM: "defaults_samplerate", SDM: "defaults_bitrate"}


def configured_chain(mgr: LaneManager) -> str | None:
    """Return the CONFIGURED mode's chain — decisive when it is pcm or sdm, None in auto or when State cannot say."""
    index = (mgr.readings.state or {}).get("mode")
    if index is None:
        return None
    for item in (mgr.readings.enums or {}).get("modes", []):
        if str(item.get("index")) == str(index):
            return chain_name(item.get("name") or "")
    return None


def active_chain(mgr: LaneManager) -> str | None:
    """Which filter/shaper chain the engine currently has loaded.

    The configured mode answers it outright when set to pcm or sdm. In ``auto``
    the engine switches per source (readme §1.7, "Automatic switching"), so the
    configured value cannot say and Status answers instead (``status_chain``).
    None when neither can answer, which keeps the fields on the restore lane
    rather than guessing a chain.

    A rate choice is a different question and does not come here: it goes to the
    config LIMIT slot (``RATE_LIMIT_FIELD``), not to the loaded chain.
    """
    chain = configured_chain(mgr)
    return chain if chain is not None else status_chain(mgr.readings.status or {})
