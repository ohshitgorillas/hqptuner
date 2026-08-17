"""Runtime configuration from environment (HQPTUNER_* variables)."""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(f"HQPTUNER_{name}", default)


def _env_flag(name: str, default: str) -> bool:
    """Read an on/off var, spelled the way an operator would spell it in a compose file."""
    return _env(name, default).strip().lower() not in ("0", "false", "no", "off")


def _optional_path(name: str) -> Path | None:
    """Read a path var that is OFF when unset.

    An empty value is not a path to the current directory, it is the absence of one.
    """
    raw = _env(name, "").strip()
    return Path(raw) if raw else None


@dataclass
class Config:
    """Every runtime knob, each field reading its own ``HQPTUNER_*`` variable at construction.

    Constructing it with no arguments is the normal path: an unset variable leaves the field at the default
    below, so a bare ``Config()`` is a complete, working configuration.
    """

    hqp_host: str = field(default_factory=lambda: _env("HQP_HOST", "127.0.0.1"))
    hqp_control_port: int = field(default_factory=lambda: int(_env("HQP_CONTROL_PORT", "4321")))
    hqp_http_port: int = field(default_factory=lambda: int(_env("HQP_HTTP_PORT", "8088")))
    # metering side channel (protocol.md §7) — control port + 1 on a stock daemon
    hqp_metering_port: int = field(default_factory=lambda: int(_env("HQP_METERING_PORT", "4322")))
    # Whether the junk-filter advisor's metering reader runs at all. Off means the
    # reader is never constructed, nothing connects to 4322, and the advisor's
    # recommendation is permanently null — the rest of HQPTuner is unaffected.
    metering_enabled: bool = field(default_factory=lambda: _env_flag("METERING_ENABLED", "1"))
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
        default_factory=lambda: Path(_env("DATA_DIR", str(Path(__file__).resolve().parent / "data")))
    )
    backup_dir: Path = field(
        default_factory=lambda: Path(_env("BACKUP_DIR", str(Path(__file__).resolve().parent.parent / "backups")))
    )
    # HQPTuner-owned preset store (see presets/store/presets.py) — full-config XML snapshots we
    # manage ourselves instead of hqplayerd's unreliable named-profile subsystem.
    preset_dir: Path = field(
        default_factory=lambda: Path(_env("PRESET_DIR", str(Path(__file__).resolve().parent.parent / "presets")))
    )
    # The LIVE view's named live presets (see presets/store/live.py) — one JSON file, not a
    # directory, because a live preset is a handful of enum IDs rather than a
    # config snapshot. Defaults beside the dev container's bind-mounted state dir
    # so a host run and the dev container read the same presets.
    live_preset_file: Path = field(
        default_factory=lambda: Path(
            _env("LIVE_PRESET_FILE", str(Path(__file__).resolve().parent.parent / "state" / "live-presets.json"))
        )
    )
    # Starred filter names (see presets/store/favorites.py) — one JSON file beside the live
    # presets, in the same bind-mounted state dir, because favorites belong to
    # the install rather than to whichever browser starred them.
    favorites_file: Path = field(
        default_factory=lambda: Path(
            _env("FAVORITES_FILE", str(Path(__file__).resolve().parent.parent / "state" / "favorites.json"))
        )
    )
    # Narrow-bar facets (see presets/store/narrowing.py) — one JSON file beside the
    # favorites, in the same bind-mounted state dir. The narrow bar is
    # presentational and has no daemon field behind it, so the install is the
    # only place it can live; a browser that reloads picks the facets back up.
    narrowing_file: Path = field(
        default_factory=lambda: Path(
            _env("NARROWING_FILE", str(Path(__file__).resolve().parent.parent / "state" / "narrowing.json"))
        )
    )
    # Matrix-profile descriptions (see presets/store/descriptions.py) — one JSON file beside
    # the favorites, in the same bind-mounted state dir. A description belongs to
    # the install for the same reason a favorite does, and there is nowhere in
    # hqplayerd's config for it: <matrix_profile> carries only `name`.
    description_file: Path = field(
        default_factory=lambda: Path(
            _env("DESCRIPTION_FILE", str(Path(__file__).resolve().parent.parent / "state" / "descriptions.json"))
        )
    )
    # Per-preset Matrix-tab modes (see presets/store/matrixmode.py) — one JSON file beside
    # the descriptions, in the same bind-mounted state dir. Which half of the
    # Matrix tab a preset is listened through belongs to the preset, so it has to
    # outlive the browser that chose it, and hqplayerd's config has nowhere to
    # carry it.
    matrix_mode_file: Path = field(
        default_factory=lambda: Path(
            _env("MATRIX_MODE_FILE", str(Path(__file__).resolve().parent.parent / "state" / "matrixmodes.json"))
        )
    )
    # hqplayerd's data/home directory on the daemon host — where a /backup
    # archive's data/ members land on restore, and the absolute-path prefix a
    # pipeline `process` attribute uses for uploaded filter impulse files
    # (probe-verified on 6.0.4: data/impulse_0-0.wav <-> /var/lib/hqplayer/home/…).
    # Overridable for non-standard installs.
    hqp_home: str = field(default_factory=lambda: _env("HQP_HOME", "/var/lib/hqplayer/home"))
    # Append-only event log (audit.py) — every durable write, as it was handed
    # to us. Unset means the subsystem is inert: no file, no records, no cost.
    # There is deliberately no UI for it; it is an operator's tool, set on the
    # container (`-e HQPTUNER_DEBUG_LOG=/state/audit.jsonl`) and read with jq.
    debug_log: Path | None = field(default_factory=lambda: _optional_path("DEBUG_LOG"))
    # Level for ordinary prose logging (hqptuner/__main__.py). A name, not a
    # number; anything unparseable falls back to INFO rather than refusing to
    # start (audit.resolve_level).
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO"))
