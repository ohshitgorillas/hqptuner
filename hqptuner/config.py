"""Runtime configuration from environment (HQPTUNER_* variables)."""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(f"HQPTUNER_{name}", default)


@dataclass
class Config:
    hqp_host: str = field(default_factory=lambda: _env("HQP_HOST", "127.0.0.1"))
    hqp_control_port: int = field(default_factory=lambda: int(_env("HQP_CONTROL_PORT", "4321")))
    hqp_http_port: int = field(default_factory=lambda: int(_env("HQP_HTTP_PORT", "8088")))
    # hqplayerd's stock management credentials (Signalyst embedded-install docs) —
    # override only if the daemon's auth was re-provisioned.
    hqp_username: str = field(default_factory=lambda: _env("HQP_USERNAME", "hqplayer"))
    hqp_password: str = field(default_factory=lambda: _env("HQP_PASSWORD", "password"))
    listen_host: str = field(default_factory=lambda: _env("LISTEN_HOST", "127.0.0.1"))
    listen_port: int = field(default_factory=lambda: int(_env("LISTEN_PORT", "8090")))
    poll_interval: float = field(default_factory=lambda: float(_env("POLL_INTERVAL", "2.0")))
    alarm_threshold: float = field(default_factory=lambda: float(_env("ALARM_THRESHOLD", "15.0")))
    request_timeout: float = field(default_factory=lambda: float(_env("REQUEST_TIMEOUT", "5.0")))
    data_dir: Path = field(
        default_factory=lambda: Path(_env("DATA_DIR", str(Path(__file__).resolve().parent.parent / "data")))
    )
    backup_dir: Path = field(
        default_factory=lambda: Path(_env("BACKUP_DIR", str(Path(__file__).resolve().parent.parent / "backups")))
    )
    # HQPTuner-owned preset store (see presetstore) — full-config XML snapshots we
    # manage ourselves instead of hqplayerd's unreliable named-profile subsystem.
    preset_dir: Path = field(
        default_factory=lambda: Path(_env("PRESET_DIR", str(Path(__file__).resolve().parent.parent / "presets")))
    )
    # hqplayerd's data/home directory on the daemon host — where a /backup
    # archive's data/ members land on restore, and the absolute-path prefix a
    # pipeline `process` attribute uses for uploaded filter impulse files
    # (probe-verified on 6.0.4: data/impulse_0-0.wav <-> /var/lib/hqplayer/home/…).
    # Overridable for non-standard installs.
    hqp_home: str = field(default_factory=lambda: _env("HQP_HOME", "/var/lib/hqplayer/home"))
