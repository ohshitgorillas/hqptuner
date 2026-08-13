"""Device-side reads and the device re-scan for the connection manager.

The output device's capability announcement, the daemon's log tail, and the re-scan
that rebuilds the endpoint list those reads run against — all over the 8088 lane.
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

# How long to wait before looking again for a device announcement that was not there
# last time. Long, because the reader is a full log fetch.
_CAPS_RETRY = 30.0


async def refresh_caps(mgr: ConnectionManager, *, force: bool = False) -> None:
    """Re-learn what the selected output device can carry (engine/devicecaps).

    Reading it costs a whole ``GET /log``, so it is not a per-poll job: the announcement only moves
    when the daemon opens a device. The log is fetched when the selection changed, on connect
    (``force``), and — while the selection has no announcement yet — no more often than
    ``_CAPS_RETRY``. The selection tracks the config form, so this refreshes wherever that form does
    (``manager.refresh_http_forms``) rather than at the poll loop alone.

    The selected device is the one both config views agree on (``devicecaps.agreed_device``); while
    they disagree there is no capability to serve, and that caches as ``None`` so the refresh ending
    the disagreement re-reads at once instead of sitting out ``_CAPS_RETRY``.
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

    A fresh ``GET /log`` over the 8088 web interface per call, not a stream, so it works regardless
    of the daemon's ``<log file>`` setting and needs no host mount. ``available`` is false, with a
    ``reason``, when ``/log`` cannot be read.
    """
    path, enabled = logtail.log_file_field(mgr.config_form)
    try:
        text = await logtail.fetch_log(mgr.http_base_url)
    except httpx.HTTPError as exc:
        return {"path": path, "enabled": enabled, "available": False, "reason": str(exc), "lines": []}
    return {"path": path, "enabled": enabled, "available": True, "lines": logtail.tail_text(text, lines)}


async def refresh_devices(mgr: ConnectionManager) -> dict[str, Any]:
    """Trigger a daemon output-device re-scan, then refetch the /config and /matrix forms.

    The refetch makes the device dropdowns serve the new endpoint list. The rescan stops the engine,
    and the engine comes back on the config file, which never learned a live-routed setting: with
    auto-save on, ``lanes/rescan`` reads what was running first and puts it back, reporting
    ``restored`` and a ``warning`` when the replay could not run.
    """
    snap = rescan.snapshot(mgr)
    await mgr.require_http().refresh_devices()
    await mgr.refresh_http_forms()
    return {"refreshed": True, **await rescan.replay(mgr, snap)}
