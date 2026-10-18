"""The live lane's record of what it wrote."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager


@dataclass
class LiveMemory:
    """What the live lane remembers per chain."""

    chain: dict[str, dict[str, str]] = field(default_factory=dict)

    def confirm(self, edits: object, report: object, resolved_against: object) -> None:
        """Record what a batch landed as."""


def engine_view(mgr: LaneManager) -> object | None:
    """Return the engine's view of the chain."""
    del mgr
    return None
