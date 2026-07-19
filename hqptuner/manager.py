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

from . import engineconf, presetconf
from .config import Config
from .control import ControlClient, ControlError
from .httpconf import HttpConfigClient
from .writer import apply_live

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0
RECONNECT_SLOW = 5.0
_PERSIST_RETRIES = 2  # corrective re-applies before giving up on a fixable divergence

# Fields HQPTuner pins on every config write so the friendly-rate UI holds: the
# per-family Rate dropdown sets a ceiling (defaults_samplerate/defaults_bitrate)
# and the engine follows the source's 44.1/48 base — which requires auto_family
# on and the fixed sample/bit rate left on Auto. Not exposed in the UI.
_FORCED_CONFIG = {"auto_family": "1", "samplerate": "0", "bitrate": "0"}


def _config_diff(intended: dict[str, str], realized: dict[str, str]) -> dict[str, dict[str, str | None]]:
    """Fields where the running config didn't match what the apply intended."""
    return {k: {"want": v, "got": realized.get(k)} for k, v in intended.items() if realized.get(k) != v}


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
        self.last_healthy_backup: bytes | None = None  # workaround for the profile-load backup bug

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
            switched = await self._switch_preset(switch_to)
        live_report: list[dict[str, Any]] = []
        if live_edits:
            client = self._client
            if client is None:
                raise ControlError("daemon not connected")
            live_report = await apply_live(client, live_edits)
        persistent = await self._apply_persistent(http_fields) if http_fields else None
        return {"live": live_report, "persistent": persistent, "switched": switched}

    async def _switch_preset(self, name: str) -> dict[str, Any]:
        """Load a preset so it becomes the active one, then wait for the active
        label to reflect it (the load restarts the daemon; the run loop reconnects
        and re-reads it). Reported so the caller can tell the switch took."""
        await self.load_profile(name)
        deadline = time.monotonic() + self._cfg.alarm_threshold
        while time.monotonic() < deadline:
            await self._sleep(RECONNECT_FAST)
            if self.active_config == name:
                await self._await_http_ready()  # label flips before the restart finishes
                return {"name": name, "active": True}
        return {"name": name, "active": self.active_config == name}

    async def _backup_or_cached(self) -> bytes:
        """Fetch ``/backup``, caching it whenever it's a usable archive. WORKAROUND
        (docs/protocol.md): hqplayerd 6.0.4 serves an EMPTY ``settings.zip`` after a
        named ``profile/load`` until the service is restarted. When that happens,
        fall back to the last healthy archive we saw — a load doesn't modify the
        snapshots inside it, so it stays current. ``apply`` warms this cache before
        the switch, while ``/backup`` still works. Remove once the daemon is fixed."""
        backup = await self._require_http().backup()
        if engineconf.base_config_xml(backup):  # has hqplayerd.xml → usable
            self.last_healthy_backup = backup
            return backup
        if self.last_healthy_backup is not None:
            log.warning("empty /backup from daemon (post-profile-load bug) — using cached archive")
            return self.last_healthy_backup
        return backup  # no cache yet — let the caller fail with a clear message

    async def read_preset(self, name: str) -> dict[str, str]:
        """A preset's saved settings in form-field terms, read from its snapshot in
        a fresh /backup — WITHOUT loading it (no daemon touch, no restart). Powers
        the preview: picking a preset shows its values in the editor before apply."""
        backup = await self._backup_or_cached()
        return presetconf.read_config(presetconf.snapshot_member(backup, name))

    async def _apply_persistent(self, edits: dict[str, str]) -> dict[str, Any]:
        """Re-assert the active preset's snapshot ⊕ edits via POST /restore, then
        verify + self-correct. Each pass: fetch a fresh /backup, build a restore
        archive whose working config is the snapshot with edits applied (plus the
        forced auto-family fields), restore, and read the running config back.
        Converged → done. Diverged but correctable → retry. Diverged on a
        net_device the daemon no longer offers (endpoint gone) → unfixable:
        surface and stop, since no restart conjures absent hardware."""
        if self._http is None:
            return {"submitted": False, "error": "no credentials for HTTP config lane"}
        merged = {**edits, **_FORCED_CONFIG}
        diff: dict[str, dict[str, str | None]] = {}
        last_error: str | None = None
        for attempt in range(_PERSIST_RETRIES + 1):
            # a preset switch (or a prior attempt) just restarted the daemon and the
            # active label flips before the restart finishes — wait for the HTTP lane
            # to actually serve before writing, rather than racing it
            await self._await_http_ready()
            try:
                intended = await self._restore_once(merged)
            except presetconf.GroundingError as exc:
                return {"submitted": False, "error": str(exc)}
            except httpx.HTTPError as exc:
                last_error = str(exc)  # daemon dropped mid-write: transient, retry
                await self._sleep(RECONNECT_FAST)
                continue
            diff = _config_diff(intended, await self._verify_persistent(intended))
            if not diff:
                return {"submitted": True, "applied": True, "attempts": attempt + 1, "active": self.active_config}
            unfixable = await self._unfixable_device(diff)
            if unfixable:
                result = {"applied": False, "reason": "unavailable", "unfixable": unfixable, "diff": diff}
                return {"submitted": True, **result}
        if last_error is not None and not diff:
            return {"submitted": False, "error": last_error}  # never got a write through
        return {"submitted": True, "applied": False, "reason": "unconverged", "diff": diff}

    async def _restore_once(self, merged: dict[str, str]) -> dict[str, str]:
        """Build a restore archive (active snapshot ⊕ edits) from a fresh backup,
        push it, and return the intended config it should produce. Raises
        GroundingError (bad edit) or httpx.HTTPError (daemon dropped mid-write)."""
        backup = await self._backup_or_cached()
        self._persist_backup(backup)  # survives a crash mid-apply
        restore_zip, intended_xml = presetconf.restore_zip_from_snapshot(backup, self.active_config, merged)
        await self._require_http().restore(restore_zip, scope="system")
        return presetconf.read_config(intended_xml)

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

    async def _verify_persistent(self, intended: dict[str, str]) -> dict[str, str]:
        """Poll a fresh /backup until the running config reflects every intended
        field, or the alarm deadline passes. Returns the last realized config
        (read from the backup's base hqplayerd.xml) so the caller can diff it."""
        deadline = time.monotonic() + self._cfg.alarm_threshold
        realized: dict[str, str] = {}
        while time.monotonic() < deadline:
            await self._sleep(RECONNECT_FAST)
            try:
                fresh = await self._require_http().backup()
            except httpx.HTTPError:
                continue
            if fresh[:4] != b"PK\x03\x04":  # mid-restart: not a zip yet
                continue
            realized = presetconf.read_config(engineconf.base_config_xml(fresh))
            if all(realized.get(key) == want for key, want in intended.items()):
                return realized
        return realized

    async def _unfixable_device(self, diff: dict[str, dict[str, str | None]]) -> dict[str, Any]:
        """A divergence is unfixable only when the intended net_device is no
        longer in the daemon's endpoint list — the target NAA endpoint is gone,
        and no restart brings it back. Everything else is correctable by retry."""
        if presetconf.NET_DEVICE not in diff:
            return {}
        want = diff[presetconf.NET_DEVICE]["want"]
        try:
            form = await self._require_http().get_config()
        except httpx.HTTPError:
            return {}
        field = next((f for f in form["fields"] if f.get("name") == "net_device"), None)
        options = {o.get("value") for o in (field or {}).get("options", [])}
        if want in options:
            return {}
        return {"net_device": {"want": want, "available": sorted(o for o in options if o)}}

    async def read_engine(self) -> dict[str, str]:
        """Current hardware-accel engine attributes, parsed from a fresh backup's
        base config (the only lane that carries them — they are not on the form).
        Fetched on demand, not per poll, since the backup archive is large."""
        engine = engineconf.read_engine_attrs(engineconf.base_config_xml(await self._backup_or_cached()))
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
            backup = await self._backup_or_cached()
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
