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
from typing import Any

from .config import Config
from .control import ControlClient, ControlError
from .httpconf import HttpConfigClient

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0
RECONNECT_SLOW = 5.0


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
        self.enums: dict[str, list[dict[str, str]]] | None = None
        self.config_form: dict[str, Any] | None = None
        self.config_error: str | None = None
        self.loaded_at: float | None = None

    @property
    def alarm(self) -> bool:
        return (
            not self.reachable
            and time.monotonic() - self._unreachable_mono > self._cfg.alarm_threshold
        )

    def stop(self) -> None:
        self._stop.set()

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
        client = ControlClient(
            self._cfg.hqp_host, self._cfg.hqp_control_port, self._cfg.request_timeout
        )
        await client.connect()
        info = await client.get_info()  # the handshake — this defines "reachable"
        state = await client.get_state()
        status, meta = await client.get_status()
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
        self.enums = enums
        self.config_form, self.config_error = config_form, config_error
        self.loaded_at = time.time()
        self.reachable = True
        self.unreachable_since = None
        log.info(
            "connected: %s engine %s", info.get("name"), info.get("engine") or info.get("version")
        )

    async def _poll(self) -> None:
        client = self._client
        if client is None:
            raise ControlError("not connected")
        state = await client.get_state()
        # mode switch swaps the enumeration lists wholesale (outline §5) —
        # re-enumerate rather than serve stale lists
        if self.state is not None and state.get("mode") != self.state.get("mode"):
            log.info(
                "mode changed (%s -> %s), re-enumerating", self.state.get("mode"), state.get("mode")
            )
            self.enums = await client.get_all_enumerations()
        status, meta = await client.get_status()
        self.state, self.status, self.status_metadata = state, status, meta
        self.loaded_at = time.time()

    def current_mode_name(self) -> str:
        if not self.state or not self.enums:
            return ""
        idx = self.state.get("mode", "")
        for item in self.enums.get("modes", []):
            if item.get("index") == idx:
                return item.get("name", "")
        return ""
