#!/usr/bin/env python3
"""Delete probe-authored ``<matrix_profile>`` elements from the running config.

``POST /matrix/save`` landed ``hqptuner-probe-post`` in the config file, so it
survives a restart and has to be removed by name. Readback-verified: the profile
list after the restore is the proof, never the POST's 200.

    .venv/bin/python scripts/probes/probe_cleanup_profiles.py
"""

import asyncio
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "kit"))

from probekit import CliError, connect_state, credentials, open_http, push, rpc, run_cli

from hqptuner.conf import engineconf
from hqptuner.conf.matrixprofiles import delete_profile

DOOMED = (os.environ.get("PROBE_DOOMED") or "hqptuner-probe,hqptuner-probe-post").split(",")


def _names(xml: bytes) -> list[str]:
    return [m.decode() for m in re.findall(rb'<matrix_profile\b[^>]*name="([^"]*)"', xml)]


async def _run() -> int:
    """Delete the named probe-authored matrix profiles from the running config and confirm their removal by readback."""
    user, password = credentials()

    control, state = await connect_state()
    if state.get("state") != "0":
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to write"
        raise CliError(message)
    active = (await control.get_active_config()) or None
    await control.close()

    http = open_http(user, password, 120.0)
    backup = await rpc(http.backup)
    xml = engineconf.base_config_xml(backup, active)
    before = _names(xml)
    print(f"profiles before: {before}")
    doomed = [name for name in DOOMED if name in before]
    if not doomed:
        print("nothing to clean")
        return 0

    for name in doomed:
        xml = delete_profile(xml, name)
    after = _names(await push(http, backup, xml, active))
    print(f"profiles after: {after}")
    print(f"removed {doomed}: {all(name not in after for name in doomed)}")
    return 0 if all(name not in after for name in doomed) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(run_cli(_run)))
