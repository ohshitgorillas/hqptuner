"""Volume trace — what the volume was, and who asked for it.

Volume rides two unrelated mechanisms. The startup volume is the config-file
field ``defaults_volume``, which reaches the daemon only over the restore lane
and takes effect at boot. The playing volume is a live 4321 value, set by
``Volume`` and reported back under ``State``'s ``volume`` attribute. Neither was
recorded anywhere, and neither of the two paths that can set the playing volume
was distinguishable in the log from anything else: the volume knob left no
record at all, and the live lane's own setter left a generic ``live.write``
identical in shape to a filter write.

This module is the trace. Every checkpoint records a value the engine or the
store actually produced, never a conclusion drawn from one, and every record
carries ``last_write`` — the level HQPTuner most recently asked for — so a
volume that moved to something nobody asked for reads as one HQPTuner did not
move, rather than being inferred by comparing timestamps across the log.

It writes through ``AuditLog``, which is off unless ``HQPTUNER_DEBUG_LOG`` names
a path, and emits the same line at INFO regardless, so an install with the
variable unset still gets the timeline in the ordinary log.
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping

    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

#: The config-form fields this trace watches, both volume mechanisms in one set:
#: the startup volume (``defaults_volume``), the range and mode the engine holds
#: (``volume_max``/``volume_min``/``volume_fixed``/``adaptive_volume``) and the
#: fixed-volume pair that suppresses the live control entirely.
VOLUME_FIELDS = frozenset(
    {
        "defaults_volume",
        "volume_max",
        "volume_min",
        "volume_fixed",
        "fixed_volume",
        "fixed_volume_enabled",
        "adaptive_volume",
    }
)


def subset(mapping: Mapping[str, Any] | None) -> dict[str, str | None]:
    """Every ``VOLUME_FIELDS`` key, with None for one this mapping does not carry.

    Total over ``None`` on purpose, and the None case is routine rather than defensive: ``config_form`` and
    ``file_config`` are both None until their first successful fetch, which is every tick of a startup where the
    8088 lane is unreachable or the credentials are refused. Padding rather than omitting keeps "the form stopped
    reporting this field", "the form has never been read" and "the form reported a value" three different readings,
    and it means no caller can hand an emitter a None and raise inside a poll tick.
    """
    carried = mapping or {}
    return {field: _text(carried.get(field)) for field in sorted(VOLUME_FIELDS)}


def _text(value: Any) -> str | None:
    """One field's value as the log carries it — None stays None, everything else is its string."""
    return None if value is None else str(value)


def form_subset(form: Mapping[str, Any] | None) -> dict[str, str | None]:
    """Return ``subset`` of a parsed 8088 form, which is a field LIST rather than a mapping.

    ``config_form`` is ``{"fields": [{"name": …, "value": …}, …]}`` as the daemon's page parses (``conf/httpconf``),
    so reading a field name off it as a key finds nothing at all — every value would read null and the change test
    behind it would never fire. Same flattening ``engine/devicecaps`` does for the selected device.
    """
    fields = (form or {}).get("fields", [])
    return subset({field.get("name"): field.get("value") for field in fields})


def live_volume(mgr: ConnectionManager) -> dict[str, str | None]:
    """Return the playing volume the engine is currently reporting, as a one-field mapping.

    None where State carries no ``volume`` attribute at all, which is the fixed-volume and no-volume paths rather
    than an error, and where a restart has invalidated the readings before the next poll refills them.
    """
    return {"volume": _text((mgr.readings.state or {}).get("volume"))}


def observe(
    mgr: ConnectionManager,
    source: str,
    fields: dict[str, str | None],
    *,
    name: str | None = None,
) -> None:
    """Record one volume-bearing reading, whatever it says.

    Used by the checkpoints that fire once per user action — the three on a preset load, the two on a persistent
    apply, and the one that reads after a whole apply has finished. Deliberately not change-tested: a load that
    repeats the previous load's values exactly is the recurrence worth having in the log, and a change test would
    drop exactly that record.
    """
    _record(mgr, source, fields, name)


def observe_change(
    mgr: ConnectionManager,
    source: str,
    fields: dict[str, str | None],
    previous: dict[str, str | None],
) -> None:
    """Record one volume-bearing reading, only where it differs from ``previous``.

    Used by the two per-tick checkpoints, which would otherwise write a record every two seconds for as long as the
    app runs. ``previous`` is the value the manager's readings already hold, read before the tick overwrites them,
    so this module keeps no memory of its own for the comparison.
    """
    if fields != previous:
        _record(mgr, source, fields, None)


def write(
    mgr: ConnectionManager,
    source: str,
    want: str,
    readback: str | None,
    *,
    ok: bool,
) -> None:
    """Record one volume write, and remember the level it asked for.

    Both paths that can set the playing volume come through here, ``source`` naming which. The remembered level is
    what every later observation carries as ``last_write``: without it a reader facing a volume that moved has no
    way to tell whether HQPTuner is what moved it.
    """
    mgr.readings.last_volume_write = want
    log.info("volume write %s: want %s, readback %s, ok %s", source, want, readback, ok)
    with contextlib.suppress(OSError):
        mgr.audit.volume_write(source, want, readback, ok=ok)


def _record(mgr: ConnectionManager, source: str, fields: dict[str, str | None], name: str | None) -> None:
    """Emit one observation to both halves of the trace.

    ``OSError`` is suppressed around the audit call alone. Two of the callers sit inside the poll tick, where an
    unwritable ``HQPTUNER_DEBUG_LOG`` path would otherwise raise before the readings are replaced and stall every
    reading in the app for as long as the path stayed unwritable: a diagnostic that can take the poll loop down is
    worse than no diagnostic. The prose line lands either way.
    """
    last_write = mgr.readings.last_volume_write
    log.info("volume observe %s%s: %s, last_write %s", source, f" ({name})" if name else "", fields, last_write)
    with contextlib.suppress(OSError):
        mgr.audit.volume_observe(source, name, fields, last_write)
