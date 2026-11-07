"""Status surface — daemon health, State/Status frames, enumerations, static metadata, and the log tail.

Every route here answers from the poll loop's cached view or from files, except ``/log``, which reads the daemon over
8088 on demand. None of them writes to the daemon or changes anything.
"""

import contextlib
from dataclasses import dataclass, replace

import httpx
from fastapi import APIRouter, Request

from hqptuner.api import deps
from hqptuner.api.deps import Mgr
from hqptuner.api.errors import DaemonReadFailedError, ErrorBody, NotLoadedError, refuse
from hqptuner.core import engineread
from hqptuner.core.engineread import LogTail
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.junkadvisor import JunkVerdict
from hqptuner.engine.logtail import NoLogError
from hqptuner.engine.view import EngineView
from hqptuner.metadata import MergedEnums, ModeInfo, StaticDb, StaticMetadata, merge_enumerations
from hqptuner.presets.store.autopilot import AutopilotError

router = APIRouter(prefix="/api")


@dataclass(frozen=True)
class HealthReport:
    """``GET /api/health``: the connection's phase, generation, age and recorded verdicts."""

    phase: str
    generation: int
    # Seconds on mgr.clock's monotonic clock since the standing control connection
    # became Reachable; null while none stands.
    connected_at: float | None
    # The 4321 handshake carries no authentication, so the phase cannot speak for
    # the 8088 configuration lane's credentials; this is that lane's own verdict on
    # the configured management credentials.
    credentials_ok: bool | None
    address_found: bool | None


@dataclass(frozen=True)
class StatusReport:
    """``GET /api/status`` data: the Status frame, its track metadata, the advisor's note, and auto-pilot."""

    status: dict[str, str]
    metadata: dict[str, str] | None
    junk: JunkVerdict | None
    autopilot: bool
    metering: bool
    advisor: bool


@router.get("/health")
def health(manager: Mgr) -> HealthReport:
    """Return the connection's phase, generation, age, and recorded credential and address verdicts.

    Answers from the poll loop's cached view, so it never waits on a socket and stays useful while the daemon is down.
    """
    readings = manager.readings
    standing = manager.phase.standing
    return HealthReport(
        phase=standing.phase.value.capitalize(),
        generation=standing.generation,
        connected_at=_age(standing.connected_since, now=manager.clock.monotonic()),
        credentials_ok=readings.credentials_ok,
        address_found=readings.address_found,
    )


def _age(since: float | None, *, now: float) -> float | None:
    """Return the seconds from the monotonic reading ``since`` to ``now``, or ``None`` when there is no ``since``."""
    return None if since is None else now - since


@router.get("/state")
def state(manager: Mgr) -> deps.Snapshot[dict[str, str | None]]:
    """Return the daemon's last State frame with the engine's active filter/shaper chain folded in.

    Served from the last-loaded copy, reachable daemon or not; 503 until the first frame has landed.
    """
    # `active_chain` is not a State attribute: it is which filter/shaper chain the
    # engine currently has loaded (EngineView.loaded_chain — the configured mode when
    # pcm/sdm, Status.active_mode in auto, null when neither can answer). Served
    # here so the frontend knows which chain's controls are live-adjustable
    # without duplicating that State/Status fallback in JS.
    live = manager.readings.state
    data = None if live is None else {**live, "active_chain": EngineView.of(manager.readings).loaded_chain()}
    return deps.snapshot(data)


@router.get("/status")
def status(manager: Mgr) -> deps.Snapshot[StatusReport]:
    """Return the Status frame with its track metadata, the advisor's recommendation, and auto-pilot's state.

    503 until the first Status has landed; the recommendation is null whenever the metering reader has nothing to say.
    Auto-pilot rides along because it moves in the background — its own task can switch the filter, and a page that
    only asked when it last wrote would show the wrong control. An auto-pilot store too new to read reads as off here;
    a corrupt one refuses with ``store_corrupt``. ``metering``
    says whether the reader is running at all (``HQPTUNER_METERING_ENABLED``), which is what auto-pilot's switch grays
    against: a null recommendation cannot tell "nothing to report" from "nothing is reading". ``advisor`` says whether
    the advisor and auto-pilot are offered at all (``Config.advisor_enabled``); off, the recommendation
    is null and auto-pilot reads as off whatever its store holds.
    """
    frame = manager.readings.status
    if frame is None:
        raise refuse(NotLoadedError())
    advisor = manager.cfg.advisor_enabled
    junk = manager.metering.recommendation() if advisor and manager.metering is not None else None
    autopilot = False
    if advisor:
        with contextlib.suppress(AutopilotError):
            autopilot = manager.presetops.autopilot.enabled
    report = StatusReport(
        status=frame,
        metadata=manager.readings.status_metadata,
        junk=junk,
        autopilot=autopilot,
        metering=manager.metering is not None,
        advisor=advisor,
    )
    return deps.snapshot(report)


@router.get("/enumerations")
def enumerations(request: Request, manager: Mgr) -> deps.Snapshot[MergedEnums]:
    """Return the engine's enumerations merged with the static ``data/*.json`` overlay, plus the current output mode.

    The running engine owns the names, IDs, and ordering; the merge only annotates them. 503 until they have loaded.
    """
    return merged_enumerations(manager, deps.static_of(request))


def merged_enumerations(manager: ConnectionManager, static: StaticMetadata) -> deps.Snapshot[MergedEnums]:
    """Answer ``GET /api/enumerations``'s body off the manager and the static overlay, refusing until they loaded."""
    view = EngineView.of(manager.readings)
    if view.enums is None:
        raise refuse(NotLoadedError())
    mode_name = engineread.current_mode_name(view)
    merged = merge_enumerations(view, static, mode_name)
    mode = ModeInfo(index=engineread.current_mode_index(view), name=mode_name)
    return deps.snapshot(replace(merged, mode=mode))


@router.get("/metadata")
def metadata(request: Request) -> StaticDb:
    """Return the whole static ``data/*.json`` overlay — filters, shapers, and settings prose — unjoined.

    Loaded once at startup and never daemon-dependent, so this answers the same whether or not hqplayerd is up.
    """
    return deps.static_of(request).raw


class DaemonHasNoLogError(ErrorBody):
    """The daemon has no log to serve (its log page is 404); the page words this case itself."""

    code = "daemon_log_absent"

    def __init__(self, *, error: NoLogError) -> None:
        """Render ``error``'s own message, naming no further fact."""
        super().__init__(str(error))


@router.get("/log", response_model_exclude_none=True)
async def log_tail(manager: Mgr, lines: int = 50) -> LogTail:
    """Return a static tail of the daemon's log file (the Logging drawer's tail).

    Read-only, no 4321 socket. A daemon that cannot be reached, or answers the read with an error, is refused;
    one with no log to serve is refused under a code of its own.
    """
    n = max(1, min(lines, 500))
    try:
        return await engineread.read_log_tail(manager, n)
    except NoLogError as exc:
        raise refuse(DaemonHasNoLogError(error=exc)) from exc
    except httpx.HTTPError as exc:
        raise refuse(DaemonReadFailedError(error=exc)) from exc
