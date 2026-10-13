#!/usr/bin/env python3
"""What hqplayerd does with a ``POST /restore`` that carries no ``scope`` field.

Idle-gated. Captures the running archive, pushes a copy whose only change is the
``<title>`` value, with ``cfgfile`` and no ``scope``, then reports the HTTP
status, the log lines the daemon wrote for it and whether a fresh ``/backup``
shows the marker. Always pushes the captured archive back with ``scope=system``
and proves the working config byte-identical, and ``State`` unchanged, by
readback. The captured archive stays at ``$PROBE_OUT/hqptuner-probe/`` for
``restore_pristine.py``.

    set -a; source hqpcreds; set +a
    .venv/bin/python scripts/probes/probe_restore_no_scope.py
"""

import asyncio
import io
import os
import sys
import tempfile
import zipfile
from contextlib import suppress
from pathlib import Path

import httpx

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.engine.control import ControlClient
from hqptuner.engine.logtail import fetch_log

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
CONTROL_PORT = int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321"))
OUT = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / "hqptuner-probe"
MARKER = "Opal-scope-probe"
STATE_KEYS = ("mode", "filter1x", "filterNx", "shaper", "rate", "volume")
SETTLE_TRIES = 60
SETTLE_WAIT = 1.0
LANDED_TRIES = 30


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


async def _state() -> tuple[dict[str, str], str | None]:
    control = ControlClient(HOST, CONTROL_PORT)
    await control.connect()
    state = await control.get_state()
    active = (await control.get_active_config()) or None
    await control.close()
    return state, active


def _title(xml: bytes) -> str:
    start = xml.index(b'<title value="') + len(b'<title value="')
    return xml[start : xml.index(b'"', start)].decode()


async def _landed(http: HttpConfigClient, active: str | None) -> str:
    """Poll /backup for the marker title; return the last title read."""
    title = ""
    for _ in range(LANDED_TRIES):
        with suppress(httpx.HTTPError, OSError, ValueError):
            title = _title(engineconf.base_config_xml(await http.backup(), active))
        if title == MARKER:
            return title
        await asyncio.sleep(SETTLE_WAIT)
    return title


async def _probe(http: HttpConfigClient, pristine: bytes, active: str | None) -> None:
    name = engineconf.running_config_name(zipfile.ZipFile(io.BytesIO(pristine)).namelist(), active)
    if name is None:
        message = "no working config member in the archive"
        raise CliError(message)
    xml = engineconf.base_config_xml(pristine, active)
    print(f"working member {name!r}, title {_title(xml)!r}")
    marked = xml.replace(f'<title value="{_title(xml)}"/>'.encode(), f'<title value="{MARKER}"/>'.encode(), 1)
    archive = engineconf.rewrite_zip(pristine, {name: marked})
    log_before = len((await fetch_log(HOST, HTTP_PORT)).splitlines())
    # HttpConfigClient.restore always sends a scope, which is the field under test;
    # this is the same Digest-authenticated httpx POST without it
    auth = httpx.DigestAuth(os.environ["HQPTUNER_HQP_USERNAME"], os.environ["HQPTUNER_HQP_PASSWORD"])
    try:
        async with httpx.AsyncClient(base_url=f"http://{HOST}:{HTTP_PORT}", auth=auth, timeout=60.0) as raw:
            resp = await raw.post("/restore", files={"cfgfile": ("settings.zip", archive, "application/zip")})
        resp.raise_for_status()
        print(f"POST /restore without scope: HTTP {resp.status_code}")
    except httpx.HTTPStatusError as exc:
        print(f"POST /restore without scope: HTTP {exc.response.status_code}")
    except httpx.HTTPError as exc:
        print(f"POST /restore without scope: transport {type(exc).__name__}: {exc}")
    await asyncio.sleep(SETTLE_WAIT)
    await _settle(http)
    print(f"title after: {await _landed(http, active)!r} (marker {MARKER!r})")
    new_lines = (await fetch_log(HOST, HTTP_PORT)).splitlines()[log_before:]
    print("log lines since the POST:")
    for line in new_lines:
        if "onfiguration" in line or "estor" in line or "cope" in line:
            print(f"  {line.strip()}")


async def _run() -> int:
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        message = "set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)"
        raise CliError(message)
    state, active = await _state()
    if state.get("state") != "0":
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to write"
        raise CliError(message)
    before = {key: state.get(key) for key in STATE_KEYS}
    http = HttpConfigClient(HOST, HTTP_PORT, user, password, HttpOptions(timeout=60.0))
    await _settle(http)
    pristine = await http.backup()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "pristine-settings.zip").write_bytes(pristine)
    want = engineconf.base_config_xml(pristine, active)
    try:
        await _probe(http, pristine, active)
    finally:
        await _settle(http)
        await http.restore(pristine, scope="system")
        await asyncio.sleep(SETTLE_WAIT)
        await _settle(http)
        got = engineconf.base_config_xml(await http.backup(), active)
        print(f"rollback: working config byte-identical to the capture: {got == want}")
        await http.aclose()
    after_state, _ = await _state()
    after = {key: after_state.get(key) for key in STATE_KEYS}
    print(f"rollback: State unchanged: {after == before}" + ("" if after == before else f" {before} -> {after}"))
    return 0 if got == want and after == before else 1


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
