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
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx

from . import engineconf
from .config import Config
from .control import ControlClient, ControlError
from .httpconf import HttpConfigClient, is_checked, serialize_config_form
from .writer import apply_live

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0
RECONNECT_SLOW = 5.0

# Fields HQPTuner pins on every config write so the friendly-rate UI holds: the
# per-family Rate dropdown sets a ceiling (defaults_samplerate/defaults_bitrate)
# and the engine follows the source's 44.1/48 base — which requires auto_family
# on and the fixed sample/bit rate left on Auto. Not exposed in the UI.
_FORCED_CONFIG = {"auto_family": "1", "samplerate": "0", "bitrate": "0"}


def _http_field_matches(field: dict[str, Any] | None, want: str) -> bool:
    """Whether a persisted config field reflects a staged override, comparing in
    the field's own domain (checkbox → bool, everything else → string)."""
    if field is None:
        return False
    if field.get("type") == "checkbox":
        return bool(field.get("value")) == is_checked(want)
    return str(field.get("value")) == str(want)


class ConnectionManager:
    def __init__(self, cfg: Config, http_client: HttpConfigClient | None = None) -> None:
        self._cfg = cfg
        self._http = http_client
        self._client: ControlClient | None = None
        self._stop = asyncio.Event()

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
        self.loaded_at: float | None = None
        self.last_backup: bytes | None = None

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

        self._client = client
        self.info, self.state, self.status, self.status_metadata = info, state, status, meta
        self.license = license_info
        self.active_config = active_config
        self.volume_range = vrange
        self.enums = enums
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

    async def apply(self, live_edits: dict[str, dict[str, str]], http_fields: dict[str, str]) -> dict[str, Any]:
        """Apply staged changes: live setters first (readback-verified), then
        the http lane. The http POST restarts the daemon; the run loop's outage
        path handles the drop and fresh reload. No idle gate."""
        live_report: list[dict[str, Any]] = []
        if live_edits:
            client = self._client
            if client is None:
                raise ControlError("daemon not connected")
            live_report = await apply_live(client, live_edits)
        config_fields, matrix_fields = self._split_http(http_fields)
        http_report = await self._apply_http(config_fields) if config_fields else None
        matrix_report = await self._apply_matrix(matrix_fields) if matrix_fields else None
        return {"live": live_report, "http": http_report, "matrix": matrix_report}

    def _split_http(self, fields: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
        """Route staged http-lane fields to their form: names in the /matrix form
        go to /matrix, the rest to /config. Field names are unique across the two
        forms, so membership is unambiguous."""
        if not fields:
            return {}, {}
        matrix_names = {f.get("name") for f in (self.matrix_form or {}).get("fields", [])}
        config: dict[str, str] = {}
        matrix: dict[str, str] = {}
        for name, val in fields.items():
            (matrix if name in matrix_names else config)[name] = val
        return config, matrix

    async def _apply_http(self, overrides: dict[str, str]) -> dict[str, Any]:
        """POST /config applies the WHOLE form, so overlay the staged changes on
        a fresh read and submit the complete form. The daemon answers 200 even
        when it rejects ("Failed!"), so success is confirmed by reading the
        config back after the restart — never by the POST alone."""
        if self._http is None:
            return {"submitted": False, "error": "no credentials for HTTP config lane"}
        try:
            backup = await self._http.backup()  # safety copy before the write
            self.last_backup = backup
            backup_path = self._persist_backup(backup)  # survives a crash mid-apply
            fresh = await self._http.get_config()
            # HQPTuner policy: the friendly-rate UI always drives the auto-family
            # path — the user picks a per-family ceiling and the engine follows
            # the source's 44.1/48 base. That only holds with auto_family on and
            # the fixed sample/bit rate left on Auto, so every config write forces
            # them regardless of what's staged. Enforced on write only (never a
            # standalone POST), so it can't restart the daemon uninvited.
            merged = {**overrides, **_FORCED_CONFIG}
            await self._http.post_config(serialize_config_form(fresh["fields"], merged))
            verified = await self._verify_form(self._require_http().get_config, overrides)
        except httpx.HTTPError as exc:
            return {"submitted": False, "error": str(exc)}
        return {
            "submitted": True,
            "verified": verified,
            "backup_bytes": len(backup),
            "backup_path": str(backup_path) if backup_path else None,
        }

    async def _apply_matrix(self, overrides: dict[str, str]) -> dict[str, Any]:
        """POST /matrix (Bauer crossfeed / DAC correction). Same full-form,
        readback-verified contract as /config, minus the forced auto-family
        fields (matrix has none) and with file inputs dropped by the serializer
        so a loaded matrix/convolution filter is never cleared."""
        if self._http is None:
            return {"submitted": False, "error": "no credentials for HTTP config lane"}
        try:
            backup = await self._http.backup()  # safety copy before the write
            self.last_backup = backup
            self._persist_backup(backup)
            fresh = await self._http.get_matrix()
            file_names = tuple(f["name"] for f in fresh["fields"] if f.get("type") == "file" and f.get("name"))
            await self._http.post_matrix(serialize_config_form(fresh["fields"], overrides), file_names)
            verified = await self._verify_form(self._require_http().get_matrix, overrides)
        except httpx.HTTPError as exc:
            return {"submitted": False, "error": str(exc)}
        return {"submitted": True, "verified": verified, "backup_bytes": len(backup)}

    async def read_engine(self) -> dict[str, str]:
        """Current hardware-accel engine attributes, parsed from a fresh backup's
        base config (the only lane that carries them — they are not on the form).
        Fetched on demand, not per poll, since the backup archive is large."""
        engine = engineconf.read_engine_attrs(engineconf.base_config_xml(await self._require_http().backup()))
        self.engine = engine
        return engine

    async def restore_config(self, data: bytes, scope: str = "system") -> None:
        """Restore a user-supplied settings archive as-is (System-tab restore
        action). The daemon self-restarts; the caller idle-gates."""
        await self._require_http().restore(data, scope=scope)

    async def apply_engine(self, overrides: dict[str, str], all_presets: bool = False) -> dict[str, Any]:
        """Apply hardware-acceleration engine attributes (cuda/multicore/ecores/
        nblocks) — the config-file-only lane. Edit a fresh ``/backup`` archive and
        push it via ``POST /restore``; the daemon self-restarts and re-reads it,
        preserving the active preset (grounded on 6.0.4). ``all_presets`` edits
        every snapshot; otherwise just the active preset plus the base config.

        No idle gate is enforced here — the restart interrupts playback, so the
        caller (API) must idle-gate. Success is confirmed by reading the engine
        attributes back from a fresh backup after the restart."""
        engineconf.validate_overrides(overrides)
        if self._http is None:
            return {"submitted": False, "error": "no credentials for HTTP config lane"}
        try:
            active = self.active_config  # cached at connect; the currently-loaded preset
            backup = await self._http.backup()
            self.last_backup = backup
            self._persist_backup(backup)
            members = engineconf.config_members(backup, active or None, all_presets)
            modified = engineconf.edit_config_zip(backup, members, overrides)
            await self._http.restore(modified, scope="system")
            verified = await self._verify_engine(overrides)
        except httpx.HTTPError as exc:
            return {"submitted": False, "error": str(exc)}
        return {"submitted": True, "verified": verified, "members": members, "backup_bytes": len(backup)}

    async def _verify_engine(self, overrides: dict[str, str]) -> dict[str, Any]:
        """Read the engine attributes back from a fresh backup's base config after
        the restore/restart and report whether each override is reflected."""
        got: dict[str, str] = {}
        for _ in range(20):
            await self._sleep(0.5)
            try:
                fresh = await self._require_http().backup()
            except httpx.HTTPError:
                continue
            if fresh[:4] != b"PK\x03\x04":
                continue
            got = engineconf.read_engine_attrs(engineconf.base_config_xml(fresh))
            if all(got.get(k) == v for k, v in overrides.items()):
                self.engine = got
                return {"applied": True, "engine": got}
        return {"applied": False, "engine": got}

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

    async def _verify_form(
        self, fetch: Callable[[], Awaitable[dict[str, Any]]], overrides: dict[str, str]
    ) -> dict[str, Any]:
        """Poll the form (GET /config or /matrix via `fetch`) until it REFLECTS
        the overrides, not merely until it responds: right after the POST the
        daemon still serves the pre-restart form for a moment, then drops, then
        returns with the new config. Retrying only on connection error would read
        that stale form and false-negative. A genuine rejection never reflects,
        so it times out as not-applied.

        On timeout the failure reason is read off the LAST poll: a daemon still
        serving a clean form that never reflects the change was a "rejected"
        apply; one that ends unreachable (connection error at the deadline) is
        "unreachable" — it accepted the POST and never came back. The caller
        needs that split to tell a bad value from a crashed restart."""
        deadline = time.monotonic() + self._cfg.alarm_threshold
        mismatches = dict(overrides)
        last_error: str | None = None
        while time.monotonic() < deadline:
            try:
                after = {f["name"]: f for f in (await fetch())["fields"]}
                last_error = None
                mismatches = {
                    name: want for name, want in overrides.items() if not _http_field_matches(after.get(name), want)
                }
                if not mismatches:
                    return {"applied": True, "mismatches": {}, "reason": "applied"}
            except (httpx.HTTPError, OSError) as exc:
                last_error = str(exc)  # daemon mid-restart — keep polling
            await self._sleep(RECONNECT_FAST)
        reason = "unreachable" if last_error is not None else "rejected"
        return {"applied": False, "mismatches": mismatches, "reason": reason, "error": last_error}

    async def load_profile(self, name: str) -> None:
        await self._require_http().post_profile("load", profile=name)

    async def save_profile(self, name: str) -> None:
        await self._require_http().post_profile("save", profile_name=name)

    async def delete_profile(self, name: str) -> None:
        await self._require_http().post_profile("delete", profile=name)

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
