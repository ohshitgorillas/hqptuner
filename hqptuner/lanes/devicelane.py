"""Device reads and the device re-scan — the output device's capability, the log tail, the rescan.

Split out of ``manager`` on size alone; the behaviour is unchanged. It sits with
the lanes because it is the same shape as they are: functions over the manager
that own one slice of the daemon conversation, here the device side of the 8088
lane — the two reads that cost a whole ``GET /log`` and the re-scan that rebuilds
the endpoint list they read against.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx

from hqptuner.engine import devicecaps, logtail
from hqptuner.lanes import rescan

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

# How long to wait before looking for a device announcement that was not there
# last time (``refresh_caps``). Long, because the reader is a full log fetch and
# the announcement only appears when the daemon opens the device.
_CAPS_RETRY = 30.0


async def refresh_caps(mgr: ConnectionManager, *, force: bool = False) -> None:
    """Re-learn what the selected output device can carry (engine/devicecaps).

    Reading it costs a whole ``GET /log``, so this is deliberately not a
    per-poll job: the announcement only moves when the daemon opens a device,
    which is a connect. The log is fetched when the selection changed, on
    connect (``force``), and — while the selection has no announcement yet —
    no more often than ``_CAPS_RETRY``, since that announcement may simply not
    have been written when we last looked.

    It is read for whichever device the config form says is selected, so it belongs
    wherever that form is refreshed — the poll loop, connect, and the rescan route
    alike (``manager.refresh_http_forms``) — rather than at the poll loop alone, which
    leaves every other path serving a stale answer or none.

    Which device that is comes from both config views agreeing on it
    (devicecaps.agreed_device): the form and the file refresh separately, and
    while they disagree there is no capability to serve. Disagreement caches
    as ``None``, so the refresh that ends it sees a different selection and
    re-reads at once rather than sitting out ``_CAPS_RETRY``.
    """
    selected = devicecaps.agreed_device(mgr.config_form, mgr.file_config)
    stale = mgr.device_caps is None and mgr.monotonic() - mgr.caps_at >= _CAPS_RETRY
    if not force and not stale and selected == mgr.caps_device:
        return
    mgr.caps_device, mgr.caps_at = selected, mgr.monotonic()
    if selected is None:
        mgr.device_caps = None
        return
    try:
        text = await logtail.fetch_log(mgr.http_base_url)
    except httpx.HTTPError as exc:
        # No log, no capability, no narrowing — the menus stay whole, which is
        # the correct answer to "the device has not told us anything".
        log.debug("device capability read failed: %s", exc)
        mgr.device_caps = None
        return
    mgr.device_caps = devicecaps.caps_for(text, selected)


async def read_log_tail(mgr: ConnectionManager, lines: int = 50) -> dict[str, Any]:
    """Return a static tail of the daemon's log for the System-tab live view.

    Not a stream — a fresh GET /log per call over the 8088 web interface, so it works regardless
    of the daemon's `<log file>` setting and needs no host mount. Reports `available` false (with
    a reason) when /log can't be read.
    """
    path, enabled = logtail.log_file_field(mgr.config_form)
    try:
        text = await logtail.fetch_log(mgr.http_base_url)
    except httpx.HTTPError as exc:
        return {"path": path, "enabled": enabled, "available": False, "reason": str(exc), "lines": []}
    return {"path": path, "enabled": enabled, "available": True, "lines": logtail.tail_text(text, lines)}


async def refresh_devices(mgr: ConnectionManager) -> dict[str, Any]:
    """Trigger a daemon output-device re-scan, then refetch the /config and /matrix forms.

    The refetch makes the device dropdowns serve the new endpoint list (an NAA powered back on,
    a DAC replugged).

    The rescan stops the engine, and the engine comes back on the config file —
    which never learned a live-routed setting. With auto-save on, what it was
    running is read first and put back afterwards (``lanes/rescan``): ``restored``
    names what landed, and a ``warning`` says so when the replay could not run.
    No idle gate: interrupting playback is the user's call to spend (CLAUDE.md).
    """
    snap = rescan.snapshot(mgr)
    await mgr.require_http().refresh_devices()
    await mgr.refresh_http_forms()
    return {"refreshed": True, **await rescan.replay(mgr, snap)}
