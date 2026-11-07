"""Live routing for config-form fields the Control API can set directly.

The persistent lane (``http.restore``) writes the config XML and pushes it with
``POST /restore``, on which the daemon self-restarts (~5.6 s). Seven of its
fields have exact Control API equivalents that apply instantly with no restart,
so ``manager.apply`` peels those off and hands them to ``writer.apply_live``
instead. Only what is left goes to the restore lane — and when nothing is left,
the daemon is never restarted at all.

**Domain translation.** The config form (and ``hqplayerd.xml``) carry the numeric
enumeration ID; ``Set*`` commands take the LIST INDEX. The live enumeration items
carry both ``value`` (enum ID) and ``index``, so the join is a lookup, never a
computation.

**Chain gating.** ``GetFilters``/``GetShapers`` enumerate only the ACTIVE mode's
chain, and the two chains number their enum IDs differently (readme: "Million tap
sinc-filter" is 25 under ``filter``, 23 under ``oversampling``). So a PCM field is
routable only while the engine is in PCM, an SDM field only in SDM. In
``[source]`` mode the engine follows the source and neither chain is knowably the
live one, so filters and shapers stay on the restore lane.

Every fallback in here is toward the restore lane, which is always correct and
only slower. A field routes live only when the whole translation succeeds.
"""

from __future__ import annotations

from enum import Enum, auto
from typing import TYPE_CHECKING, Protocol

from hqptuner.engine.view import Cause, EngineView, Refusal, is_mode, says
from hqptuner.errors import HQPTunerError
from hqptuner.fields import query
from hqptuner.lanes.live import rate

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager, LaneReadings


class RoutingSource(Protocol):
    """The readings needed to choose a staged batch's destination."""

    @property
    def readings(self) -> LaneReadings:
        """Return the current daemon readings."""
        ...


def _target(field: str) -> tuple[str, str] | None:
    """Return the setting key and argument the live lane writes ``field`` under, none for a field it does not take."""
    row = query.field(field)
    if row is None or row.live is None or not row.live_control:
        return None
    command = row.live.setter
    return next(((setter.key, row.live.arg) for setter in query.setters() if setter.command == command), None)


def _setting_of(field: str) -> str | None:
    """Return the setting key the live lane writes ``field`` under, none for a field it does not take."""
    target = _target(field)
    return None if target is None else target[0]


def is_staged_route(field: str) -> bool:
    """Return whether a staged form edit of ``field`` may write live."""
    row = query.field(field)
    return row is not None and row.staged_route


def mode_apart(http_fields: dict[str, str]) -> str | None:
    """Return the staged mode sent before the rest of an entirely live-routable batch.

    The mode write refreshes the enumerations used by the remainder. A restore-class field keeps the mode in the
    restore batch, whose restart would otherwise overwrite a preceding live mode write.
    """
    if any(not is_staged_route(field) for field in http_fields):
        return None
    return http_fields.get("mode")


def _complete_filter_pair(edits: dict[str, dict[str, str]], state: dict[str, str]) -> set[str]:
    """Fill the omitted half of each ``SetFilter`` edit from the current State, and return the settings it cannot fill.

    An edit carries both args, since ``SetFilter value="N"`` alone sets the 1x and Nx filters both. An engine that
    reports neither ``filter1x`` nor ``filterNx`` leaves its edit to the restore lane.
    """
    unfillable = set()
    for setter in query.setters():
        pair = edits.get(setter.key)
        if pair is None or not setter.value_fills:
            continue
        for arg, attr in query.readback(setter).items():
            if arg in pair:
                continue
            current = state.get(attr)
            if current is None:
                unfillable.add(setter.key)
                break
            pair[arg] = str(current)
    return unfillable


def _mode_blocks_batch(fields: dict[str, str]) -> str | None:
    """Return the mode field of a batch that carries other fields beside it, else None.

    Such a batch goes to the restore lane whole: ``SetMode`` swaps the enumeration lists the other indices are
    relative to.
    """
    return next((field for field in fields if is_mode(field)), None) if len(fields) > 1 else None


def _route_all(view: EngineView, routable: dict[str, str]) -> tuple[dict[str, dict[str, str]], set[str]]:
    """Resolve every routable field into setter args, dropping the ones that cannot translate.

    Returns the live edits and the fields they consumed.
    """
    live: dict[str, dict[str, str]] = {}
    routed: set[str] = set()
    for field, value in routable.items():
        index = view.resolve(field, value)
        target = _target(field)
        if isinstance(index, Refusal) or target is None:
            continue
        live.setdefault(target[0], {})[target[1]] = index
        routed.add(field)
    return live, routed


def _merge(base: dict[str, dict[str, str]], extra: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """Fold routed setter args into the already-staged live edits, without mutating either.

    ``base`` is the pending store's own dict.
    """
    merged = {setting: dict(params) for setting, params in base.items()}
    for setting, params in extra.items():
        merged[setting] = {**merged.get(setting, {}), **params}
    return merged


def split_live(
    mgr: RoutingSource, http_fields: dict[str, str], live_edits: dict[str, dict[str, str]]
) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    """Fold the whole batch into ``live_edits`` when every field routes live, else hand the whole batch back.

    All-or-nothing: an empty remainder means the whole batch applies live and the
    daemon is never restarted. Any field that needs the restore lane sends the
    ENTIRE batch there instead — the restore restarts the daemon onto its config
    file, and a value applied live never reaches that file, so a split batch would
    boot the daemon straight back onto the values it just replaced.
    """
    routable = {k: v for k, v in http_fields.items() if is_staged_route(k)}
    if not routable or _mode_blocks_batch(routable) is not None:
        return live_edits, dict(http_fields)
    live, routed = _route_all(EngineView.of(mgr.readings), routable)
    unfillable = _complete_filter_pair(live, mgr.readings.state or {})
    if any(field not in routed or _setting_of(field) in unfillable for field in http_fields):
        return live_edits, dict(http_fields)
    return _merge(live_edits, live), {}


def split_remainder(
    mgr: RoutingSource, http_fields: dict[str, str], live_edits: dict[str, dict[str, str]]
) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    """Route companions after a mode write, carrying the mode into any required restore."""
    rest = {name: value for name, value in http_fields.items() if name != "mode"}
    edits, remainder = split_live(mgr, rest, live_edits)
    if remainder:
        remainder = {**remainder, "mode": http_fields["mode"]}
    return edits, remainder


class Destination(Enum):
    """The store a staged field will reach, or a decision awaiting post-switch readings."""

    ENGINE = auto()
    FILE = auto()
    DEFERRED = auto()


def staged_destinations(
    mgr: RoutingSource, http_fields: dict[str, str], live_edits: dict[str, dict[str, str]]
) -> dict[str, Destination]:
    """Choose the staged HTTP fields' destinations using Apply's mode-first routing."""
    mode = mode_apart(http_fields)
    if mode is None:
        _, restore = split_live(mgr, http_fields, live_edits)
    elif EngineView.of(mgr.readings).mode() == mode:
        _, restore = split_remainder(mgr, http_fields, live_edits)
    else:
        _, restore = split_live(mgr, {"mode": mode}, {})
        if not restore:
            return {name: Destination.ENGINE if name == "mode" else Destination.DEFERRED for name in http_fields}
        restore = http_fields
    return {name: Destination.FILE if name in restore else Destination.ENGINE for name in http_fields}


# --- LIVE lane: immediate, unstaged writes -----------------------------------


class LiveRouteError(HQPTunerError):
    """A LIVE batch that could not be resolved, carrying one reason per field.

    Raised rather than dropping the unroutable fields the way ``split_live``
    does. Its fallback is the restore lane, which is always correct and only
    slower; LIVE has no fallback, so a silently skipped field would leave its
    control displaying a value the engine never took.
    """

    code = "route_refused"

    def __init__(self, reasons: dict[str, str]) -> None:
        """Build the message by joining the per-field reasons in field order, and keep the mapping on ``reasons``."""
        super().__init__("; ".join(f"{field}: {why}" for field, why in sorted(reasons.items())))
        self.reasons = reasons


def _route_live(view: EngineView, fields: dict[str, str]) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    """Every field as setter args, alongside the reason for each one that does not resolve.

    A field of the chain not loaded does not resolve: ``GetFilters``/``GetShapers`` answer
    for the loaded chain only, so it has no Engine value and no setter reaches it.
    """
    edits: dict[str, dict[str, str]] = {}
    reasons: dict[str, str] = {}
    for field, value in fields.items():
        target = _target(field)
        refused = rate.refusal(view, field, fields)
        if target is None:
            reasons[field] = says(Refusal(field, value, Cause.NOT_LIVE))
        elif refused is not None:
            reasons[field] = refused
        elif isinstance(resolved := view.resolve(field, value), Refusal):
            reasons[field] = says(resolved)
        else:
            edits.setdefault(target[0], {})[target[1]] = resolved
    return edits, reasons


def resolve_live(mgr: LaneManager, fields: dict[str, str]) -> dict[str, dict[str, str]]:
    """Return a LIVE batch as ``writer.apply_live`` edits, or ``LiveRouteError`` naming each unresolved field.

    The whole batch resolves before a single setter runs. A mode in the batch refuses every other field, the rate
    included (manual §4.6). A field of a chain the engine has not loaded is refused.
    """
    mode = _mode_blocks_batch(fields)
    if mode is not None:
        raise LiveRouteError(
            {
                mode: "an output-mode change cannot be batched with other live settings: SetMode swaps the "
                "enumerations the other values were resolved against"
            }
        )
    edits, reasons = _route_live(EngineView.of(mgr.readings), fields)
    unfillable = _complete_filter_pair(edits, mgr.readings.state or {})
    if unfillable:
        why = "State reports no current filter, so the other half of the SetFilter pair cannot be filled in"
        reasons.update(dict.fromkeys((f for f in fields if f not in reasons and _setting_of(f) in unfillable), why))
    if reasons:
        raise LiveRouteError(reasons)
    return edits
