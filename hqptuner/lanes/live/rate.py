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

from typing import TYPE_CHECKING

from hqptuner.fields import query
from hqptuner.fields.model import Enumeration

if TYPE_CHECKING:
    from hqptuner.engine.view import EngineView


def pins(field: str) -> bool:
    """Whether ``field`` is the output rate, the one live field the rates list answers."""
    row = query.field(field)
    return row is not None and row.live is not None and row.live.enumeration is Enumeration.RATES


def refusal(view: EngineView, field: str, fields: dict[str, str]) -> str | None:
    """Return why ``field`` cannot pin its rate in this batch, or None when it can or is not the rate.

    Alone in its batch, because the mode and the filter both swap the rate list
    the index is resolved against. Only with PCM or SDM configured, because
    ``[source]`` ignores ``SetRate``. Every restore write sets the config file's fixed slot to
    auto (``fields.query.forced``), so a restart returns the engine to automatic base-rate selection.
    The frontend sends a pin only under the Allow pinned rates preference.
    """
    if not pins(field):
        return None
    if len(fields) > 1:
        return "a pinned rate cannot be batched with other live settings: the mode and the filter swap the rate list"
    if view.configured_chain() is None:
        return "no rate can be pinned unless the output mode is PCM or SDM"
    return None
