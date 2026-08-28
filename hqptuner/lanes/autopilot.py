"""What the high-frequency filter auto-pilot wants engaged, given the track's signature.

A pure decision with no I/O: the caller supplies the latched signature (``engine.metering.MeteringReader.verdict``),
the baseline the user was sitting on when auto-pilot was switched on, and the active main filter's name. The answer is
a junk-filter NAME for the caller to write.

The whole rule is ``junkadvisor.treats``, which is why there is no case analysis here. A baseline that already covers
the signature stays put — and that is also what makes a rate-relative baseline (2x/4x/8x) untouchable, since ``treats``
counts one as a deliberate choice and never second-guesses it. A main filter from one of the families a spur verdict
offers covers the signature too, so switching to a hires filter drops the junk filter and switching away brings it
back.
"""

from __future__ import annotations

from typing import Any

from hqptuner.engine import junkadvisor


def desired_junk_filter(verdict: dict[str, Any] | None, baseline: str, active_filter: str | None) -> str:
    """Return the junk-filter NAME auto-pilot wants engaged right now.

    The baseline when there is no verdict, or when the baseline (or the active main filter) already treats the one
    there is; otherwise the verdict's own filter.
    """
    if verdict is None or junkadvisor.treats(verdict, baseline, active_filter):
        return baseline
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


def junk_filter_name(items: list[dict[str, str]], index: str | None) -> str | None:
    """Return the running enumeration's junk-filter name at this list index, or None when it carries no such index.

    The join the other way, for the places that hold an index and need the name the decision above speaks in — a
    stored preset's field, say, whose index means whatever the enumeration says it means today.
    """
    if index is None:
        return None
    for item in items:
        if str(item.get("index")) == str(index):
            name = item.get("name")
            return None if name is None else str(name)
    return None
