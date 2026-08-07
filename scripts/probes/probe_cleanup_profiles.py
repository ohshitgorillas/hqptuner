#!/usr/bin/env python3
"""Delete probe-authored ``<matrix_profile>`` elements from the running config.

``POST /matrix/save`` landed ``hqptuner-probe-post`` in the config file, so it
survives a restart and has to be removed by name. Readback-verified: the profile
list after the restore is the proof, never the POST's 200.

    .venv/bin/python scripts/probes/probe_cleanup_profiles.py
"""

import asyncio
import io
import os
import re
import sys
import zipfile
from collections.abc import Awaitable, Callable

import httpx

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.conf.matrixconf import delete_profile
from hqptuner.engine.control import ControlClient

DOOMED = (os.environ.get("PROBE_DOOMED") or "hqptuner-probe,hqptuner-probe-post").split(",")
HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
SETTLE_TRIES = 40
SETTLE_WAIT = 1.0


async def _settle(http: HttpConfigClient) -> None:
    for _ in range(SETTLE_TRIES):
        try:
            await http.get_config()
            return
        except (httpx.HTTPError, OSError):
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit("daemon never came back")


async def _rpc[T](make: Callable[[], Awaitable[T]]) -> T:
    last: Exception | None = None
    for _ in range(SETTLE_TRIES):
        try:
            return await make()
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit(f"daemon never answered: {last}")


def _names(xml: bytes) -> list[str]:
    return [m.decode() for m in re.findall(rb'<matrix_profile\b[^>]*name="([^"]*)"', xml)]


async def main() -> int:
    """Delete the named probe-authored matrix profiles from the running config and confirm their removal by readback."""
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        raise SystemExit("set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)")

    control = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    await control.connect()
    state = await control.get_state()
    if state.get("state") != "0":
        raise SystemExit(f"engine is not stopped (state={state.get('state')!r}) — refusing to write")
    active = (await control.get_active_config()) or None
    await control.close()

    http = HttpConfigClient(HOST, HTTP_PORT, user, password, timeout=120.0)
    backup = await _rpc(http.backup)
    xml = engineconf.base_config_xml(backup, active)
    before = _names(xml)
    print(f"profiles before: {before}")
    doomed = [name for name in DOOMED if name in before]
    if not doomed:
        print("nothing to clean")
        return 0

    for name in doomed:
        xml = delete_profile(xml, name)
    with zipfile.ZipFile(io.BytesIO(backup)) as z:
        member = engineconf.running_config_name(z.namelist(), active)
    if member is None:
        raise SystemExit("cannot resolve the working config member")
    await _rpc(lambda: http.restore(engineconf.rewrite_zip(backup, {member: xml}), scope="system"))
    await _settle(http)

    after = _names(engineconf.base_config_xml(await _rpc(http.backup), active))
    print(f"profiles after: {after}")
    print(f"removed {doomed}: {all(name not in after for name in doomed)}")
    return 0 if all(name not in after for name in doomed) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
