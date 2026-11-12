"""Pending/staging REST surface — the server-side staged-changes buffer.

A self-contained feature surface mounted alongside ``app``.
"""

from dataclasses import dataclass

from fastapi import APIRouter, Request

from hqptuner.api import deps
from hqptuner.api.deps import Mgr
from hqptuner.api.errors import ErrorBody, refuse
from hqptuner.api.models import AutosaveBody, StageBody
from hqptuner.audit import AuditLog
from hqptuner.conf import presetconf
from hqptuner.core.applyops import ApplyReport
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http.restore import RestoreOutcome
from hqptuner.lanes.writer import LiveWriteFailed, known_live_settings

router = APIRouter(prefix="/api")

# The longest value a staged field carries is a ``matrix_pipelines`` or ``matrix_profile_save`` JSON of 128 rows, the
# most pipelines the daemon's table holds. A row is about 110 characters of JSON around a ``process`` string of up to
# 1900 characters for a multi-filter absolute path, so it stays under 2048, and 128 * 2048 = 262144 characters. Every
# other field is a short scalar.
MAX_VALUE_LENGTH = 262_144
# The write path routes each field of ``FIELD_MAP``, ``LOCAL_BACKEND_MAP`` and ``PLUGIN_MAP``, the live settings, and
# ``matrix_pipelines``, the two profile verbs, ``net_device`` and the fixed-volume pair: under a hundred keys together.
# 256 leaves room for fields still to come and stays far under what a flood needs.
MAX_STAGED_KEYS = 256


@dataclass(frozen=True)
class PendingSnapshot:
    """The staged buffer as every staging route answers with it: live-lane buckets and restore-lane fields."""

    live: dict[str, dict[str, str]]
    http: dict[str, str]


@dataclass(frozen=True)
class AutosaveState:
    """``POST /api/autosave``'s answer: whether auto-save is now armed."""

    autosave: bool


class PendingStore:
    """Server-side staged-changes buffer.

    Survives browser reloads because it lives on the backend, not the client.
    """

    def __init__(self) -> None:
        """Start with both buckets empty — nothing staged."""
        self.live: dict[str, dict[str, str]] = {}
        self.http: dict[str, str] = {}

    def stage(self, live: dict[str, dict[str, str]], http: dict[str, str]) -> None:
        """Merge entries into the buffer, a later value for the same key replacing the earlier one.

        The merge is shallow on the live side: a live key's whole argument bucket is replaced, not merged per argument.
        """
        self.live.update(live)
        self.http.update(http)

    def drop(self, live: dict[str, list[str]], http: list[str]) -> None:
        """Remove named entries.

        Names that are not staged are ignored — the client sends the whole set of entries that read clean, not a diff,
        so a name it has already dropped must not be an error. A live bucket emptied of its arguments goes with them:
        an empty bucket is not "no change", it is a setter the apply would still call.
        """
        for field in http:
            self.http.pop(field, None)
        for key, args in live.items():
            bucket = self.live.get(key)
            if bucket is None:
                continue
            for arg in args:
                bucket.pop(arg, None)
            if not bucket:
                del self.live[key]

    def clear(self) -> None:
        """Throw the whole buffer away — what a clean apply and an explicit discard both end with."""
        self.live = {}
        self.http = {}

    def snapshot(self) -> PendingSnapshot:
        """Return both buckets as the wire shape every staging route answers with."""
        return PendingSnapshot(live=self.live, http=self.http)


def pending_store(request: Request) -> PendingStore:
    """Return the app's staged-changes buffer."""
    store: PendingStore = request.app.state.pending
    return store


def _audit(request: Request) -> AuditLog:
    log: AuditLog = request.app.state.audit
    return log


def apply_succeeded(report: ApplyReport) -> bool:
    """Whether every staged change actually took.

    A live edit counts only if its readback verified (`ok`); the persistent lane only if the running config reflected
    the change after the restart (`applied`). A soft failure — a value never converged, or a preset's endpoint is gone
    — returns False here so the caller keeps the pending buffer instead of silently dropping the edits.
    """
    if any(isinstance(entry, LiveWriteFailed) for entry in report.live):
        return False
    return report.persistent is None or report.persistent.outcome is RestoreOutcome.APPLIED


class UnknownLiveSettingsError(ErrorBody):
    """A stage request named live keys that are not known live settings at all."""

    code = "fields_unknown"

    def __init__(self, *, unknown: set[str]) -> None:
        """Render the wording naming the ``unknown`` keys, sorted."""
        super().__init__(f"unknown live settings: {sorted(unknown)}")


class StagedValueTooLongError(ErrorBody):
    """A staged or live value is longer than the ceiling every real value stays under."""

    code = "invalid_input"

    def __init__(self, *, field: str) -> None:
        """Render the wording naming the ``field`` whose value is too long."""
        super().__init__(f"the value of {field} is too long")


class StagedBufferFullError(ErrorBody):
    """A stage request would take the buffer past the number of fields the write path routes."""

    code = "invalid_input"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("too many settings are staged")


#: Why one field's value is refused when its page does not list it; the live route renders it per field.
NOT_OFFERED_REASON = "the value is not one HQPlayer offers"


class StagedValueNotOfferedError(ErrorBody):
    """A staged value is outside the choices its own page lists."""

    code = "invalid_input"

    def __init__(self, *, fields: tuple[str, ...]) -> None:
        """Render the wording naming the refused ``fields``."""
        super().__init__(f"{', '.join(sorted(fields))}: {NOT_OFFERED_REASON}")


def check_offered(manager: ConnectionManager, values: dict[str, str]) -> presetconf.ChoiceCheck:
    """Check ``values`` against the pages the daemon last served, answering a page not yet loaded as the 8088 lane does.

    A page that has not loaded answers through ``deps.ensure_form``: 503 before the first read, 502 when the read
    failed, which is what ``GET /api/config`` and ``GET /api/matrix`` answer until it loads. Returns the check, whose
    ``refused`` names the fields outside their page's choices.
    """
    readings = manager.readings
    check = presetconf.check_choices(readings.config_form, readings.matrix_form, values)
    for field in check.not_loaded:
        if field in presetconf.MATRIX_PAGE_NAME:
            deps.ensure_form(readings.matrix_form, readings.matrix_error)
        else:
            deps.ensure_form(readings.config_form, readings.config_error)
    return check


def refuse_long_values(http: dict[str, str], live: dict[str, dict[str, str]]) -> None:
    """Refuse a request any of whose values (every ``http`` value, every live argument value) is over the ceiling."""
    for field, value in http.items():
        if len(value) > MAX_VALUE_LENGTH:
            raise refuse(StagedValueTooLongError(field=field))
    for key, args in live.items():
        for arg, value in args.items():
            if len(value) > MAX_VALUE_LENGTH:
                raise refuse(StagedValueTooLongError(field=f"{key} {arg}"))


@router.post("/config/stage")
def stage(body: StageBody, request: Request, manager: Mgr) -> PendingSnapshot:
    """Merge the request's edits into the staged buffer, drop what it reports clean, and return the whole buffer.

    422 when a value is over the length ceiling or the merge would take the buffer past the key ceiling, when a value
    is outside the choices its own page lists (503 or 502 when that page is not loaded), and when a live key is not a
    known live setting — the daemon would have no setter to call for it. A refused request merges nothing. Nothing is
    written to the daemon here; apply is a separate call.
    """
    refuse_long_values(body.http, body.live)
    store = pending_store(request)
    if len(store.http.keys() | body.http.keys()) + len(store.live.keys() | body.live.keys()) > MAX_STAGED_KEYS:
        raise refuse(StagedBufferFullError())
    check = check_offered(manager, body.http)
    if check.refused:
        raise refuse(StagedValueNotOfferedError(fields=check.refused))
    unknown = set(body.live) - set(known_live_settings())
    if unknown:
        raise refuse(UnknownLiveSettingsError(unknown=unknown))
    # merge, THEN drop: one request both re-stages a field and reports it clean
    # when an edit lands back on its baseline, and the drop is the later word.
    store.stage(body.live, body.http)
    store.drop(body.drop.live, body.drop.http)
    # what THIS request carried, not the accumulated buffer: the buffer is a sum
    # of requests and the log has to be able to attribute a field to one of them
    _audit(request).stage(body.http, body.live, body.drop.model_dump())
    return store.snapshot()


@router.get("/config/pending")
def pending(request: Request) -> PendingSnapshot:
    """Return the staged buffer as it stands, so a reloaded browser recovers what it had staged."""
    return pending_store(request).snapshot()


@router.delete("/config/pending")
def discard(request: Request, manager: Mgr) -> PendingSnapshot:
    """Throw away everything staged, recording it first, and release the filter uploads parked for it.

    Touches the daemon not at all — the discarded edits were never written to it.
    """
    store = pending_store(request)
    # snapshot before the clear: the discard's whole effect is to destroy this,
    # so the record is the only surviving copy of what was thrown away
    lost_http, lost_live = dict(store.http), dict(store.live)
    store.clear()
    _audit(request).discard(lost_http, lost_live)
    # parked filter uploads belong to the staged process strings just discarded
    manager.presetops.clear_parked_filters()
    return store.snapshot()


@router.post("/autosave")
def set_autosave(body: AutosaveBody, manager: Mgr) -> AutosaveState:
    """Toggle auto-save: every successful apply/live write is folded back into the active preset's store file.

    Pure store flag — no daemon touch.
    """
    manager.presetops.store.set_autosave(enabled=body.enabled)
    return AutosaveState(manager.presetops.store.autosave)
