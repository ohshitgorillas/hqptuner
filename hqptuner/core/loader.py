"""The connect body and the heartbeat: dial, handshake, fill the readings, poll, and report each wire fact.

Neither sets a phase. Every move of the daemon's standing is a fact handed to ``mgr.phase.report``, and the
phase module decides what it moves.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from hqptuner.core import engineread
from hqptuner.core.lifecycle import Fact
from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes.http import forms
from hqptuner.lanes.http.forms import FormsOutcome
from hqptuner.lanes.live import lane
from hqptuner.lanes.live.chain import active_chain
from hqptuner.presets import fileconfig

if TYPE_CHECKING:
    import asyncio

    from hqptuner.core.manager import ConnectionManager
    from hqptuner.core.readings import EngineFields

log = logging.getLogger(__name__)

#: The mode index of ``[source]``, which keeps the lists the engine already enumerated.
SOURCE_MODE = "0"


def form_fact(outcome: FormsOutcome) -> Fact | None:
    """Return the wire fact a forms pass proves, or None for one that proves nothing.

    A credential refusal is an answer that moves nothing: it rides ``credentials_ok``. No client means no read
    was tried.
    """
    if outcome is FormsOutcome.OK:
        return Fact.FORM_ANSWERED
    if outcome is FormsOutcome.NO_ANSWER:
        return Fact.FORM_STOPPED
    return None


def poll_due(now: float, polled_at: float, interval: float) -> bool:
    """Answer whether ``interval`` has run since the last poll of the forms and the enumerations."""
    return now - polled_at >= interval


def mode_moved(before: str | None, after: str | None) -> bool:
    """Answer whether State's mode index moved to a mode whose lists must be enumerated afresh."""
    return after is not None and after not in (before, SOURCE_MODE)


@dataclass
class Cadence:
    """When the heartbeat last polled the forms and the enumerations on the connection standing now."""

    polled_at: float = -math.inf


async def run(mgr: ConnectionManager, stop: asyncio.Event) -> None:
    """Dial until a connection stands, poll it until it goes, and dial again, until ``stop`` is set.

    After each pass the window is reported run, so a Down past it turns Alarm and a pending request settles by
    deadline on the manager's clock.
    """
    cadence = Cadence()
    try:
        while not stop.is_set():
            await _pass(mgr, cadence)
            mgr.phase.report(Fact.WINDOW_RAN, mgr.clock.monotonic())
            await _rest(mgr, stop)
    finally:
        await _hang_up(mgr)


async def _pass(mgr: ConnectionManager, cadence: Cadence) -> None:
    """Dial when no connection stands, else run one heartbeat on the one that does."""
    client = mgr.control
    if client is None:
        await connect(mgr)
        cadence.polled_at = mgr.clock.monotonic()
        return
    try:
        await _beat(mgr, client, cadence)
    except ControlError as exc:
        log.info("control connection lost: %s", exc)
        await _lost(mgr)


async def _rest(mgr: ConnectionManager, stop: asyncio.Event) -> None:
    """Idle between passes: the status cadence while connected, the dial cadence while Down; ``stop`` cuts it short."""
    if mgr.control is not None:
        await mgr.clock.pace(stop, mgr.cfg.status_interval)
    else:
        await mgr.clock.wait(stop, mgr.cfg.poll_interval)


async def connect(mgr: ConnectionManager) -> None:
    """Dial, handshake and fill the readings, leaving ``mgr.control`` set only when a connection stands.

    ``GetInfo`` answered on the new socket is the handshake. A dial refused or unanswered reports that and
    holds nothing; a socket lost while the readings fill is a departure on the new connection.
    """
    cfg = mgr.cfg
    client = ControlClient(cfg.hqp_host, cfg.hqp_control_port, cfg.request_timeout, deadline=mgr.clock)
    try:
        await client.connect()
        info = await client.get_info()
    except ControlError as exc:
        log.debug("control dial turned away: %s", exc)
        await client.close()
        mgr.phase.report(Fact.DIAL_REFUSED, mgr.clock.monotonic())
    else:
        mgr.control = client
        mgr.readings.info = info
        mgr.phase.report(Fact.GETINFO_ANSWERED, mgr.clock.monotonic())
        await _stand(mgr, client)


async def _stand(mgr: ConnectionManager, client: ControlClient) -> None:
    """Fill the readings on the connection just made, dropping it if the daemon ends it meanwhile."""
    try:
        await _fill(mgr, client)
    except ControlError as exc:
        log.info("control connection lost while reading: %s", exc)
        await _lost(mgr)


async def _fill(mgr: ConnectionManager, client: ControlClient) -> None:
    """Read every Engine reading on a new connection, then the forms, the File and the device capability."""
    fields = await _fast(client)
    fields.update(await _slow(client))
    _take(mgr, fields)
    if await _forms(mgr) is Fact.FORM_ANSWERED:
        await _file_config(mgr)
    await engineread.refresh_device_caps(mgr, force=True)


async def _beat(mgr: ConnectionManager, client: ControlClient, cadence: Cadence) -> None:
    """Re-read State and Status; on the poll cadence or a mode move, the enumerations and the forms too."""
    before_mode = (mgr.readings.state or {}).get("mode")
    before_chain = active_chain(mgr)
    fields = await _fast(client)
    now = mgr.clock.monotonic()
    due = poll_due(now, cadence.polled_at, mgr.cfg.poll_interval)
    moved = mode_moved(before_mode, (fields.get("state") or {}).get("mode"))
    if due or moved:
        fields.update(await _slow(client))
    _take(mgr, fields)
    await lane.chain_entered(mgr, client, before_chain, reenumerated=due or moved)
    if due:
        cadence.polled_at = now
        await _forms(mgr)


async def _fast(client: ControlClient) -> EngineFields:
    """Read State and Status, leaving State out when HQPlayer refuses the read."""
    status, _metadata = await client.get_status()
    fields: EngineFields = {"status": status}
    state = await client.state_unless_refused()
    if state is not None:
        fields["state"] = state
    return fields


async def _slow(client: ControlClient) -> EngineFields:
    """Read the enumerations, with the matrix profiles, the volume range and the active configuration."""
    return {
        "enums": await client.get_all_enumerations(),
        "matrix_profiles": await client.get_matrix_profiles(),
        "volume_range": await client.get_volume_range(),
        "active_config": await client.get_active_config(),
    }


def _take(mgr: ConnectionManager, fields: EngineFields) -> None:
    """Take one Engine reading, stamped with the generation the connection stands in."""
    mgr.readings.take_engine(mgr.phase.standing.generation, **fields)


async def _forms(mgr: ConnectionManager) -> Fact | None:
    """Refresh the forms and report the fact the pass proves; return it."""
    fact = form_fact((await forms.refresh(mgr)).outcome)
    if fact is not None:
        mgr.phase.report(fact, mgr.clock.monotonic())
    return fact


async def _file_config(mgr: ConnectionManager) -> None:
    """Read the File's running config off the backup archive, logging a lane that does not answer."""
    try:
        await fileconfig.load_file_config(mgr)
    except httpx.HTTPError as exc:
        log.warning("file config read failed: %s", exc)


async def _lost(mgr: ConnectionManager) -> None:
    """Drop the connection the daemon ended: the readings break first, then the departure is reported."""
    client, mgr.control = mgr.control, None
    if client is not None:
        await client.close()
    mgr.readings.break_engine()
    mgr.phase.report(Fact.SOCKET_LOST, mgr.clock.monotonic())


async def _hang_up(mgr: ConnectionManager) -> None:
    """Close the connection on the way out; HQPTuner closing it is no departure and reports nothing."""
    client, mgr.control = mgr.control, None
    if client is not None:
        await client.close()
