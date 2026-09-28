"""hqplayerd track context: the advisor's view of the engine's current track.

Building it reads only the manager's last poll and is independent of the 4322 socket.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.engine.controlerrors import ControlError

#: the module's public surface
__all__ = ["PLAYING", "TrackContext", "UnparseableStatusAttributeError", "context_from"]

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

PLAYING = 2


class UnparseableStatusAttributeError(ControlError):
    """State's ``state`` or Status's ``samplerate`` would not parse as the integer the wire format promises."""

    def __init__(self, *, error: ValueError) -> None:
        """Render the wording naming the underlying ``ValueError`` from the failed conversion."""
        super().__init__(f"unparseable status attribute: {error}")


@dataclass(frozen=True)
class TrackContext:
    """What the advisor needs to know about the engine's current track."""

    playing: bool
    samplerate: int | None
    sdm: bool
    junk_filter: str | None
    filter: str | None = None  # active main filter's display name


def context_from(manager: "ConnectionManager") -> TrackContext | None:
    """Return the reader's view of the manager's last poll — None while unreachable.

    Raises ``ControlError`` where State's ``state`` or Status's ``samplerate`` will not parse: the daemon answered
    unparseably, and what to do about that is the caller's decision, not a silent fallback here.
    """
    status = manager.readings.status
    if not manager.reachable or status is None:
        return None
    meta = manager.readings.status_metadata or {}
    rate = meta.get("samplerate")
    state = status.get("state")
    try:
        playing = state is not None and _int(state) == PLAYING
        samplerate = _int(rate) if rate else None
    except ValueError as exc:
        raise UnparseableStatusAttributeError(error=exc) from exc
    return TrackContext(
        playing=playing,
        samplerate=samplerate,
        sdm=meta.get("sdm") in ("1", "true"),
        junk_filter=_junk_filter_name(manager.readings.state or {}, manager.readings.enums),
        filter=status.get("active_filter") or None,
    )


def _junk_filter_name(state: dict[str, str], enums: dict[str, list[dict[str, str]]] | None) -> str | None:
    """``State.filter_junk`` joined against the running enumeration.

    The engine is the sole authority for index→name (architecture §3.1).

    Read off State, whose attribute table lists it unconditionally; Status's is documented as a superset
    (`protocol.md` §6). A frame that does not carry it would read as nothing engaged, which is the one answer that
    must not be guessed: it decides whether the advisor's note goes quiet and what auto-pilot falls back to.
    """
    idx = state.get("filter_junk")
    for item in (enums or {}).get("junk_filters", []):
        if item.get("index") == idx:
            return item.get("name")
    return None


def _int(value: str) -> int:
    """Parse one decimal wire attribute; raises ``ValueError`` on anything that is not cleanly one.

    Malformed is the caller's decision, not this function's: ``context_from`` decides what an unparseable ``state``
    or ``samplerate`` reads as.
    """
    return int(value)
