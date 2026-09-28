"""Speaker-processing apply (readme §1.9, /speakers form lane) — the lane behind ``POST /api/speakers``.

The overlay + checkbox-safe write + range validation live in
``httpconf.apply_speakers``; here we ride out the ~3 s engine reload the form POST
triggers, readback-verify past the transient, and refresh the cached form. The API
refuses nothing for it (the reload interrupts playback).
"""

import contextlib
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

import httpx

from hqptuner.conf.httpforms import SpeakersForm
from hqptuner.lanes import settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

_POLL = 1.0  # cadence for polling /speakers back after the reload


class SpeakerApplyOutcome(Enum):
    """Whether a speaker-processing write was confirmed past the engine reload it triggers."""

    CONFIRMED = "confirmed"
    UNCONFIRMED = "unconfirmed"


@dataclass(frozen=True)
class SpeakerApplyResult:
    """A speaker-processing apply's confirmation, alongside the re-read (or last-cached) form. Fields are wire keys."""

    applied: bool
    speakers: SpeakersForm | None

    @property
    def outcome(self) -> SpeakerApplyOutcome:
        """The verdict as an enum, for callers that branch on it."""
        return SpeakerApplyOutcome.CONFIRMED if self.applied else SpeakerApplyOutcome.UNCONFIRMED


async def apply(mgr: "ConnectionManager", channels: dict[str, dict[str, str]], *, enabled: bool) -> SpeakerApplyResult:
    """POST the speaker-processing form, then confirm it landed past the engine reload the POST triggers.

    Returns the confirmation flag alongside the re-read form, which is also refreshed onto the manager's cache; a
    read that fails after a confirmed write leaves the previous cache standing rather than failing the apply.
    """
    http = mgr.require_http()
    await http.apply_speakers(channels, enabled=enabled)
    applied = await _verify(mgr, channels, enabled=enabled)
    with contextlib.suppress(httpx.HTTPError):
        mgr.readings.speakers_form = await http.get_speakers()
    return SpeakerApplyResult(applied, mgr.readings.speakers_form)


async def _verify(mgr: "ConnectionManager", channels: dict[str, dict[str, str]], *, enabled: bool) -> bool:
    """Poll /speakers until it reflects the applied state — the enabled flag plus each written level/distance.

    Rides past the post-reload window where the lane 502s or serves the pre-restart
    form. Gives up at the alarm deadline and reports honestly rather than claiming a
    success it did not confirm.
    """

    async def probe() -> bool:
        form = await mgr.require_http().get_speakers()
        rows = form.get("channels", [])
        return form.get("enabled") == enabled and all(
            int(idx) < len(rows) and float(seen if (seen := rows[int(idx)].get(k)) is not None else "nan") == float(v)
            for idx, ch in channels.items()
            for k, v in ch.items()
        )

    return bool(await settle.poll_until(mgr, probe, interval=_POLL))
