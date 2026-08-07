"""Read-only status surface — daemon health, State/Status frames, enumerations, static metadata, and the log tail.

Every route here answers from the poll loop's cached view or from files, so none of them writes to the daemon.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from hqptuner import __version__
from hqptuner.api import deps
from hqptuner.api.deps import Mgr
from hqptuner.lanes import livechain
from hqptuner.metadata import StaticMetadata, merge_enumerations

router = APIRouter(prefix="/api")


@router.get("/health")
def health(manager: Mgr) -> dict[str, Any]:
    """Return daemon reachability, the current connection's age, alarm/info/license, and HQPTuner's own version.

    Answers from the poll loop's cached view, so it never waits on a socket and stays useful while the daemon is down.
    """
    return {
        "reachable": manager.reachable,
        "unreachable_since": manager.unreachable_since,
        # When the CURRENT control connection was established. A brief drop can be
        # shorter than the frontend's health poll, so `reachable` never visibly goes
        # false and an edge on it cannot be seen; this changes on every reconnect,
        # which is what the LIVE page keys its stale-error clearing on.
        "connected_at": manager.loaded_at,
        "alarm": manager.alarm,
        "info": manager.info,
        "license": manager.license,
        # HQPTuner's own version, not the engine's: the About HQPTuner card reads
        # it from here so the package is the single source of truth.
        "app_version": __version__,
    }


@router.get("/state")
def state(manager: Mgr) -> dict[str, Any]:
    """Return the daemon's last State frame with the engine's active filter/shaper chain folded in.

    Stale-flagged from the last-loaded copy while the daemon is unreachable; 503 until the first frame has landed.
    """
    # `active_chain` is not a State attribute: it is which filter/shaper chain the
    # engine currently has loaded (livechain.active_chain — the configured mode when
    # pcm/sdm, Status.active_mode in auto, null when neither can answer). Served
    # here so the frontend knows which chain's controls are live-adjustable
    # without duplicating that State/Status fallback in JS.
    live = manager.state
    data = None if live is None else {**live, "active_chain": livechain.active_chain(manager)}
    return deps.snapshot(manager, data)


@router.get("/status")
def status(manager: Mgr) -> dict[str, Any]:
    """Return the daemon's Status frame with its track metadata and the junk-filter advisor's recommendation.

    503 until the first Status has landed; the recommendation is null whenever the metering reader has nothing to say.
    """
    if manager.status is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    junk = manager.metering.recommendation() if manager.metering is not None else None
    return deps.snapshot(manager, {"status": manager.status, "metadata": manager.status_metadata, "junk": junk})


@router.get("/enumerations")
def enumerations(request: Request, manager: Mgr) -> dict[str, Any]:
    """Return the engine's enumerations merged with the static ``data/*.json`` overlay, plus the current output mode.

    The running engine owns the names, IDs, and ordering; the merge only annotates them. 503 until they have loaded.
    """
    if manager.enums is None:
        raise HTTPException(status_code=503, detail="not yet loaded from daemon")
    mode_name = manager.current_mode_name()
    merged = merge_enumerations(manager.enums, request.app.state.static, mode_name)
    merged["mode"] = {"index": (manager.state or {}).get("mode"), "name": mode_name}
    return deps.snapshot(manager, merged)


@router.get("/metadata")
def metadata(request: Request) -> dict[str, Any]:
    """Return the whole static ``data/*.json`` overlay — filters, shapers, and settings prose — unjoined.

    Loaded once at startup and never daemon-dependent, so this answers the same whether or not hqplayerd is up.
    """
    static: StaticMetadata = request.app.state.static
    return static.raw


@router.get("/log")
async def log_tail(manager: Mgr, lines: int = 50) -> dict[str, Any]:
    """Return a static tail of the daemon's log file (System-tab live view).

    Read-only, no daemon socket — reads the file the running config points at.
    """
    n = max(1, min(lines, 500))
    return await manager.read_log_tail(n)
