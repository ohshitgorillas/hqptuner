"""Connection manager — single source of truth for daemon reachability.

Roadmap Phase 2.2 rules:
- "reachable" means a successful GetInfo handshake, not a mere TCP accept
- State/Status polling doubles as heartbeat (and keeps traffic under the
  daemon's ~156 s idle-drop window, protocol.md §1)
- unreachable beyond the alarm threshold (default 15 s; measured
  restart-to-GetInfo on Opal is 9.3 s) is surfaced as `alarm`
- poll aggressively during the initial outage window, then back off
- every fresh connection reloads all state from scratch: GetInfo, State,
  Status, enumerations, GET /config — no cached pre-outage state
- API reads never touch the socket; they serve the last snapshot (fail-fast)

Persistent config can change without an HQPTuner apply — an external preset
load, the output DAC changing, or HQPlayer's own web UI all rewrite the forms —
so the /config and /matrix snapshots are refetched every poll (best-effort on
the 8088 lane), not only on reconnect, and the frontend tracks reality instead
of a connect-time cache.
"""

import asyncio
import contextlib
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from . import logtail
from .conf import engineconf, presetconf
from .conf.httpconf import HttpConfigClient
from .config import Config
from .control import CommandError, ControlClient, ControlError
from .filterpark import FilterPark
from .lanes import enginelane, httplane, matrixlane, presetlane
from .presetstore import PresetStore
from .writer import apply_live

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0
RECONNECT_SLOW = 5.0


class ConnectionManager:
    def __init__(self, cfg: Config, http_client: HttpConfigClient | None = None) -> None:
        self._cfg = cfg
        self._http = http_client
        self._client: ControlClient | None = None
        self._stop = asyncio.Event()
        # HQPTuner-owned preset store (presetstore) — the source of truth for
        # presets. hqplayerd's own named-profile subsystem is unreliable, so we
        # drive it only through restore-onto-[default] and keep data/cfgs mirrored.
        self._store = PresetStore(cfg.preset_dir)
        self._filters = FilterPark(cfg.backup_dir / "pending-filters", cfg.hqp_home)
        self._migrated = False

        self.reachable = False
        self.unreachable_since: float | None = time.time()
        self._unreachable_mono: float = time.monotonic()

        self.info: dict[str, str] | None = None
        self.license: dict[str, str] | None = None
        self.state: dict[str, str] | None = None
        self.status: dict[str, str] | None = None
        self.status_metadata: dict[str, str] | None = None
        self.volume_range: dict[str, str] | None = None
        self.engine: dict[str, str] | None = None
        self.active_config: str | None = None
        self.enums: dict[str, list[dict[str, str]]] | None = None
        self.config_form: dict[str, Any] | None = None
        self.config_error: str | None = None
        self.matrix_form: dict[str, Any] | None = None
        self.matrix_error: str | None = None
        # Saved matrix profile names from the live 4321 lane (MatrixListProfiles —
        # unauthenticated, no reload). The active one is State.matrix_profile.
        self.matrix_profiles: list[str] | None = None
        self.loaded_at: float | None = None
        self.last_healthy_backup: bytes | None = None  # workaround for the profile-load backup bug
        # Running config read from the config FILE (the /backup archive's working
        # hqplayerd.xml), in form-field terms. The /config form is lossy for
        # settings whose XML domain is wider than the widget the daemon renders —
        # volume_fixed is 0/1/2 in the XML but a plain checkbox on the form, so the
        # form cannot distinguish -3 dB from -6 dB. Fields flagged `fileTruth` in
        # the frontend schema read their baseline from here instead. Refreshed on
        # connect and after every persistent apply (never per-poll: /backup is ~5 MB).
        self.file_config: dict[str, str] | None = None

    @property
    def alarm(self) -> bool:
        return not self.reachable and time.monotonic() - self._unreachable_mono > self._cfg.alarm_threshold

    def stop(self) -> None:
        self._stop.set()

    async def aclose(self) -> None:
        """Clean shutdown: stop the loop and close the control connection so no
        socket is left dangling. The caller awaits the run() task separately."""
        self.stop()
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def run(self) -> None:
        while not self._stop.is_set():
            if self._client is None:
                try:
                    await self._connect_and_load()
                except Exception as exc:
                    await self._drop(f"connect/load failed: {exc}")
                    # aggressive inside the expected-restart window, then back off
                    await self._sleep(RECONNECT_FAST if not self.alarm else RECONNECT_SLOW)
                    continue
            try:
                await self._poll()
            except Exception as exc:
                await self._drop(f"poll failed: {exc}")
                continue
            await self._sleep(self._cfg.poll_interval)

    async def _sleep(self, seconds: float) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stop.wait(), seconds)

    async def _drop(self, reason: str) -> None:
        if self.reachable or self._client is not None:
            log.warning("daemon unreachable: %s", reason)
        if self.reachable:
            self.unreachable_since = time.time()
            self._unreachable_mono = time.monotonic()
        self.reachable = False
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def _connect_and_load(self) -> None:
        client = ControlClient(self._cfg.hqp_host, self._cfg.hqp_control_port, self._cfg.request_timeout)
        await client.connect()
        info = await client.get_info()  # the handshake — this defines "reachable"
        license_info = await client.get_license()  # static; licensee + valid flag
        active_config = await client.get_active_config()  # active preset name
        state = await client.get_state()
        status, meta = await client.get_status()
        vrange = await client.get_volume_range()
        enums = await client.get_all_enumerations()
        matrix_profiles: list[str] | None = None
        with contextlib.suppress(CommandError):  # older engines may not speak Matrix*
            matrix_profiles = await client.get_matrix_profiles()

        config_form = None
        config_error = None
        matrix_form = None
        matrix_error = None
        if self._http is not None:
            # 8088 lane failing must not take down the 4321 lane
            try:
                config_form = await self._http.get_config()
            except Exception as exc:
                config_error = str(exc)
                log.warning("GET /config failed: %s", exc)
            try:
                matrix_form = await self._http.get_matrix()
            except Exception as exc:
                matrix_error = str(exc)
                log.warning("GET /matrix failed: %s", exc)
            try:
                await self.load_file_config()
            except Exception as exc:
                # the form still carries every field; only the lossy ones degrade
                log.warning("file-config read failed: %s", exc)
            try:
                await self._migrate_presets(active_config)
            except Exception as exc:
                log.warning("preset migration skipped: %s", exc)

        self._client = client
        self.info, self.state, self.status, self.status_metadata = info, state, status, meta
        self.license = license_info
        self.active_config = active_config
        self.volume_range = vrange
        self.enums = enums
        self.matrix_profiles = matrix_profiles
        self.config_form, self.config_error = config_form, config_error
        self.matrix_form, self.matrix_error = matrix_form, matrix_error
        self.loaded_at = time.time()
        self.reachable = True
        self.unreachable_since = None
        log.info("connected: %s engine %s", info.get("name"), info.get("engine") or info.get("version"))

    async def _poll(self) -> None:
        client = self._client
        if client is None:
            raise ControlError("not connected")
        state = await client.get_state()
        # mode switch swaps the enumeration lists wholesale (outline §5) —
        # re-enumerate rather than serve stale lists
        if self.state is not None and state.get("mode") != self.state.get("mode"):
            log.info("mode changed (%s -> %s), re-enumerating", self.state.get("mode"), state.get("mode"))
            self.enums = await client.get_all_enumerations()
        status, meta = await client.get_status()
        self.state, self.status, self.status_metadata = state, status, meta
        self.volume_range = await client.get_volume_range()
        with contextlib.suppress(CommandError):  # profile saves/deletes land without an apply
            self.matrix_profiles = await client.get_matrix_profiles()
        # external changes (preset loads, the DAC changing, HQPlayer's own UI)
        # rewrite the http forms without any HQPTuner apply — refetch each poll so
        # the config/matrix snapshots track reality instead of only connect-time.
        await self._refresh_http_forms()
        self.loaded_at = time.time()

    async def _refresh_http_forms(self) -> None:
        """Best-effort refresh of the /config and /matrix snapshots. A failure on
        the 8088 lane must never fail the 4321 poll — keep the last-good form."""
        if self._http is None:
            return
        try:
            self.config_form, self.config_error = await self._http.get_config(), None
        except Exception as exc:
            self.config_error = str(exc)
        try:
            self.matrix_form, self.matrix_error = await self._http.get_matrix(), None
        except Exception as exc:
            self.matrix_error = str(exc)

    async def set_volume(self, db: str) -> dict[str, Any]:
        """Live playback-volume write — immediate, outside the staged-config
        apply flow. Raises CommandError when volume control is disabled (fixed
        volume / no-volume path; VolumeRange enabled=0). Returns the readback
        level so the caller echoes the applied value."""
        client = self._client
        if client is None:
            raise ControlError("daemon not connected")
        await client.set_volume(db)
        self.state = await client.get_state()
        return {"volume": self.state.get("volume")}

    # --- write path (Phase 3) -----------------------------------------

    async def apply(
        self,
        live_edits: dict[str, dict[str, str]],
        http_fields: dict[str, str],
        switch_to: str | None = None,
    ) -> dict[str, Any]:
        """Apply staged changes. When ``switch_to`` is set the user previewed a
        different preset — load it first so it becomes the active preset (the only
        way HQPlayer sets the active label), then apply the staged tweaks on top of
        its snapshot. Then the live setters (readback-verified), then the persistent
        lane, which re-asserts the active snapshot ⊕ tweaks via POST /restore — so
        drift never survives — and self-corrects fixable divergence."""
        switched: dict[str, Any] | None = None
        if switch_to is not None:
            # cache a healthy backup BEFORE the load — the load bug empties /backup,
            # and the persistent apply below needs the archive (docs/protocol.md)
            with contextlib.suppress(httpx.HTTPError):
                await self._backup_or_cached()
            # restore-onto-[default] + mirror (load_preset), never hqplayerd's profile/load
            switched = await self.load_preset(switch_to)
        live_report: list[dict[str, Any]] = []
        if live_edits:
            client = self._client
            if client is None:
                raise ControlError("daemon not connected")
            live_report = await apply_live(client, live_edits)
        persistent = await httplane.apply(self, http_fields) if http_fields else None
        if persistent is not None and persistent.get("applied"):
            # the restore that just applied carried the parked filter files —
            # they live on the daemon now, so the parking area is done with them
            self.clear_parked_filters()
        return {"live": live_report, "persistent": persistent, "switched": switched}

    async def _backup_or_cached(self, *, for_write: bool = False) -> bytes:
        """Fetch ``/backup``, caching it whenever it's a usable archive. WORKAROUND
        (docs/protocol.md): hqplayerd 6.0.4 serves an EMPTY ``settings.zip`` after a
        named ``profile/load`` (and after ``profile/save`` — observed live) until
        the service is restarted. When that happens, fall back to the last healthy
        archive we saw.

        ``for_write=True`` refuses that fallback. The cached archive carries a
        stale working config, and a restore built on it silently resurrects
        whatever the user changed since it was cached — writing old values back
        over new ones. A read may be stale; a write may not."""
        backup = await self._require_http().backup()
        if engineconf.base_config_xml(backup):  # has hqplayerd.xml → usable
            self.last_healthy_backup = backup
            return backup
        if for_write:
            raise presetconf.GroundingError(
                "daemon returned an unusable /backup (known 6.0.4 bug after a profile load/save); "
                "refusing to build a restore from a stale cached archive — restart hqplayerd, then retry"
            )
        if self.last_healthy_backup is not None:
            log.warning("empty /backup from daemon (post-profile-load bug) — using cached archive")
            return self.last_healthy_backup
        return backup  # no cache yet — let the caller fail with a clear message

    async def read_preset(self, name: str) -> dict[str, str]:
        """A preset's saved settings in form-field terms, for the editor preview —
        no daemon touch, no restart. A named preset reads from the HQPTuner store;
        the empty (``[default]``) selection reads the current running config."""
        if not name:
            return dict(self.file_config or await self.load_file_config())
        return presetconf.read_config(self._store.read(name))

    # --- accessors for the extracted write lanes (httplane) ---------------

    @property
    def http_client(self) -> HttpConfigClient | None:
        return self._http

    @property
    def alarm_threshold(self) -> float:
        return self._cfg.alarm_threshold

    def require_http(self) -> HttpConfigClient:
        return self._require_http()

    def persist_backup(self, backup: bytes) -> None:
        self._persist_backup(backup)

    def monotonic(self) -> float:
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        await self._sleep(seconds)

    async def await_http_ready(self) -> bool:
        return await self._await_http_ready()

    async def backup_for_write(self) -> bytes:
        return await self._backup_or_cached(for_write=True)

    async def _await_http_ready(self) -> bool:
        """Wait until the HTTP config lane serves again. The daemon restarts on a
        preset load and on every restore, and its active label flips before the
        restart completes — so callers must not assume 'label switched' means
        'ready to write'."""
        deadline = time.monotonic() + self._cfg.alarm_threshold
        while time.monotonic() < deadline:
            try:
                await self._require_http().get_config()
            except httpx.HTTPError:
                await self._sleep(RECONNECT_FAST)
                continue
            return True
        return False

    async def read_engine(self) -> dict[str, str]:
        """Current hardware-accel engine attributes, parsed from a fresh backup's
        base config (the only lane that carries them — they are not on the form).
        Fetched on demand, not per poll, since the backup archive is large."""
        engine = engineconf.read_engine_attrs(engineconf.base_config_xml(await self._backup_or_cached()))
        self.engine = engine
        return engine

    async def load_file_config(self) -> dict[str, str]:
        """Running config read from the backup archive's working ``hqplayerd.xml``,
        in form-field terms. Serves the fields the ``/config`` form renders lossily
        (``volume_fixed``: 0/1/2 in XML, a bare checkbox on the form). Fetched on
        connect and refreshed by the apply's verify step — never per poll, since
        the archive is large."""
        backup = await self._backup_or_cached()
        self.file_config = presetconf.read_config(engineconf.base_config_xml(backup))
        return self.file_config

    async def read_log_tail(self, lines: int = 50) -> dict[str, Any]:
        """Static tail of the daemon's log for the System-tab live view. Not a
        stream — a fresh GET /log per call over the 8088 web interface, so it
        works regardless of the daemon's `<log file>` setting and needs no host
        mount. Reports `available` false (with a reason) when /log can't be read."""
        path, enabled = logtail.log_file_field(self.config_form)
        base_url = f"http://{self._cfg.hqp_host}:{self._cfg.hqp_http_port}"
        try:
            text = await logtail.fetch_log(base_url)
        except httpx.HTTPError as exc:
            return {"path": path, "enabled": enabled, "available": False, "reason": str(exc), "lines": []}
        return {"path": path, "enabled": enabled, "available": True, "lines": logtail.tail_text(text, lines)}

    async def restore_config(self, data: bytes, scope: str = "system") -> None:
        """Restore a user-supplied settings archive as-is (System-tab restore
        action). The daemon self-restarts; the caller idle-gates."""
        await self._require_http().restore(data, scope=scope)

    async def apply_engine(self, overrides: dict[str, str], all_presets: bool = False) -> dict[str, Any]:
        """Apply hardware-acceleration engine attributes — the config-file-only
        lane (`enginelane`). No idle gate is enforced here: the restore restarts
        the daemon and interrupts playback, so the caller (API) must idle-gate."""
        engineconf.validate_overrides(overrides)
        if self._http is None:
            return {"submitted": False, "error": "no credentials for HTTP config lane"}
        try:
            backup = await self._backup_or_cached()
            self._persist_backup(backup)
            result = await enginelane.apply(self._http, backup, overrides, self.active_config, all_presets, self._sleep)
        except httpx.HTTPError as exc:
            return {"submitted": False, "error": str(exc)}
        engine = result["verified"].get("engine")
        if engine:
            self.engine = engine
        return result

    # --- matrix profiles (matrixlane, matrix-spec step 5) ------------------

    @property
    def control(self) -> ControlClient | None:
        """The live 4321 client, for the extracted lanes (None while unreachable)."""
        return self._client

    async def matrix_switch_profile(self, name: str) -> dict[str, Any]:
        return await matrixlane.switch_profile(self, name)

    async def matrix_profile_action(self, action: str, name: str) -> dict[str, Any]:
        return await matrixlane.profile_action(self, action, name)

    # --- convolution filter uploads (filterpark, matrix-spec step 4) -------

    def park_filter(self, name: str, data: bytes) -> dict[str, str]:
        return self._filters.park(name, data)

    def parked_filter_members(self) -> dict[str, bytes]:
        return self._filters.members()

    def clear_parked_filters(self) -> None:
        self._filters.clear()

    def _persist_backup(self, data: bytes) -> Path | None:
        """Write the pre-apply settings backup to disk so a crash mid-apply still
        leaves a recoverable copy (memory-only last_backup does not survive one).
        Best-effort: a write failure must not block the apply itself."""
        path = self._cfg.backup_dir / "pre-apply-settings.zip"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as exc:
            log.warning("could not persist pre-apply backup to %s: %s", path, exc)
            return None
        return path

    async def refresh_devices(self) -> dict[str, Any]:
        """Trigger a daemon output-device re-scan, then refetch the /config and
        /matrix forms so the device dropdowns serve the new endpoint list (an NAA
        powered back on, a DAC replugged). No restart, no idle gate — a rescan is
        read-only on the audio path."""
        await self._require_http().refresh_devices()
        await self._refresh_http_forms()
        return {"refreshed": True}

    # --- preset lane (presetlane) — thin delegators over the store + restore ---

    @property
    def store(self) -> PresetStore:
        return self._store

    async def refresh_http_forms(self) -> None:
        await self._refresh_http_forms()

    async def backup_or_cached(self) -> bytes:
        return await self._backup_or_cached()

    def presets(self) -> dict[str, Any]:
        return presetlane.listing(self)

    async def load_preset(self, name: str) -> dict[str, Any]:
        return await presetlane.load(self, name)

    async def save_preset(self, name: str) -> dict[str, Any]:
        return await presetlane.save(self, name)

    async def delete_preset(self, name: str) -> dict[str, Any]:
        return await presetlane.delete(self, name)

    async def _migrate_presets(self, active_hint: str | None = None) -> None:
        if self._migrated or self._http is None:
            return
        self._migrated = True
        imported = await presetlane.migrate(self, active_hint)
        if imported:
            log.info("migrated presets into store: %s", ", ".join(imported))

    async def backup(self) -> bytes:
        """The daemon's current settings archive (a zip) for download."""
        return await self._require_http().backup()

    def _require_http(self) -> HttpConfigClient:
        if self._http is None:
            raise ControlError("no credentials for HTTP config lane")
        return self._http

    def current_mode_name(self) -> str:
        if not self.state or not self.enums:
            return ""
        idx = self.state.get("mode", "")
        for item in self.enums.get("modes", []):
            if item.get("index") == idx:
                return item.get("name", "")
        return ""
