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
    hqp_username: str = field(default_factory=lambda: _env("HQP_USERNAME", ""))
    hqp_password: str = field(default_factory=lambda: _env("HQP_PASSWORD", ""))
    listen_host: str = field(default_factory=lambda: _env("LISTEN_HOST", "127.0.0.1"))
    listen_port: int = field(default_factory=lambda: int(_env("LISTEN_PORT", "8090")))
    poll_interval: float = field(default_factory=lambda: float(_env("POLL_INTERVAL", "2.0")))
    alarm_threshold: float = field(default_factory=lambda: float(_env("ALARM_THRESHOLD", "15.0")))
    request_timeout: float = field(default_factory=lambda: float(_env("REQUEST_TIMEOUT", "5.0")))
    data_dir: Path = field(
        default_factory=lambda: Path(
            _env("DATA_DIR", str(Path(__file__).resolve().parent.parent / "data"))
        )
    )
