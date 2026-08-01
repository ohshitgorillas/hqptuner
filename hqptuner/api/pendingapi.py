"""Pending/staging REST surface — the server-side staged-changes buffer.

Split out of ``app`` by the file-length gate, the same way ``matrixapi`` and
``livepresetapi`` are: a self-contained feature surface mounted alongside it.
The apply route stays in ``app`` and reads the buffer through ``_pending``.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..writer import known_live_settings
from .deps import Mgr
from .models import AutosaveBody, StageBody

router = APIRouter(prefix="/api")


class PendingStore:
    """Server-side staged-changes buffer. Survives browser reloads because it
    lives on the backend, not the client."""

    def __init__(self) -> None:
        self.live: dict[str, dict[str, str]] = {}
        self.http: dict[str, str] = {}

    def stage(self, live: dict[str, dict[str, str]], http: dict[str, str]) -> None:
        self.live.update(live)
        self.http.update(http)

    def clear(self) -> None:
        self.live = {}
        self.http = {}

    def snapshot(self) -> dict[str, Any]:
        return {"live": self.live, "http": self.http}


def _pending(request: Request) -> PendingStore:
    store: PendingStore = request.app.state.pending
    return store


def _apply_succeeded(report: dict[str, Any]) -> bool:
    """Whether every staged change actually took. A live edit counts only if its
    readback verified (`ok`); the persistent lane only if the running config
    reflected the change after the restart (`applied`). A soft failure — a value
    never converged, or a preset's endpoint is gone — returns False here so the
    caller keeps the pending buffer instead of silently dropping the edits."""
    if any(not entry.get("ok") for entry in report.get("live", [])):
        return False
    switched = report.get("switched")
    if switched is not None and not switched.get("active"):
        return False  # the preset switch never took — don't clear the preview
    persistent = report.get("persistent")
    return not (persistent is not None and not persistent.get("applied"))


@router.post("/config/stage")
def stage(body: StageBody, request: Request) -> dict[str, Any]:
    unknown = set(body.live) - set(known_live_settings())
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown live settings: {sorted(unknown)}")
    store = _pending(request)
    store.stage(body.live, body.http)
    return store.snapshot()


@router.get("/config/pending")
def pending(request: Request) -> dict[str, Any]:
    return _pending(request).snapshot()


@router.delete("/config/pending")
def discard(request: Request, manager: Mgr) -> dict[str, Any]:
    store = _pending(request)
    store.clear()
    # parked filter uploads belong to the staged process strings just discarded
    manager.presetops.clear_parked_filters()
    return store.snapshot()


@router.post("/autosave")
def set_autosave(body: AutosaveBody, manager: Mgr) -> dict[str, Any]:
    """Toggle auto-save: every successful apply/live write is folded back into
    the active preset's store file. Pure store flag — no daemon touch."""
    manager.presetops.store.set_autosave(body.enabled)
    return {"autosave": manager.presetops.store.autosave}
