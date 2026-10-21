"""The pinned output rate: the LIVE field ``rate``, in Hz, that ``SetRate`` writes.

``SetRate`` takes a ``RatesItem`` index of the running mode's list; index 0 is
auto, so ``"0"`` clears the pin. ``[source]`` mode outputs at the source's own
rate whatever the pin, the engine holds one pin, and ``SetMode`` drops it.
``SetRate`` writes the fixed slot, which overrides automatic base-rate
selection, so the pin is exactly the requested rate. After a mode switch clears
a pin on the engine, the engine runs automatic base-rate selection until the
user pins again. When a restart drops a confirmed pin, ``lanes/live/dropped``
reports it, and the user re-pins.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

from hqptuner.engine.view import EngineView

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

#: The LIVE field, and the register's setter key its edit goes out under.
# ``rate`` is a field of its own, outside ``routing.LIVE_ONLY`` and the ``SNAPSHOT_FIELDS`` a
# saved snapshot holds, so a restored snapshot leaves the rate to automatic base-rate selection.
RATE = "rate"
SETTING = "rate"


class PinRoute(NamedTuple):
    """A LIVE batch's ``rate``: its ``writer.apply_live`` edit, or the reason it is refused, keyed ``rate``."""

    edits: dict[str, dict[str, str]]
    reasons: dict[str, str]


def _refusal(view: EngineView, fields: dict[str, str], index: str | None) -> str | None:
    """Return why the batch cannot pin its rate, or None when it can.

    Alone in its batch, because the mode and the filter both swap the rate list
    the index is resolved against. Only with PCM or SDM configured, because
    ``[source]`` ignores ``SetRate``. Only a rate the running list carries.
    """
    if len(fields) > 1:
        return "a pinned rate cannot be batched with other live settings: the mode and the filter swap the rate list"
    if view.configured_chain() is None:
        return "no rate can be pinned unless the output mode is PCM or SDM"
    if index is None:
        return f"{fields[RATE]} is not in the engine's live rates list"
    return None


def route(mgr: LaneManager, fields: dict[str, str]) -> PinRoute:
    """Resolve the ``rate`` in a LIVE batch to its ``SetRate`` index, or refuse it."""
    # The frontend sends a pin only under the Allow pinned rates preference (store/live/pin.js).
    view = EngineView.of(mgr.readings)
    index = view.index_of(RATE, fields[RATE])
    why = _refusal(view, fields, index)
    if why is not None:
        return PinRoute({}, {RATE: why})
    # Every restore write sets the config file's fixed slot to auto (fields.query.forced),
    # so a restart returns the engine to automatic base-rate selection.
    return PinRoute({SETTING: {"value": str(index)}}, {})
