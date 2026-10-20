"""The connect body and the heartbeat: dial, handshake, fill the readings, poll, and report each wire fact.

Neither sets a phase. Every move of the daemon's standing is a fact handed to ``mgr.phase.report``, and the
phase module decides what it moves.
"""

from __future__ import annotations

import contextlib
import logging
import math
import zipfile
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from hqptuner import voltrace
from hqptuner.conf import engineconf
from hqptuner.core import engineread
from hqptuner.core.lifecycle import Fact
from hqptuner.engine import release
from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import (
    CommandError,
    ControlError,
    ResponseTooLargeError,
    UnparseableResponseError,
)
from hqptuner.lanes.http import forms
from hqptuner.lanes.http.forms import FormsOutcome
from hqptuner.lanes.live import lane
from hqptuner.lanes.live.chain import active_chain
from hqptuner.presets import fileconfig, presetlane
from hqptuner.presets.store.presets import PresetError

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


def archive_owed(forms_fact: Fact | None, *, archive_read: bool) -> bool:
    """Answer whether this pass reads the settings archive: the forms answered and this connection has not read it."""
    return forms_fact is Fact.FORM_ANSWERED and not archive_read


def lane_fact(forms_fact: Fact | None, *, archive_read: bool) -> Fact | None:
    """Return the wire fact the configuration lane's pass proves on this connection.

    The lane's read includes the archive read, so the forms answering proves nothing until the archive has been
    read on this connection too.
    """
    if forms_fact is Fact.FORM_ANSWERED and not archive_read:
        return None
    return forms_fact


def poll_due(now: float, polled_at: float, interval: float) -> bool:
    """Answer whether ``interval`` has run since the last poll of the forms and the enumerations."""
    return now - polled_at >= interval


def mode_moved(before: str | None, after: str | None) -> bool:
    """Answer whether State's mode index moved to a mode whose lists must be enumerated afresh."""
    return after is not None and after not in (before, SOURCE_MODE)


def drop_fact(exc: ControlError) -> Fact:
    """Return the wire fact a control read that raised ``exc`` proves once its client has closed the socket.

    A frame that will not parse and a frame too large to hold are HQPTuner's own close, a taken Down. EOF, reset and
    timeout are a departure.
    """
    if isinstance(exc, UnparseableResponseError | ResponseTooLargeError):
        return Fact.SOCKET_CLOSED
    return Fact.SOCKET_LOST


def still_stands(standing: ControlClient | None, client: ControlClient) -> bool:
    """Answer whether ``client``, the connection being read, is still the one standing."""
    return standing is client


@dataclass
class Cadence:
    """When the connection standing now last polled the forms and enumerations, and whether it read the archive."""

    polled_at: float = -math.inf  # the manager's monotonic clock, seconds: when the last poll ran
    archive_read: bool = False


async def run(mgr: ConnectionManager, stop: asyncio.Event) -> None:
    """Dial until a connection stands, poll it until it goes, and dial again, until ``stop`` is set.

    After each pass the window is reported run, so a Down past it turns Alarm and a pending request settles by
    deadline on the manager's clock. A fault that ends the loop is HQPTuner's own: it closes the connection standing,
    a taken Down that leaves the generation where it stood, and is logged and raised, so the next dial proves what
    is true. ``stop`` ending it closes the connection and reports nothing.
    """
    cadence = Cadence()
    try:
        while not stop.is_set():
            await _pass(mgr, cadence)
            mgr.phase.report(Fact.WINDOW_RAN, mgr.clock.monotonic())
            await _rest(mgr, stop)
    except Exception:
        log.exception("connect loop ended by a fault of HQPTuner's own")
        await _closed_on_fault(mgr)
        raise
    finally:
        await _hang_up(mgr)


async def _pass(mgr: ConnectionManager, cadence: Cadence) -> None:
    """Dial when no connection stands, else run one heartbeat on the one that does."""
    client = mgr.control
    if client is None:
        cadence.archive_read = False
        await connect(mgr, cadence)
        cadence.polled_at = mgr.clock.monotonic()
        return
    try:
        await _beat(mgr, client, cadence)
    except CommandError as exc:
        log.warning("heartbeat command answered Error, connection kept: %s", exc)
    except ControlError as exc:
        log.info("control connection lost: %s", exc)
        await _lost(mgr, drop_fact(exc))


async def _rest(mgr: ConnectionManager, stop: asyncio.Event) -> None:
    """Idle between passes: the status cadence while connected, the dial cadence while Down; ``stop`` cuts it short."""
    if mgr.control is not None:
        await mgr.clock.pace(stop, mgr.cfg.status_interval)
    else:
        await mgr.clock.wait(stop, mgr.cfg.poll_interval)


async def connect(mgr: ConnectionManager, cadence: Cadence) -> None:
    """Dial, handshake and fill the readings, leaving ``mgr.control`` set only when a connection stands.

    ``GetInfo`` answered on the new socket is the handshake. A dial refused or unanswered reports that and
    holds nothing; a socket lost while the readings fill is a departure on the new connection, and a frame that will
    not parse is a close of HQPTuner's own.
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
        mgr.phase.report(Fact.GETINFO_ANSWERED, mgr.clock.monotonic())
        await _stand(mgr, client, cadence, info)


async def _stand(mgr: ConnectionManager, client: ControlClient, cadence: Cadence, info: dict[str, str]) -> None:
    """Fill the readings on the connection just made, dropping it if the daemon ends it meanwhile."""
    try:
        await _fill(mgr, client, cadence, info)
    except CommandError as exc:
        log.warning("reading command answered Error, connection kept: %s", exc)
    except ControlError as exc:
        log.info("control connection lost while reading: %s", exc)
        await _lost(mgr, drop_fact(exc))


async def _fill(mgr: ConnectionManager, client: ControlClient, cadence: Cadence, info: dict[str, str]) -> None:
    """Take the handshake's ``info``, the license, release and every Engine reading on a new connection.

    Then the forms, File and capability. A connection that ended while the release lookup was awaited keeps nothing
    read on it, and the fill stops there.
    """
    license_ = await client.get_license()
    fields = await _fast(client)
    fields.update(await _slow(client))
    fields["license"] = license_
    fields["info"] = info
    fields["release"] = None
    await _read_release(mgr, fields)
    if not still_stands(mgr.control, client):
        return
    _take(mgr, fields)
    await _configuration(mgr, cadence)
    await engineread.refresh_device_caps(mgr, force=True)


async def _read_release(mgr: ConnectionManager, fields: EngineFields) -> None:
    """Write the installed release off the ungated ``/about`` page into ``fields`` once the page answers.

    Best-effort: the connection already stands, so a failed lookup fails nothing and leaves the release not read.
    """
    try:
        page = await release.fetch_about(mgr.cfg.hqp_http_base_url)
    except httpx.HTTPError as exc:
        log.debug("release lookup failed: %s", exc)
    else:
        fields["release"] = release.parse_release(page) or None


async def _beat(mgr: ConnectionManager, client: ControlClient, cadence: Cadence) -> None:
    """Re-read State and Status; on the poll cadence or a mode move, the enumerations and the forms too."""
    before_state = mgr.readings.state
    before_mode = (before_state or {}).get("mode")
    before_chain = active_chain(mgr)
    fields = await _fast(client)
    now = mgr.clock.monotonic()
    due = poll_due(now, cadence.polled_at, mgr.cfg.poll_interval)
    after_mode = (fields.get("state") or {}).get("mode")
    moved = mode_moved(before_mode, after_mode)
    if moved:
        log.info("engine moved (mode %s), re-enumerating", after_mode)
    if due or moved:
        fields.update(await _slow(client))
    if not still_stands(mgr.control, client):
        return
    _take(mgr, fields)
    _trace_volume(mgr, before_state)
    await lane.chain_entered(mgr, client, before_chain, reenumerated=due or moved)
    if due:
        cadence.polled_at = now
        await _configuration(mgr, cadence)


async def _fast(client: ControlClient) -> EngineFields:
    """Read State and Status with its track metadata, leaving State out when HQPlayer refuses the read."""
    status, metadata = await client.get_status()
    fields: EngineFields = {"status": status, "status_metadata": metadata}
    state = await client.state_unless_refused()
    if state is not None:
        fields["state"] = state
    return fields


async def _slow(client: ControlClient) -> EngineFields:
    """Read the enumerations, with the matrix profiles, the volume range and the active configuration."""
    return {
        "enums": await client.get_all_enumerations(),
        "matrix_profiles": await _matrix_profiles(client),
        "volume_range": await client.get_volume_range(),
        "active_config": await client.get_active_config(),
    }


async def _matrix_profiles(client: ControlClient) -> list[str] | None:
    """Read the saved matrix profiles, or None from an engine that does not speak Matrix*."""
    with contextlib.suppress(CommandError):
        return await client.get_matrix_profiles()
    return None


def _take(mgr: ConnectionManager, fields: EngineFields) -> None:
    """Take one Engine reading, stamped with the generation the connection stands in."""
    mgr.readings.take_engine(mgr.phase.standing.generation, **fields)


def _trace_volume(mgr: ConnectionManager, before: dict[str, str] | None) -> None:
    """Record State's volume to the trace when this heartbeat's reading moved it from ``before``."""
    now = mgr.readings.state or {}
    was = before or {}
    voltrace.observe_change(mgr, "state", {"volume": now.get("volume")}, {"volume": was.get("volume")})


async def _configuration(mgr: ConnectionManager, cadence: Cadence) -> None:
    """Run one pass of the configuration lane: the forms, the archive while this connection owes it, the fact."""
    forms_fact = form_fact((await forms.refresh(mgr)).outcome)
    if archive_owed(forms_fact, archive_read=cadence.archive_read):
        await _load_backup(mgr, cadence)
    fact = lane_fact(forms_fact, archive_read=cadence.archive_read)
    if fact is not None:
        mgr.phase.report(fact, mgr.clock.monotonic())


async def _load_backup(mgr: ConnectionManager, cadence: Cadence) -> None:
    """Fetch the settings archive once, read the File's config from it and hand it to the one-time preset import.

    The archive counts as read on this connection only once the File's config is read from it. One that does not
    arrive, or arrives as no readable archive, is logged with its error, leaves the File not read, feeds no import
    and stays owed; the connection stands either way.
    """
    try:
        backup = await mgr.require_http().backup()
        await fileconfig.load_file_config(mgr, backup=backup)
    except (httpx.HTTPError, engineconf.UnreadableArchiveError) as exc:
        log.warning("file config read failed: %s", exc)
    else:
        await _migrate(mgr, backup)
        cadence.archive_read = True


async def _migrate(mgr: ConnectionManager, backup: bytes) -> None:
    """Hand an archive already read to the one-time preset import, logging a failure rather than raising it."""
    try:
        await presetlane.migrate_once(mgr, mgr.readings.active_config, backup=backup)
    except (PresetError, OSError, zipfile.BadZipFile) as exc:
        # presetzip.snapshot_members opens the archive itself with no empty-bytes fallback, so a corrupt archive
        # raises BadZipFile here.
        log.warning("preset migration skipped: %s", exc)


async def _lost(mgr: ConnectionManager, fact: Fact) -> None:
    """Drop the connection a control read ended: the readings break first, then ``fact`` is reported."""
    client, mgr.control = mgr.control, None
    if client is not None:
        await client.close()
    mgr.readings.break_engine()
    mgr.phase.report(fact, mgr.clock.monotonic())


async def _closed_on_fault(mgr: ConnectionManager) -> None:
    """Close the connection a fault of HQPTuner's own ended: the socket closes, the readings break, a taken Down."""
    client, mgr.control = mgr.control, None
    if client is None:
        return
    await client.close()
    mgr.readings.break_engine()
    mgr.phase.report(Fact.SOCKET_CLOSED, mgr.clock.monotonic())


async def _hang_up(mgr: ConnectionManager) -> None:
    """Close the connection on the way out; HQPTuner closing it is no departure and reports nothing."""
    client, mgr.control = mgr.control, None
    if client is not None:
        await client.close()
