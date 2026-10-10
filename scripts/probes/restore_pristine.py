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
from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.engine.control import ControlClient

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
ARCHIVE = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / "hqptuner-probe" / "pristine-settings.zip"
SETTLE_TRIES = 60
SETTLE_WAIT = 1.0


class CliError(Exception):
    """A condition that stops this probe cold; `main` prints it and owns the exit code."""


async def _settle(http: HttpConfigClient) -> None:
    for _ in range(SETTLE_TRIES):
        try:
            await http.get_config()
            return
        except (httpx.HTTPError, OSError):
            await asyncio.sleep(SETTLE_WAIT)
    message = "daemon never came back"
    raise CliError(message)


async def _run() -> int:
    """Restore the pristine archive over the daemon's settings and report whether the readback matches it exactly."""
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        message = "set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)"
        raise CliError(message)
    if not ARCHIVE.is_file():
        message = f"no pristine archive at {ARCHIVE}"
        raise CliError(message)
    pristine = ARCHIVE.read_bytes()

    control = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    await control.connect()
    state = await control.get_state()
    active = (await control.get_active_config()) or None
    await control.close()
    if state.get("state") != "0":
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to write"
        raise CliError(message)

    want = engineconf.base_config_xml(pristine, active)
    http = HttpConfigClient(HOST, HTTP_PORT, user, password, HttpOptions(timeout=60.0))
    await _settle(http)
    await http.restore(pristine, scope="system")
    await _settle(http)
    got = engineconf.base_config_xml(await http.backup(), active)
    print(f"working config byte-identical to the pristine capture: {got == want}")
    if got != want:
        print(f"  captured {len(want)} bytes, running {len(got)} bytes")
        return 1
    return 0


async def main() -> int:
    """Run the probe, turning a `CliError` into a printed reason and exit code 1."""
    errors: list[CliError] = []
    result = 0
    try:
        result = await _run()
    except CliError as exc:
        errors.append(exc)
    if errors:
        print(errors[0], file=sys.stderr)
        return 1
    return result


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
