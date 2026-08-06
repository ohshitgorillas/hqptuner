"""Speaker-processing apply (readme §1.9, /speakers form lane) — the logic behind
``manager.apply_speakers``.

The overlay + checkbox-safe write + range validation live in
``httpconf.apply_speakers``; here we ride out the ~3 s engine reload the form POST
triggers, readback-verify past the transient, and refresh the cached form. The API
refuses nothing for it (the reload interrupts playback)."""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING, Any

import httpx

from hqptuner.lanes import settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

_POLL = 1.0  # cadence for polling /speakers back after the reload


async def apply(mgr: ConnectionManager, channels: dict[str, dict[str, str]], *, enabled: bool) -> dict[str, Any]:
    http = mgr.require_http()
    await http.apply_speakers(channels, enabled=enabled)
    applied = await _verify(mgr, channels, enabled=enabled)
    with contextlib.suppress(httpx.HTTPError):
        mgr.speakers_form = await http.get_speakers()
    return {"applied": applied, "speakers": mgr.speakers_form}


async def _verify(mgr: ConnectionManager, channels: dict[str, dict[str, str]], *, enabled: bool) -> bool:
    """Poll /speakers until it reflects the applied state (enabled flag + each
    written level/distance), riding past the post-reload window where the lane
    502s or serves the pre-restart form. Gives up at the alarm deadline and reports
    honestly rather than claiming a success it did not confirm."""

    async def probe() -> bool:
        form = await mgr.require_http().get_speakers()
        rows = form.get("channels", [])
        return form.get("enabled") == enabled and all(
            int(idx) < len(rows) and float(rows[int(idx)].get(k, "nan")) == float(v)
            for idx, ch in channels.items()
            for k, v in ch.items()
        )

    return bool(await settle.poll_until(mgr, probe, interval=_POLL))
