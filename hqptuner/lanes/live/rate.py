"""The pinned output rate: the LIVE field ``rate``, in Hz, that ``SetRate`` writes.

``SetRate`` takes a ``RatesItem`` index of the running mode's list, index 0 being
auto, so ``"0"`` clears the pin. ``[source]`` mode ignores it, the engine holds one
pin, and ``SetMode`` drops it (protocol.md §SetRate). It writes the FIXED slot,
which overrides automatic base-rate selection, so the pin is exactly the rate the
user asked for, sent only while the Allow pinned rates preference is on
(``store/live/pin.js``). A mode switch clears it on the engine and nothing puts it
back. The config file's fixed slot stays forced to auto
(``http.restore.FORCED_CONFIG``), so a pin never survives a restart. A confirmed pin
is remembered for one purpose only, reporting it once a restart has dropped it
(``lanes/live/dropped``); it is never re-asserted.

Kept out of ``routing.LIVE_ONLY``, which ``snapshot.live_state`` reads, so a saved
snapshot never holds a pin.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

from hqptuner.lanes.live.chain import EnumItems, configured_chain

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

#: The LIVE field, and the ``writer.SETTINGS`` key its edit goes out under.
RATE = "rate"
SETTING = "rate"


def _index_for(items: EnumItems, hz: str) -> str | None:
    """Return the ``RatesItem`` index carrying this rate in Hz, or None when the list lacks it."""
    for item in items:
        if str(item.get("rate")) == str(hz):
            index = item.get("index")
            return None if index is None else str(index)
    return None


def _rates(mgr: LaneManager) -> EnumItems:
    return (mgr.readings.enums or {}).get("rates") or []


class PinRoute(NamedTuple):
    """A LIVE batch's ``rate``: its ``writer.apply_live`` edit, or the reason it is refused, keyed ``rate``."""

    edits: dict[str, dict[str, str]]
    reasons: dict[str, str]


def _refusal(mgr: LaneManager, fields: dict[str, str], index: str | None) -> str | None:
    """Return why the batch cannot pin its rate, or None when it can.

    Alone in its batch, because the mode and the filter both swap the rate list
    the index is resolved against. Only with PCM or SDM configured, because
    ``[source]`` ignores ``SetRate``. Only a rate the running list carries.
    """
    if len(fields) > 1:
        return "a pinned rate cannot be batched with other live settings: the mode and the filter swap the rate list"
    if configured_chain(mgr) is None:
        return "no rate can be pinned unless the output mode is PCM or SDM"
    if index is None:
        return f"{fields[RATE]} is not in the engine's live rates list"
    return None


def route(mgr: LaneManager, fields: dict[str, str]) -> PinRoute:
    """Resolve the ``rate`` in a LIVE batch to its ``SetRate`` index, or refuse it."""
    index = _index_for(_rates(mgr), fields[RATE])
    why = _refusal(mgr, fields, index)
    if why is not None:
        return PinRoute({}, {RATE: why})
    return PinRoute({SETTING: {"value": str(index)}}, {})
