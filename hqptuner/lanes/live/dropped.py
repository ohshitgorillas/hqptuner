"""The live settings a daemon restart dropped.

hqplayerd keeps a setting changed over its control API in memory only, so a
restart brings it back up on its config file (protocol §1). HQPTuner keeps a
record of every live setting the engine confirmed by readback; held against the
State and enumerations a new connection reads, the record says which of them the
engine no longer holds.

Everything here is a function of its arguments: the lane records, the loader
compares, and neither decides anything this module does not return.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, NamedTuple

from hqptuner.errors import HQPTunerError
from hqptuner.lanes.live import rate, routing
from hqptuner.lanes.live.snapshot import read_field, reported_as
from hqptuner.lanes.writer import LiveWriteOk

if TYPE_CHECKING:
    from collections.abc import Mapping

    from hqptuner.lanes.live.chain import EnumItems
    from hqptuner.lanes.writer import LiveWriteResult


@dataclass(frozen=True)
class WrittenSetting:
    """One live setting the engine confirmed: the config-form field, the form value written, the engine's name for it.

    ``name`` is None where the engine names no value: the adaptive volume flag and a pinned rate.
    """

    field: str
    value: str
    name: str | None


class EngineView(NamedTuple):
    """What the engine reports: its State, its enumerations, and the filter/shaper chain it has loaded."""

    state: dict[str, str]
    enums: dict[str, EnumItems]
    chain: str | None


class Reconciled(NamedTuple):
    """The record held against a new connection: the entries the engine lost, and the record without them."""

    dropped: tuple[WrittenSetting, ...]
    kept: dict[str, WrittenSetting]


class UnwiredFieldError(HQPTunerError):
    """A live field with no setter argument or State attribute to record it by."""

    code = "unwired_live_field"

    def __init__(self, field: str) -> None:
        """Name the field ``routing.live_fields`` carries and this module cannot map."""
        super().__init__(f"live field {field!r} has no wire mapping")


class _Wire(NamedTuple):
    """How a config-form field travels: the setter and argument it goes out in, the State attribute it comes back in."""

    setting: str
    arg: str
    state: str


def _wire(field: str) -> _Wire:
    """Return how this live field travels, or raise ``UnwiredFieldError`` when no table maps it."""
    spec = routing.ROUTABLE.get(field) or routing.LIVE_ONLY.get(field)
    if spec is not None:
        return _Wire(spec.setting, spec.arg, spec.state)
    if field in routing.DIRECT:
        return _Wire(field, "value", reported_as(field))
    if field == rate.RATE:
        return _Wire(rate.SETTING, "value", reported_as(rate.SETTING))
    raise UnwiredFieldError(field)


_LIVE = {field: _wire(field) for field in routing.live_fields()}
_MODE_SETTING = _LIVE["mode"].setting


def _verified(report: list[LiveWriteResult]) -> frozenset[str]:
    """Return the settings whose readback verified."""
    return frozenset(entry.setting for entry in report if isinstance(entry, LiveWriteOk))


def _sent(
    field: str, wire: _Wire, edits: dict[str, dict[str, str]], verified: frozenset[str], view: EngineView
) -> WrittenSetting | None:
    """Return this field as a written setting when a setter that verified changed it, else None.

    Changed means its argument went out at a value other than the one ``view`` held: a value carried
    along unchanged, such as the half of a ``SetFilter`` pair filled in from State, was not written.
    A filter or shaper argument is the field of the chain ``view`` has loaded.
    """
    index = edits.get(wire.setting, {}).get(wire.arg)
    if index is None or wire.setting not in verified:
        return None
    sent = read_field(field, {wire.state: index}, view.enums, view.chain)
    held = read_field(field, view.state, view.enums, view.chain)
    if sent is None or (held is not None and held.value == sent.value):
        return None
    return WrittenSetting(field, sent.value, sent.name)


def recorded(
    record: Mapping[str, WrittenSetting],
    edits: dict[str, dict[str, str]],
    report: list[LiveWriteResult],
    view: EngineView,
) -> dict[str, WrittenSetting]:
    """Return the record with a live batch's changes in it.

    ``edits`` is the batch as it went on the wire, ``report`` each setter's readback verdict, and
    ``view`` the engine the batch was resolved against. A later write of a field replaces the
    earlier one. A verified ``SetMode`` takes the pinned rate out, a same-mode one included: the
    engine drops the pin on every one (``lanes/live/rate``).
    """
    verified = _verified(report)
    kept = {f: entry for f, entry in record.items() if not (f == rate.RATE and _MODE_SETTING in verified)}
    found = (_sent(field, wire, edits, verified, view) for field, wire in _LIVE.items())
    return {**kept, **{entry.field: entry for entry in found if entry is not None}}


def _lost(entry: WrittenSetting, view: EngineView) -> bool:
    """Whether the engine now reports this entry's field at a different value.

    A field the engine cannot answer for, such as one of the chain not loaded, is not lost.
    """
    now = read_field(entry.field, view.state, view.enums, view.chain)
    return now is not None and now.value != entry.value


def reconcile(record: Mapping[str, WrittenSetting], view: EngineView) -> Reconciled:
    """Hold the record against a new connection's engine: what it lost, in record order, and what stays recorded."""
    dropped = tuple(entry for entry in record.values() if _lost(entry, view))
    return Reconciled(dropped, {f: entry for f, entry in record.items() if entry not in dropped})
