"""What the high-frequency filter auto-pilot wants engaged, given the track's signature.

A pure decision with no I/O: the caller supplies the latched signature (``engine.metering.MeteringReader.verdict``)
and the active main filter's name. The answer is a junk-filter NAME for the caller to write.

Auto-pilot's resting state is nothing engaged. The junk filter is a corrective, not a preference: with auto-pilot on,
it is engaged for the signature that calls for it and released the moment that signature clears, so a track carrying
nothing to treat plays through no filter at all. A user who wants to hold a filter of their own switches auto-pilot
off, which setting the filter by hand already does for them (``api/routes/apply.py``).

The one thing that stays auto-pilot's hand is an active main filter from the families a spur verdict offers: it
removes the spur by resampling, so switching to a hires filter drops the junk filter and switching away brings it
back. That is still ``junkadvisor.treats`` and there is no case analysis here.
"""

from __future__ import annotations

from typing import Any

from hqptuner.engine import junkadvisor


def desired_junk_filter(verdict: dict[str, Any] | None, active_filter: str | None) -> str:
    """Return the junk-filter NAME auto-pilot wants engaged right now.

    Nothing engaged when there is no verdict, or when the active main filter already covers the one there is;
    otherwise the verdict's own filter. The second question is ``junkadvisor.treats`` asked with nothing engaged,
    which is exactly what auto-pilot wants to know: would this signature still be treated if the junk filter were let
    go? Nothing engaged never treats anything by itself, so what is left of the answer is the main filter alone.
    """
    if verdict is None or junkadvisor.treats(verdict, junkadvisor.NO_FILTER, active_filter):
        return junkadvisor.NO_FILTER
    return str(verdict["filter"])


def junk_filter_index(items: list[dict[str, str]], name: str) -> str | None:
    """Return the running enumeration's list index for this junk-filter name, or None when it carries no such name.

    The running engine is the sole authority for the junk-filter enumeration (architecture §2), so the name the
    decision above settled on is joined against what the engine actually offers rather than against anything static.
    """
    for item in items:
        if item.get("name") == name:
            index = item.get("index")
            return None if index is None else str(index)
    return None
