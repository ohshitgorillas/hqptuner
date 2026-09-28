"""Read-only status surface — daemon health, State/Status frames, enumerations, static metadata, and the log tail.

Every route here answers from the poll loop's cached view or from files, so none of them writes to the daemon.
"""

import contextlib
from dataclasses import dataclass, replace

import httpx
from fastapi import APIRouter, Request

from hqptuner import __version__
from hqptuner.api import deps
from hqptuner.api.deps import Mgr
from hqptuner.api.errors import DaemonReadFailedError, NotLoadedError, refuse
from hqptuner.core import engineread
from hqptuner.core.engineread import LogTail
from hqptuner.engine.bands import Bands
from hqptuner.engine.junkadvisor import JunkVerdict
from hqptuner.lanes.live import chain
from hqptuner.metadata import MergedEnums, ModeInfo, StaticDb, StaticMetadata, merge_enumerations
from hqptuner.presets.store.autopilot import AutopilotError

router = APIRouter(prefix="/api")


@dataclass(frozen=True)
class HealthReport:
    """``GET /api/health``: daemon reachability, connection age, info/license, versions, credential verdict."""

    reachable: bool
    # `reachable` is the 4321 handshake alone and turns true before the rest of the
    # connect has run. `ready` is that whole load having finished with the 8088
    # configuration lane answering inside it.
    ready: bool
    # The control connection the connect body completed on, still standing. An
    # install whose configuration lane is down can still apply a live setting the
    # control lane takes.
    connected: bool
    unreachable_since: float | None
    # When the CURRENT control connection was established. A brief drop can be
    # shorter than a health poll, so `reachable` never visibly goes false and an
    # edge on it cannot be seen; this changes on every reconnect.
    connected_at: float | None
    info: dict[str, str] | None
    # installed release ("6.0.2") off the daemon's /about page — GetInfo's
    # `engine` is the separately-numbered DSP engine, not this.
    release: str
    license: dict[str, str] | None
    # HQPTuner's own version, not the engine's, read from the package.
    app_version: str
    # The 4321 handshake that decides `reachable` carries no authentication, so
    # `reachable` cannot speak for the 8088 configuration lane; this is that
    # lane's own verdict on the configured management credentials.
    credentials_ok: bool | None


@dataclass(frozen=True)
class StatusReport:
    """``GET /api/status`` data: the Status frame, its track metadata, the advisor's note, bands, and auto-pilot."""

    status: dict[str, str]
    metadata: dict[str, str] | None
    junk: JunkVerdict | None
    bands: Bands | None
    autopilot: bool
    metering: bool
    advisor: bool


@router.get("/health")
def health(manager: Mgr) -> HealthReport:
    """Return daemon reachability, connection age, info/license, HQPTuner's version, and the credential verdict.

    Answers from the poll loop's cached view, so it never waits on a socket and stays useful while the daemon is down.
    """
    readings = manager.readings
    return HealthReport(
        reachable=manager.reachable,
        ready=manager.ready,
        connected=manager.connected.is_set(),
        unreachable_since=manager.unreachable_since,
        connected_at=readings.loaded_at,
        info=readings.info,
        release=readings.release,
        license=readings.license,
        app_version=__version__,
        credentials_ok=readings.credentials_ok,
    )


@router.get("/state")
def state(manager: Mgr) -> deps.Snapshot[dict[str, str | None]]:
    """Return the daemon's last State frame with the engine's active filter/shaper chain folded in.

    Stale-flagged from the last-loaded copy while the daemon is unreachable; 503 until the first frame has landed.
    """
    # `active_chain` is not a State attribute: it is which filter/shaper chain the
    # engine currently has loaded (chain.active_chain — the configured mode when
    # pcm/sdm, Status.active_mode in auto, null when neither can answer). Served
    # here so the frontend knows which chain's controls are live-adjustable
    # without duplicating that State/Status fallback in JS.
    live = manager.readings.state
    data = None if live is None else {**live, "active_chain": chain.active_chain(manager)}
    return deps.snapshot(manager, data)


@router.get("/status")
def status(manager: Mgr) -> deps.Snapshot[StatusReport]:
    """Return the Status frame with its track metadata, the advisor's recommendation, and auto-pilot's state.

    503 until the first Status has landed; the recommendation is null whenever the metering reader has nothing to say.
    Auto-pilot rides along because it moves in the background — its own task can switch the filter, and a page that
    only asked when it last wrote would show the wrong control. An auto-pilot store too new to read reads as off here;
    a corrupt one refuses with ``store_corrupt``. ``metering``
    says whether the reader is running at all (``HQPTUNER_METERING_ENABLED``), which is what auto-pilot's switch grays
    against: a null recommendation cannot tell "nothing to report" from "nothing is reading". ``bands`` carries the
    header readout's three levels, null while the reader has nothing in front of it. ``advisor`` says whether the
    advisor, auto-pilot and the METER page are offered at all (``Config.advisor_enabled``); off, auto-pilot reads as
    off whatever its store holds.
    """
    frame = manager.readings.status
    if frame is None:
        raise refuse(NotLoadedError())
    junk = manager.metering.recommendation() if manager.metering is not None else None
    bands = manager.metering.bands() if manager.metering is not None else None
    advisor = manager.cfg.advisor_enabled
    autopilot = False
    if advisor:
        with contextlib.suppress(AutopilotError):
            autopilot = manager.presetops.autopilot.enabled
    report = StatusReport(
        status=frame,
        metadata=manager.readings.status_metadata,
        junk=junk,
        bands=bands,
        autopilot=autopilot,
        metering=manager.metering is not None,
        advisor=advisor,
    )
    return deps.snapshot(manager, report)


@router.get("/enumerations")
def enumerations(request: Request, manager: Mgr) -> deps.Snapshot[MergedEnums]:
    """Return the engine's enumerations merged with the static ``data/*.json`` overlay, plus the current output mode.

    The running engine owns the names, IDs, and ordering; the merge only annotates them. 503 until they have loaded.
    """
    if manager.readings.enums is None:
        raise refuse(NotLoadedError())
    mode_name = engineread.current_mode_name(manager)
    merged = merge_enumerations(manager.readings.enums, request.app.state.static, mode_name)
    mode = ModeInfo(index=(manager.readings.state or {}).get("mode"), name=mode_name)
    return deps.snapshot(manager, replace(merged, mode=mode))


@router.get("/metadata")
def metadata(request: Request) -> StaticDb:
    """Return the whole static ``data/*.json`` overlay — filters, shapers, and settings prose — unjoined.

    Loaded once at startup and never daemon-dependent, so this answers the same whether or not hqplayerd is up.
    """
    static: StaticMetadata = request.app.state.static
    return static.raw


@router.get("/log", response_model_exclude_none=True)
async def log_tail(manager: Mgr, lines: int = 50) -> LogTail:
    """Return a static tail of the daemon's log file (System-tab live view).

    Read-only, no daemon socket. A daemon that cannot be reached, or answers the read with an error, is refused.
    """
    n = max(1, min(lines, 500))
    try:
        return await engineread.read_log_tail(manager, n)
    except httpx.HTTPError as exc:
        raise refuse(DaemonReadFailedError(error=exc)) from exc
