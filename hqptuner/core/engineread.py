"""Engine answers read on demand, off the poll loop's back.

Each costs what the poll loop cannot afford every interval — a whole ``GET /log``, or a
~5 MB backup archive — so it is fetched when a caller needs it and cached in ``readings``.
"""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from hqptuner.core.readings import Readings
from hqptuner.engine import devicecaps, logtail
from hqptuner.lanes import rescan

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

# How long to wait before looking for a device announcement that was not there
# last time (refresh_device_caps). Long, because the reader is a full log fetch
# and the announcement only appears when the daemon opens the device.
CAPS_RETRY = 30.0
# How many reads in a row may find no announcement for the selected device
# before refresh_device_caps stops looking, until the selection changes or a
# connect forces a read: a device that never announces itself would otherwise
# cost a whole log fetch every CAPS_RETRY for as long as it stays selected.
CAPS_MISSES = 5
# How old a held log text may be and still answer a log-tail read: under the
# System tab's 3 s poll (LogTail.js POLL_MS), so one tab still sees every poll
# fresh while several tabs polling together cost one fetch.
LOG_MAX_AGE = 2.5


async def refresh_device_caps(mgr: "ConnectionManager", *, force: bool = False) -> None:
    """Re-learn what the selected output device can carry (engine/devicecaps).

    Reading it costs a whole ``GET /log``, so this is deliberately not a
    per-poll job: the announcement only moves when the daemon opens a device,
    which is a connect. The log is fetched when the selection changed, on
    connect (``force``), and — while the selection has no announcement yet —
    no more often than ``CAPS_RETRY``, since that announcement may simply not
    have been written when we last looked. After ``CAPS_MISSES`` reads in a row
    without one it stops looking until the selection changes or a connect
    forces a read, either of which starts the count again.

    Which device that is comes from both config views agreeing on it
    (devicecaps.agreed_device): the form and the file refresh separately, and
    while they disagree there is no capability to serve. Disagreement caches
    as ``None``, so the refresh that ends it sees a different selection and
    re-reads at once rather than sitting out ``CAPS_RETRY``.

    The read goes through the manager's shared log reader: a forced read always
    fetches, any other takes a text a log-tail read fetched under ``LOG_MAX_AGE`` ago.
    """
    readings = mgr.readings
    selected = devicecaps.agreed_device(readings.config_form, readings.file_config)
    if force or selected != readings.caps_device:
        readings.caps_misses = 0
    elif not _caps_retry_due(readings, mgr.clock.monotonic()):
        return
    readings.caps_device, readings.caps_at = selected, mgr.clock.monotonic()
    if selected is None:
        readings.device_caps = None
        return
    caps = None
    try:
        text = await mgr.log_reader.read(mgr.cfg.hqp_host, mgr.cfg.hqp_http_port, 0.0 if force else LOG_MAX_AGE)
    except httpx.HTTPError as exc:
        # No log, no capability, no narrowing — the menus stay whole, which is
        # the correct answer to "the device has not told us anything".
        log.debug("device capability read failed: %s", exc)
    else:
        caps = devicecaps.caps_for(text, selected)
    readings.device_caps = caps
    if caps is None:
        readings.caps_misses += 1


def _caps_retry_due(readings: Readings, now: float) -> bool:
    """Answer whether an unmoved selection with no announcement has waited out ``CAPS_RETRY`` and has misses left."""
    return readings.device_caps is None and readings.caps_misses < CAPS_MISSES and now - readings.caps_at >= CAPS_RETRY


@dataclass(frozen=True)
class LogTail:
    """A log-tail read: the daemon's configured log file, whether it logs to it, and the last lines. Wire keys."""

    path: str | None
    enabled: bool
    lines: list[str]


@dataclass(frozen=True)
class RescanReport:
    """A device rescan's answer: what the replay put back, and how the replay came out."""

    restored: dict[str, str]
    replay: rescan.ReplayOutcome


async def read_log_tail(mgr: "ConnectionManager", lines: int = 50) -> LogTail:
    """Return a static tail of the daemon's log for the System-tab live view.

    Not a stream — GET /log over the 8088 web interface, so it works regardless of the daemon's
    `<log file>` setting and needs no host mount. Read through the manager's shared log reader, so
    every caller inside ``LOG_MAX_AGE`` of the last fetch is served that fetch's text and several
    polling browser tabs cost one GET. A daemon that cannot be reached, or answers with an error
    status, raises ``httpx.HTTPError``: a failed read, not an absent log.
    """
    path, enabled = logtail.log_file_field(mgr.readings.config_form)
    text = await mgr.log_reader.read(mgr.cfg.hqp_host, mgr.cfg.hqp_http_port, LOG_MAX_AGE)
    return LogTail(path, enabled, logtail.tail_text(text, lines))


async def refresh_devices(mgr: "ConnectionManager") -> RescanReport:
    """Trigger a daemon output-device re-scan, then refetch the /config and /matrix forms.

    The refetch makes the device dropdowns serve the new endpoint list (an NAA powered back on,
    a DAC replugged).

    The rescan stops the engine, and the engine comes back on the config file —
    which never learned a live-routed setting. With auto-save on, what it was
    running is read first and put back afterwards (``lanes/rescan``): ``restored``
    names what landed, and ``replay`` says whether the replay put everything back.
    No idle gate: interrupting playback is the user's call to spend (CLAUDE.md).
    """
    snap = rescan.snapshot(mgr)
    await mgr.require_http().refresh_devices()
    await mgr.refresh_http_forms()
    replayed = await rescan.replay(mgr, snap)
    return RescanReport(restored=replayed.restored, replay=replayed.outcome)


def current_mode_name(mgr: "ConnectionManager") -> str:
    """Return the name the engine's mode enumeration gives State's mode index, or "" if either is missing."""
    readings = mgr.readings
    if not readings.state or not readings.enums:
        return ""
    idx = readings.state.get("mode", "")
    for item in readings.enums.get("modes", []):
        if item.get("index") == idx:
            return item.get("name", "")
    return ""
