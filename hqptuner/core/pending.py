"""The staged-changes buffer: what is staged, merged and dropped, with no web layer in sight."""

from collections.abc import Callable
from dataclasses import dataclass

from hqptuner.conf.matrixconf import validate_rows
from hqptuner.core.fieldvalues import current_engine_view, file_value
from hqptuner.core.readings import Readings
from hqptuner.engine.view import EngineView
from hqptuner.fields import query
from hqptuner.fields.model import Attr, Codec, Field
from hqptuner.lanes.live.routing import Destination, staged_destinations


@dataclass(frozen=True)
class PendingSnapshot:
    """The staged buffer as every staging route answers with it: live-lane buckets and restore-lane fields."""

    live: dict[str, dict[str, str]]
    http: dict[str, str]


def pending_fields(snapshot: PendingSnapshot, view: EngineView) -> dict[str, str]:
    """Project staged payloads into each field's displayed domain."""
    values = {}
    for name, value in snapshot.http.items():
        row = query.field(name)
        if row is not None and row.live is not None and row.live.enumeration is not None and _on_chain(row, view):
            index = view.index_of(name, value)
            if index is not None:
                values[name] = index
        else:
            values[name] = value
    for key, arg, row in _live_fields():
        staged = snapshot.live.get(key, {}).get(arg)
        if staged is not None and _on_chain(row, view):
            values[row.name] = staged
    return values


def _live_fields() -> list[tuple[str, str, Field]]:
    """Return registered field ownership for every setter argument."""
    return [
        (setter.key, row.live.arg, row)
        for setter in query.setters()
        for row in query.written_by(setter)
        if row.live is not None
    ]


def _on_chain(row: Field, view: EngineView) -> bool:
    """Whether this field belongs to the loaded Engine chain."""
    return row.live is not None and (row.live.chain is None or row.live.chain == view.loaded_chain())


@dataclass(frozen=True)
class _RoutingReadings:
    readings: Readings


def _http_baseline(name: str, readings: Readings, view: EngineView, destination: Destination) -> str | None:
    """Return the current value in the HTTP batch's destination domain."""
    if destination is Destination.DEFERRED:
        return None
    if destination is Destination.FILE:
        row = query.field(name)
        return None if row is None else file_value(readings, row)
    current = view.read(name)
    return None if current is None else current.value


def _dirty_live(edits: dict[str, dict[str, str]], view: EngineView) -> dict[str, dict[str, str]]:
    """Keep only setter arguments that differ from the current Engine reading."""
    live = {key: dict(args) for key, args in edits.items()}
    for key, arg, row in _live_fields():
        current = view.raw_read(row.name)
        if current is not None and live.get(key, {}).get(arg) == current.value:
            live[key].pop(arg)
    return {key: args for key, args in live.items() if args}


def _pipeline_fields() -> tuple[str, str]:
    location = Attr("engine", "pipelines")
    count = query.at(location)
    if count is None:
        raise KeyError(location)
    return query.kept_at(Codec.PIPELINES), count


def clean_pending(snapshot: PendingSnapshot, readings: Readings) -> PendingSnapshot:
    """Remove edits already held by their batch's destination without changing payload domains."""
    view = current_engine_view(readings)
    destinations = staged_destinations(_RoutingReadings(readings), snapshot.http, snapshot.live)
    http = {
        name: value
        for name, value in snapshot.http.items()
        if value != _http_baseline(name, readings, view, destinations[name])
    }
    rows, count = _pipeline_fields()
    if rows in snapshot.http and count in snapshot.http and (rows in http or count in http):
        http.update({rows: snapshot.http[rows], count: snapshot.http[count]})
    return PendingSnapshot(live=_dirty_live(snapshot.live, view), http=http)


class PendingStore:
    """Server-side staged-changes buffer.

    Survives browser reloads because it lives on the backend, not the client. ``on_change`` runs at the end of every
    stage, drop and clear, so whoever relays the buffer hears of an edit without waiting to poll for it.
    """

    def __init__(self, on_change: Callable[[], None] = lambda: None) -> None:
        """Start with both buckets empty — nothing staged."""
        self.live: dict[str, dict[str, str]] = {}
        self.http: dict[str, str] = {}
        self._on_change = on_change

    def stage(self, live: dict[str, dict[str, str]], http: dict[str, str], view: EngineView | None = None) -> None:
        """Merge entries into the buffer, a later value for the same key replacing the earlier one.

        A new live bucket replaces the old bucket. An HTTP field removes only its matching live argument.
        """
        rows, count = _pipeline_fields()
        if rows in http or (count in http and rows in self.http):
            payload = http[rows] if rows in http else self.http[rows]
            self.stage_pipelines(payload, live=live, http=http, view=view)
        else:
            self._merge(live, http, view)

    def stage_pipelines(
        self,
        value: str,
        *,
        live: dict[str, dict[str, str]] | None = None,
        http: dict[str, str] | None = None,
        view: EngineView | None = None,
    ) -> None:
        """Validate rows and merge them with their derived count as one complete edit."""
        rows, count = _pipeline_fields()
        edits = dict(http or {})
        edits.update({rows: value, count: str(max(2, len(validate_rows(value))))})
        self._merge(live or {}, edits, view)

    def _merge(self, live: dict[str, dict[str, str]], http: dict[str, str], view: EngineView | None) -> None:
        for key, arg, row in _live_fields():
            if view is not None and not _on_chain(row, view):
                continue
            if arg in live.get(key, {}):
                self.http.pop(row.name, None)
            if row.name in http:
                self.live.get(key, {}).pop(arg, None)
        self.live.update(live)
        self.live = {key: args for key, args in self.live.items() if args}
        self.http.update(http)
        self._on_change()

    def drop(self, live: dict[str, list[str]], http: list[str]) -> None:
        """Remove named entries.

        Names that are not staged are ignored — the client sends the whole set of entries that read clean, not a diff,
        so a name it has already dropped must not be an error. A live bucket emptied of its arguments goes with them:
        an empty bucket is not "no change", it is a setter the apply would still call.
        """
        removed = set(http)
        pipeline_fields = set(_pipeline_fields())
        if removed & pipeline_fields:
            removed.update(pipeline_fields)
        for field in removed:
            self.http.pop(field, None)
        for key, args in live.items():
            bucket = self.live.get(key)
            if bucket is None:
                continue
            for arg in args:
                bucket.pop(arg, None)
            if not bucket:
                del self.live[key]
        self._on_change()

    def clear(self) -> None:
        """Throw the whole buffer away — what a clean apply and an explicit discard both end with."""
        self.live = {}
        self.http = {}
        self._on_change()

    def snapshot(self) -> PendingSnapshot:
        """Return both buckets as the wire shape every staging route answers with."""
        return PendingSnapshot(live=self.live, http=self.http)

    def reconcile(self, readings: Readings) -> PendingSnapshot:
        """Return dirty fields for display, preserving the complete staged write payload."""
        return clean_pending(self.snapshot(), readings)
