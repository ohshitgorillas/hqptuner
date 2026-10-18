"""What the daemon last told us, as one plain record."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from hqptuner.lanes.live.memory import LiveMemory

if TYPE_CHECKING:
    from hqptuner.conf.httpforms import ConfigForm, MatrixForm, SpeakersForm
    from hqptuner.engine.devicecaps import DeviceCaps


@dataclass
class Readings:
    """Every snapshot the manager holds, empty until a lane fills it."""

    state: dict[str, str] | None = None
    status: dict[str, str] | None = None
    enums: dict[str, list[dict[str, str]]] | None = None
    active_config: str | None = None
    file_config: dict[str, str] | None = None
    config_form: ConfigForm | None = None
    matrix_form: MatrixForm | None = None
    speakers_form: SpeakersForm | None = None
    config_error: str | None = None
    matrix_error: str | None = None
    speakers_error: str | None = None
    credentials_ok: bool | None = None
    engine: dict[str, str] | None = None
    matrix_profiles: list[str] | None = None
    volume_range: dict[str, str] | None = None
    device_caps: DeviceCaps | None = None
    caps_device: str | None = None
    caps_at: float = 0.0
    caps_misses: int = 0
    last_volume_write: str | None = None
    live: LiveMemory = field(default_factory=LiveMemory)
