"""Pending/staging REST surface — the server-side staged-changes buffer.

Split out of ``app`` by the file-length gate, the same way ``matrixapi`` and
``livepresetapi`` are: a self-contained feature surface mounted alongside it.
The apply route stays in ``app`` and reads the buffer through ``_pending``.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from hqptuner.api.deps import Mgr
from hqptuner.api.models import AutosaveBody, StageBody
from hqptuner.audit import AuditLog
from hqptuner.lanes.writer import known_live_settings

router = APIRouter(prefix="/api")


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

    def snapshot(self) -> dict[str, Any]:
        """Return both buckets as the wire shape every staging route answers with."""
        return {"live": self.live, "http": self.http}


def _pending(request: Request) -> PendingStore:
    store: PendingStore = request.app.state.pending
    return store


def _audit(request: Request) -> AuditLog:
    log: AuditLog = request.app.state.audit
    return log


def _apply_succeeded(report: dict[str, Any]) -> bool:
    """Whether every staged change actually took.

    A live edit counts only if its readback verified (`ok`); the persistent lane only if the running config reflected
    the change after the restart (`applied`). A soft failure — a value never converged, or a preset's endpoint is gone
    — returns False here so the caller keeps the pending buffer instead of silently dropping the edits.
    """
    if any(not entry.get("ok") for entry in report.get("live", [])):
        return False
    switched = report.get("switched")
    if switched is not None and not switched.get("active"):
        return False  # the preset switch never took — don't clear the preview
    persistent = report.get("persistent")
    return not (persistent is not None and not persistent.get("applied"))


@router.post("/config/stage")
def stage(body: StageBody, request: Request) -> dict[str, Any]:
    """Merge the request's edits into the staged buffer, drop what it reports clean, and return the whole buffer.

    422 when a live key is not a known live setting — the daemon would have no setter to call for it. Nothing is
    written to the daemon here; apply is a separate call.
    """
    unknown = set(body.live) - set(known_live_settings())
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown live settings: {sorted(unknown)}")
    store = _pending(request)
    # merge, THEN drop: one request both re-stages a field and reports it clean
    # when an edit lands back on its baseline, and the drop is the later word.
    store.stage(body.live, body.http)
    store.drop(body.drop.live, body.drop.http)
    # what THIS request carried, not the accumulated buffer: the buffer is a sum
    # of requests and the log has to be able to attribute a field to one of them
    _audit(request).stage(body.http, body.live, body.drop.model_dump())
    return store.snapshot()


@router.get("/config/pending")
def pending(request: Request) -> dict[str, Any]:
    """Return the staged buffer as it stands, so a reloaded browser recovers what it had staged."""
    return _pending(request).snapshot()


@router.delete("/config/pending")
def discard(request: Request, manager: Mgr) -> dict[str, Any]:
    """Throw away everything staged, recording it first, and release the filter uploads parked for it.

    Touches the daemon not at all — the discarded edits were never written to it.
    """
    store = _pending(request)
    # snapshot before the clear: the discard's whole effect is to destroy this,
    # so the record is the only surviving copy of what was thrown away
    lost_http, lost_live = dict(store.http), dict(store.live)
    store.clear()
    _audit(request).discard(lost_http, lost_live)
    # parked filter uploads belong to the staged process strings just discarded
    manager.presetops.clear_parked_filters()
    return store.snapshot()


@router.post("/autosave")
def set_autosave(body: AutosaveBody, manager: Mgr) -> dict[str, Any]:
    """Toggle auto-save: every successful apply/live write is folded back into the active preset's store file.

    Pure store flag — no daemon touch.
    """
    manager.presetops.store.set_autosave(enabled=body.enabled)
    return {"autosave": manager.presetops.store.autosave}
