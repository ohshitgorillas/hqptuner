#!/usr/bin/env python3
"""Restore the archive `probe_absent_plugin.py` captured before it wrote anything.

The probe reverts in its own `finally`, but a connection error inside the restart
window can take the revert down with it. This is the standalone recovery: push
the pristine archive back and prove byte-identity of the working config by
readback, never by the POST's 200.

    .venv/bin/python scripts/probes/restore_pristine.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "kit"))

from probekit import ARCHIVE, CliError, connect_state, credentials, open_http, settle

from hqptuner.conf import engineconf

SETTLE_TRIES = 60


async def _run() -> int:
    """Restore the pristine archive over the daemon's settings and report whether the readback matches it exactly."""
    user, password = credentials()
    if not ARCHIVE.is_file():
        message = f"no pristine archive at {ARCHIVE}"
        raise CliError(message)
    pristine = ARCHIVE.read_bytes()

    control, state = await connect_state()
    active = (await control.get_active_config()) or None
    await control.close()
    if state.get("state") != "0":
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to write"
        raise CliError(message)

    want = engineconf.base_config_xml(pristine, active)
    http = open_http(user, password, 60.0)
    await settle(http, SETTLE_TRIES)
    await http.restore(pristine, scope="system")
    await settle(http, SETTLE_TRIES)
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
