"""Preset lifecycle: the lane the daemon is driven through, the operations over it, and the naming rule they share."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hqptuner.lanes import LaneManager, LaneReadings

if TYPE_CHECKING:
    from hqptuner.config import Config
    from hqptuner.presets.presetops import PresetOps


class PresetReadings(LaneReadings, Protocol):
    """The readings the preset lifecycle reads and refills: everything a lane does, plus the engine attributes."""

    engine: dict[str, str] | None


class PresetManager(LaneManager, Protocol):
    """The manager as the preset lifecycle drives it: everything a lane reaches, plus the preset collaborator."""

    @property
    def readings(self) -> PresetReadings:
        """Return what the daemon last told us."""

    @property
    def cfg(self) -> Config:
        """Return the configuration the manager was built from."""

    @property
    def presetops(self) -> PresetOps:
        """Return the preset store, filter park and backup persistence."""
