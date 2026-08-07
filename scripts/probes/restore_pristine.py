#!/usr/bin/env python3
"""Restore the archive `probe_absent_plugin.py` captured before it wrote anything.

The probe reverts in its own `finally`, but a connection error inside the restart
window can take the revert down with it. This is the standalone recovery: push
the pristine archive back and prove byte-identity of the working config by
readback, never by the POST's 200.

    .venv/bin/python scripts/probes/restore_pristine.py
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

import httpx

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.engine.control import ControlClient

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
ARCHIVE = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / "hqptuner-probe" / "pristine-settings.zip"
SETTLE_TRIES = 60
SETTLE_WAIT = 1.0


async def _settle(http: HttpConfigClient) -> None:
    for _ in range(SETTLE_TRIES):
        try:
            await http.get_config()
            return
        except (httpx.HTTPError, OSError):
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit("daemon never came back")


async def main() -> int:
    """Restore the pristine archive over the daemon's settings and report whether the readback matches it exactly."""
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        raise SystemExit("set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)")
    if not ARCHIVE.is_file():
        raise SystemExit(f"no pristine archive at {ARCHIVE}")
    pristine = ARCHIVE.read_bytes()

    control = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    await control.connect()
    state = await control.get_state()
    active = (await control.get_active_config()) or None
    await control.close()
    if state.get("state") != "0":
        raise SystemExit(f"engine is not stopped (state={state.get('state')!r}) — refusing to write")

    want = engineconf.base_config_xml(pristine, active)
    http = HttpConfigClient(HOST, HTTP_PORT, user, password, timeout=60.0)
    await _settle(http)
    await http.restore(pristine, scope="system")
    await _settle(http)
    got = engineconf.base_config_xml(await http.backup(), active)
    print(f"working config byte-identical to the pristine capture: {got == want}")
    if got != want:
        print(f"  captured {len(want)} bytes, running {len(got)} bytes")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
