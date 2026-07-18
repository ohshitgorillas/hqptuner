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

Persistent config only changes through a daemon restart (POST /config and
profile load both restart it), and any restart drops the 4321 connection —
so refreshing the /config snapshot on reconnect keeps it consistent without
periodic refetching.
"""

import asyncio
import contextlib
import logging
import time
from pathlib import Path
from typing import Any

import httpx

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
        self.state: dict[str, str] | None = None
        self.status: dict[str, str] | None = None
        self.status_metadata: dict[str, str] | None = None
        self.volume_range: dict[str, str] | None = None
        self.enums: dict[str, list[dict[str, str]]] | None = None
        self.config_form: dict[str, Any] | None = None
        self.config_error: str | None = None
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
        state = await client.get_state()
        status, meta = await client.get_status()
        vrange = await client.get_volume_range()
        enums = await client.get_all_enumerations()

        config_form = None
        config_error = None
        if self._http is not None:
            # 8088 lane failing must not take down the 4321 lane
            try:
                config_form = await self._http.get_config()
            except Exception as exc:
                config_error = str(exc)
                log.warning("GET /config failed: %s", exc)

        self._client = client
        self.info, self.state, self.status, self.status_metadata = info, state, status, meta
        self.volume_range = vrange
        self.enums = enums
        self.config_form, self.config_error = config_form, config_error
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
        self.loaded_at = time.time()

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
        http_report = await self._apply_http(http_fields) if http_fields else None
        return {"live": live_report, "http": http_report}

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
            verified = await self._verify_http(overrides)  # daemon restarts; read back
        except httpx.HTTPError as exc:
            return {"submitted": False, "error": str(exc)}
        return {
            "submitted": True,
            "verified": verified,
            "backup_bytes": len(backup),
            "backup_path": str(backup_path) if backup_path else None,
        }

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

    async def _verify_http(self, overrides: dict[str, str]) -> dict[str, Any]:
        """Poll GET /config until it REFLECTS the overrides, not merely until it
        responds: right after the POST the daemon still serves the pre-restart
        form for a moment, then drops, then returns with the new config. Retrying
        only on connection error would read that stale form and false-negative.
        A genuine rejection never reflects, so it times out as not-applied.

        On timeout the failure reason is read off the LAST poll: a daemon still
        serving a clean form that never reflects the change was a "rejected"
        apply; one that ends unreachable (connection error at the deadline) is
        "unreachable" — it accepted the POST and never came back. The caller
        needs that split to tell a bad value from a crashed restart."""
        http = self._require_http()
        deadline = time.monotonic() + self._cfg.alarm_threshold
        mismatches = dict(overrides)
        last_error: str | None = None
        while time.monotonic() < deadline:
            try:
                after = {f["name"]: f for f in (await http.get_config())["fields"]}
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
