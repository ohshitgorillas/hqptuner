"""Runtime configuration from environment (HQPTUNER_* variables)."""

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar, NamedTuple

from hqptuner.paths import bundled, user_data_dir


def _env(name: str, default: str) -> str:
    return os.environ.get(f"HQPTUNER_{name}", default)


# hqplayerd's stock management password, as its own docs publish it. It is what
# ``hqp_password`` falls back to, so it is also the one value in that field that
# nobody chose: an install running on it has configured nothing.
STOCK_CREDENTIAL = "password"


def _store(name: str, *, frozen: bool | None = None) -> Path:
    """Default location of one store file: the user's data directory when frozen, the repo's ``state/`` otherwise.

    A frozen build installs where the user cannot write, or unpacks somewhere it deletes on exit, so the two
    cases cannot share a directory. ``frozen`` defaults to the live ``sys.frozen``, resolved fresh on every
    call that omits it; ``Config`` is the public surface that pins it, through its own ``frozen`` field.
    """
    if frozen is None:
        frozen = getattr(sys, "frozen", False)
    if frozen:
        return user_data_dir() / name
    return Path(__file__).resolve().parent.parent / "state" / name


def _store_dir(name: str, *, frozen: bool | None = None) -> Path:
    """Default location of one store directory, on the same split as ``_store``."""
    if frozen is None:
        frozen = getattr(sys, "frozen", False)
    if frozen:
        return user_data_dir() / name
    return Path(__file__).resolve().parent.parent / name


def _env_flag(name: str, default: str) -> bool:
    """Read an on/off var, spelled the way an operator would spell it in a compose file."""
    return _env(name, default).strip().lower() not in ("0", "false", "no", "off")


def _optional_path(name: str) -> Path | None:
    """Read a path var that is OFF when unset.

    An empty value is not a path to the current directory, it is the absence of one.
    """
    raw = _env(name, "").strip()
    return Path(raw) if raw else None


# Sentinel for a store/bundle-derived `Path` field left at its default: its own
# `HQPTUNER_*` variable was unset, and no caller passed the field directly either.
# `__post_init__` resolves it (by equality, since it round-trips through `str()`
# inside `_env`'s own fallback) once `frozen`/`bundle` are known. Kept as an `_env`
# fallback, never as a bare field default, so `scripts/gates/check_container_env.py`
# — which walks each field's default for a literal `_env(...)` call to learn its
# variable name — still sees every one of these fields.
_UNSET_PATH = Path()

#: Whether any build offers the junk-filter advisor, auto-pilot and the METER page. Not an operator knob: the three
#: ship only when this reads True, and a stored auto-pilot state never acts while it reads False.
ADVISOR_ENABLED = False


class Store(NamedTuple):
    """One store field driven by ``_store``/``_store_dir``.

    ``attr`` is the ``Config`` attribute, ``name`` the name it passes down, ``is_dir`` whether that name is a directory
    (``_store_dir``) rather than a file (``_store``), and ``what`` the noun a refused read or write of it names.
    """

    attr: str
    name: str
    is_dir: bool
    what: str


CONNECTION_STORE = Store("connection_file", "connection.json", is_dir=False, what="the connection")
BACKUP_STORE = Store("backup_dir", "backups", is_dir=True, what="backups")
PRESET_STORE = Store("preset_dir", "presets", is_dir=True, what="presets")
LIVE_PRESET_STORE = Store("live_preset_file", "live-presets.json", is_dir=False, what="live presets")
FAVORITES_STORE = Store("favorites_file", "favorites.json", is_dir=False, what="favorites")
NARROWING_STORE = Store("narrowing_file", "narrowing.json", is_dir=False, what="the filter narrowing")
DESCRIPTION_STORE = Store("description_file", "descriptions.json", is_dir=False, what="descriptions")
MATRIX_MODE_STORE = Store("matrix_mode_file", "matrixmodes.json", is_dir=False, what="matrix modes")
AUTOPILOT_STORE = Store("autopilot_file", "autopilot.json", is_dir=False, what="the auto-pilot setting")


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
    # Whether the junk-filter advisor, auto-pilot and the METER page are offered at all. A build
    # constant, not an operator knob: off hides the three and makes auto-pilot inert while they
    # are reworked, with every stored state left where it is.
    advisor_enabled: bool = ADVISOR_ENABLED
    # hqplayerd's stock management credentials (Signalyst embedded-install docs) —
    # override only if the daemon's auth was re-provisioned.
    # Where the daemon address and management credentials the user saved at runtime live (core/connection.py) — one
    # JSON file beside the other install-owned stores. The three fields it carries are layered UNDER the variables
    # above, so a container's pins keep their meaning and an install with no variables at all still has somewhere to
    # keep what the user typed.
    connection_file: Path = field(default_factory=lambda: Path(_env("CONNECTION_FILE", str(_UNSET_PATH))))
    hqp_username: str = field(default_factory=lambda: _env("HQP_USERNAME", "hqplayer"))
    hqp_password: str = field(default_factory=lambda: _env("HQP_PASSWORD", STOCK_CREDENTIAL))
    listen_host: str = field(default_factory=lambda: _env("LISTEN_HOST", "127.0.0.1"))
    listen_port: int = field(default_factory=lambda: int(_env("LISTEN_PORT", "8090")))
    poll_interval: float = field(default_factory=lambda: float(_env("POLL_INTERVAL", "2.0")))
    # While the engine plays, Status alone is read this often between heartbeats, so the counters it
    # carries reach the page sooner than `poll_interval` brings them; the heartbeat keeps its own cadence.
    status_interval: float = field(default_factory=lambda: float(_env("STATUS_INTERVAL", "1.0")))
    alarm_threshold: float = field(default_factory=lambda: float(_env("ALARM_THRESHOLD", "15.0")))
    request_timeout: float = field(default_factory=lambda: float(_env("REQUEST_TIMEOUT", "5.0")))
    # How long discovery waits for daemons to answer its multicast datagram
    # (engine/discovery.py). There is no count to wait for — a daemon that is
    # not there sends nothing — so this bounds the datagram sweep, and a sweep
    # nobody answers is followed by one control-port ask on `request_timeout`.
    discovery_timeout: float = field(default_factory=lambda: float(_env("DISCOVERY_TIMEOUT", "3.0")))
    # Where discovery sends its datagram. The documented multicast group by
    # default; a plain host address for a network that drops multicast, which
    # takes the same path and answers the same way.
    discovery_target: str = field(default_factory=lambda: _env("DISCOVERY_TARGET", "239.192.0.199"))
    # The address a container reaches its own host on. Asked directly when a
    # discovery sweep finds nothing, and at startup when neither a saved record
    # nor HQPTUNER_HQP_HOST has named a daemon. Settable because the name
    # resolves inside a container only.
    container_host_alias: str = field(default_factory=lambda: _env("CONTAINER_HOST_ALIAS", "host.docker.internal"))
    # Whether this install resolves its bundled assets and per-user stores as a frozen
    # build would, and where its unpacked bundle sits — the two facts PyInstaller's
    # bootloader would otherwise leave on `sys.frozen`/`sys._MEIPASS`. Both default to
    # that live state, read fresh in `__post_init__`; a caller pins either to choose a
    # branch without touching `sys` itself.
    frozen: bool | None = None
    bundle: Path | None = None
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(_UNSET_PATH))))
    backup_dir: Path = field(default_factory=lambda: Path(_env("BACKUP_DIR", str(_UNSET_PATH))))
    # HQPTuner-owned preset store (see presets/store/presets.py) — full-config XML snapshots we
    # manage ourselves instead of hqplayerd's unreliable named-profile subsystem.
    preset_dir: Path = field(default_factory=lambda: Path(_env("PRESET_DIR", str(_UNSET_PATH))))
    # The LIVE view's named live snapshots (see presets/store/live.py) — one JSON file, not a
    # directory, because a live snapshot is a handful of enum IDs rather than a
    # config snapshot. Defaults beside the dev container's bind-mounted state dir
    # so a host run and the dev container read the same presets.
    live_preset_file: Path = field(default_factory=lambda: Path(_env("LIVE_PRESET_FILE", str(_UNSET_PATH))))
    # Starred filter names (see presets/store/favorites.py) — one JSON file beside the live
    # presets, in the same bind-mounted state dir, because favorites belong to
    # the install rather than to whichever browser starred them.
    favorites_file: Path = field(default_factory=lambda: Path(_env("FAVORITES_FILE", str(_UNSET_PATH))))
    # Narrow-bar facets (see presets/store/narrowing.py) — one JSON file beside the
    # favorites, in the same bind-mounted state dir. The narrow bar is
    # presentational and has no daemon field behind it, so the install is the
    # only place it can live; a browser that reloads picks the facets back up.
    narrowing_file: Path = field(default_factory=lambda: Path(_env("NARROWING_FILE", str(_UNSET_PATH))))
    # Matrix-profile descriptions (see presets/store/descriptions.py) — one JSON file beside
    # the favorites, in the same bind-mounted state dir. A description belongs to
    # the install for the same reason a favorite does, and there is nowhere in
    # hqplayerd's config for it: <matrix_profile> carries only `name`.
    description_file: Path = field(default_factory=lambda: Path(_env("DESCRIPTION_FILE", str(_UNSET_PATH))))
    # Per-preset Matrix-tab modes (see presets/store/matrixmode.py) — one JSON file beside
    # the descriptions, in the same bind-mounted state dir. Which half of the
    # Matrix tab a preset is listened through belongs to the preset, so it has to
    # outlive the browser that chose it, and hqplayerd's config has nowhere to
    # carry it.
    matrix_mode_file: Path = field(default_factory=lambda: Path(_env("MATRIX_MODE_FILE", str(_UNSET_PATH))))
    # Auto-pilot state (see presets/store/autopilot.py) — one JSON file beside the
    # matrix modes, in the same bind-mounted state dir. Whether the high-frequency
    # filter is being driven for the listener is a property of the install, and
    # hqplayerd's config file has no junk-filter field to carry it in.
    autopilot_file: Path = field(default_factory=lambda: Path(_env("AUTOPILOT_FILE", str(_UNSET_PATH))))
    # hqplayerd's data/home directory on the daemon host — where a /backup
    # archive's data/ members land on restore, and the absolute-path prefix a
    # pipeline `process` attribute uses for uploaded filter impulse files
    # (on hqplayerd 6.0.4, data/impulse_0-0.wav maps to /var/lib/hqplayer/home/…).
    # Overridable for non-standard installs.
    hqp_home: str = field(default_factory=lambda: _env("HQP_HOME", "/var/lib/hqplayer/home"))
    # Largest convolution filter upload accepted, in bytes (api/routes/matrix/matrix.py).
    # A million-tap float32 mono impulse is 4 MiB; the default leaves room for
    # 24 s at 352.8 kHz and keeps a LAN client from filling the backup volume
    # one upload at a time.
    filter_max_bytes: int = field(default_factory=lambda: int(_env("FILTER_MAX_BYTES", str(32 * 1024 * 1024))))
    # Largest state upload accepted, in bytes, and the most the stores it carries
    # may unpack to (presets/store/stateimport.py).
    state_max_bytes: int = field(default_factory=lambda: int(_env("STATE_MAX_BYTES", str(64 * 1024 * 1024))))
    # Append-only event log (audit.py) — every durable write, as it was handed
    # to us. Unset means the subsystem is inert: no file, no records, no cost.
    # There is deliberately no UI for it; it is an operator's tool, set on the
    # container (`-e HQPTUNER_DEBUG_LOG=/state/audit.jsonl`) and read with jq.
    debug_log: Path | None = field(default_factory=lambda: _optional_path("DEBUG_LOG"))
    # Calibration capture for the junk-filter detector (core/junkcal.py): one
    # JSON Lines file per playback period in this directory. Unset means the
    # capture is inert: no task, no file, no cost. An operator's tool, like the
    # event log above.
    junkcal_dir: Path | None = field(default_factory=lambda: _optional_path("JUNKCAL_DIR"))
    # Level for ordinary prose logging (hqptuner/__main__.py). A name, not a
    # number; anything unparseable falls back to INFO rather than refusing to
    # start (audit.resolve_level).
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO"))

    # Every store field driven by `_store`/`_store_dir`.
    STORES: ClassVar[tuple[Store, ...]] = (
        CONNECTION_STORE,
        BACKUP_STORE,
        PRESET_STORE,
        LIVE_PRESET_STORE,
        FAVORITES_STORE,
        NARROWING_STORE,
        DESCRIPTION_STORE,
        MATRIX_MODE_STORE,
        AUTOPILOT_STORE,
    )

    def __post_init__(self) -> None:
        """Resolve every store/bundle field its own ``HQPTUNER_*`` variable left at the sentinel.

        Each field's own ``default_factory`` already gave its variable, and any direct constructor
        argument, first say; only a field still at ``_UNSET_PATH`` reaches here, and what it becomes
        now honors ``self.frozen``/``self.bundle`` instead of always reading ``sys`` live.
        """
        for attr, name, is_dir, _what in self.STORES:
            if getattr(self, attr) == _UNSET_PATH:
                resolver = _store_dir if is_dir else _store
                setattr(self, attr, resolver(name, frozen=self.frozen))
        if self.data_dir == _UNSET_PATH:
            self.data_dir = bundled("data", bundle=self.bundle)

    @property
    def hqp_password_chosen(self) -> bool:
        """Whether the password in force was chosen rather than defaulted.

        ``hqp_password`` is never empty on a stock install, so its emptiness cannot answer "has this install been
        configured": the field holds the published default until somebody replaces it. Asking whether the value is
        that default answers it instead, and it follows the field wherever the value comes from — a variable, the
        saved record layered in at ``core/connection.py``, or a save made while HQPTuner is running.
        """
        return bool(self.hqp_password) and self.hqp_password != STOCK_CREDENTIAL
