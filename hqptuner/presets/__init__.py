"""Preset lifecycle: the lane the daemon is driven through, the operations over it, and the naming rule they share."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hqptuner.lanes import LaneManager, LaneReadings

if TYPE_CHECKING:
    from hqptuner.config import Config
    from hqptuner.presets.presetops import PresetOps


class PresetReadings(LaneReadings, Protocol):
    """The readings the preset lifecycle reads and refills: a lane's, plus the engine attributes and matrix profiles."""

    engine: dict[str, str] | None
    matrix_profiles: list[str] | None


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
