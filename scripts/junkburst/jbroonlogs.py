"""The RoonServer logs as playback segments: what Roon loaded, what it played, and when each run of play broke.

Three log line kinds carry everything the logs can give. ``[HQPlayer] [zoneplayer] Playing: <path>`` names the file
Roon handed to HQPlayer, and for a local file the album is that path's parent directory with a leading ``YYYY. ``
removed. ``[PLAYING @ m:ss/m:ss] <title> - <artist>`` carries the title, the artist and an elapsed position truncated
to whole seconds. ``State transition WaitForFirstTimeChange => Playing`` marks the moment audio starts, which is also
how a seek inside one track shows up.

A segment is a run of position samples with no load and no resume in it. Log timestamps carry no year and no zone:
they are read as ``LOG_YEAR`` in ``America/Los_Angeles`` and written as UTC.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

#: The RoonServer log directory, its wall-clock zone, and the year its lines leave off.
LOG_DIR = Path("/srv/roon/config/database/RoonServer/Logs")
LOG_TZ = ZoneInfo("America/Los_Angeles")
LOG_YEAR = 2026

_LINE = re.compile(r"^(\d\d)/(\d\d) (\d\d):(\d\d):(\d\d) \w+: (.*)$")
_POS = re.compile(r"^\[HQPlayer\] \[[^]]*\] \[[^]]*\] \[(PLAYING|LOADING) @ ([\d:]+)(?:/([\d:]+))?\] (.*)$")
_LOAD = re.compile(r"^\[HQPlayer\] \[zoneplayer\] Playing: (.*)$")
_RESUME = "[zoneplayer/hqplayer] State transition WaitForFirstTimeChange => Playing"
_ALBUM_YEAR = re.compile(r"^\d{4}\. ")


def _clock(hhmmss: str) -> int:
    """Return the seconds carried by a ``m:ss`` or ``h:mm:ss`` position."""
    total = 0
    for part in hhmmss.split(":"):
        total = total * 60 + int(part)
    return total


@dataclass
class Segment:
    """One run of playback with no load and no resume inside it."""

    began: datetime
    path: str
    title: str
    artist: str
    samples: list[tuple[datetime, int]] = field(default_factory=list)

    @property
    def local(self) -> bool:
        """Say whether this segment plays a local file rather than a stream."""
        return bool(self.path) and "://" not in self.path

    @property
    def album(self) -> str:
        """Return the album directory of a local segment's file, or empty for a stream or an off-convention folder."""
        if not self.local:
            return ""
        # The library lays albums out as ``<artist>/YYYY. <album>/``. A folder that does not carry the year is a
        # download folder named after the release, not the album, so it is left to the two lookups.
        name = Path(self.path).parent.name
        return _ALBUM_YEAR.sub("", name) if _ALBUM_YEAR.match(name) else ""

    @property
    def last(self) -> datetime:
        """Return the segment's last position sample, or the moment it began."""
        return self.samples[-1][0] if self.samples else self.began

    def start(self, at: datetime) -> datetime | None:
        """Return the virtual track start read off the position sample nearest ``at``."""
        if not self.samples:
            return None
        when, pos = min(self.samples, key=lambda s: abs((s[0] - at).total_seconds()))
        return when - timedelta(seconds=pos)


@dataclass
class Logs:
    """Every segment the logs hold, with the load and resume times that bound them."""

    segments: list[Segment] = field(default_factory=list)
    breaks: list[datetime] = field(default_factory=list)


def _when(head: re.Match[str]) -> datetime:
    """Return the UTC instant of a matched log line head."""
    month, day, hour, minute, second = (int(head.group(i)) for i in range(1, 6))
    return datetime(LOG_YEAR, month, day, hour, minute, second, tzinfo=LOG_TZ).astimezone(UTC)


def _parse_line(rest: str, when: datetime, state: dict[str, Any], out: Logs) -> None:
    """Fold one already-timestamped log line into the segments being built."""
    load = _LOAD.match(rest)
    if load is not None or rest == _RESUME:
        state["path"] = load.group(1) if load is not None else state.get("path", "")
        state["pending"] = True
        state["loaded"] = load is not None
        out.breaks.append(when)
        return
    pos = _POS.match(rest)
    if pos is None:
        return
    kind, at, _total, name = pos.groups()
    if kind == "LOADING":
        return
    title, _, artist = name.rpartition(" - ")
    if not title:
        title, artist = artist, ""
    if state.get("pending") or not out.segments or out.segments[-1].title != title:
        # A segment opened without a load of its own has no file behind it, so it carries no album.
        path = state.get("path", "") if state.get("loaded") else ""
        out.segments.append(Segment(when, path, title, artist))
        state["pending"] = False
    out.segments[-1].samples.append((when, _clock(at)))


def read_logs(log_dir: Path = LOG_DIR) -> Logs:
    """Read every ``RoonServer_log*.txt`` in time order and return its segments and its break times."""
    dated: list[tuple[datetime, Path]] = []
    for path in sorted(log_dir.glob("RoonServer_log*.txt")):
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                head = _LINE.match(line)
                if head is not None:
                    dated.append((_when(head), path))
                    break
    out = Logs()
    state: dict[str, Any] = {}
    for _first, path in sorted(dated):
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                head = _LINE.match(line.rstrip("\n"))
                if head is not None:
                    _parse_line(head.group(6), _when(head), state, out)
    out.breaks.sort()
    return out
