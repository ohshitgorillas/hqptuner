#!/usr/bin/env python3
"""Probe: does a ``<matrix_profile>`` carry its own ``<post_process>``?

``MatrixSetProfile`` was believed to leave post-processing alone. It does not:
with a profile loaded, the running engine reports the correction plugin off
while the config file carries it on. ``<post_process>`` is a sub-element of
``<matrix>`` (readme §1.11.2) and §1.12 defines ``matrix_profile`` by reference
to §1.11, so the switch plausibly installs the profile's whole matrix context —
and HQPTuner writes profiles with ``<pipeline>`` rows only. Two questions decide
whether mirroring the preset's post-process into every saved profile is a fix:

  Q1  does the daemon KEEP a ``<post_process>`` HQPTuner authored inside a
      ``<matrix_profile>``, or strip it when it rewrites the config?
  Q2  does ``MatrixSetProfile`` INSTALL that post-process into the running
      engine?

Read-write-restore against the live daemon. Only addition is one probe profile;
every existing element is left alone, and the pristine archive captured up front
is pushed back and verified byte-identical at the end. Every step is confirmed by
readback — an HTTP 200 is not proof (protocol.md §3.6).

Aborts before any write unless the engine is stopped.

    .venv/bin/python scripts/probes/probe_profile_post_process.py
"""

import asyncio
import io
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.engine.control import ControlClient

PROFILE = "hqptuner-probe"
HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
OUT = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / "hqptuner-probe"
SETTLE_TRIES = 40
SETTLE_WAIT = 1.0


def _restart_daemon() -> None:
    """Restart hqplayerd. A config restore does NOT restart it (probe run 1: the
    unit's uptime was untouched across a restore), and the saved-profile registry
    is built at process start only — so a profile written into the config is
    invisible to ``MatrixListProfiles`` until the daemon comes back."""
    subprocess.run(["/usr/bin/sudo", "systemctl", "restart", "hqplayerd"], check=True)


async def _settle(http: HttpConfigClient) -> None:
    for _ in range(SETTLE_TRIES):
        try:
            await http.get_config()
            return
        except (httpx.HTTPError, OSError):
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit("daemon never came back after a restore")


async def _rpc[T](make: Callable[[], Awaitable[T]]) -> T:
    """Any daemon call, retried through a restart window."""
    last: Exception | None = None
    for _ in range(SETTLE_TRIES):
        try:
            return await make()
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit(f"daemon never answered: {last}")


async def _working(http: HttpConfigClient, active: str | None) -> bytes:
    return engineconf.base_config_xml(await _rpc(http.backup), active)


async def _push(http: HttpConfigClient, backup: bytes, working: bytes, active: str | None) -> bytes:
    with zipfile.ZipFile(io.BytesIO(backup)) as z:
        member = engineconf.running_config_name(z.namelist(), active)
    if member is None:
        raise SystemExit("cannot resolve the working config member")
    archive = engineconf.rewrite_zip(backup, {member: working})
    await _rpc(lambda: http.restore(archive, scope="system"))
    await _settle(http)
    return await _working(http, active)


def _matrix_body(xml: bytes) -> bytes:
    m = re.search(rb"<matrix\b[^>]*>", xml)
    if m is None or m.group(0).endswith(b"/>"):
        raise SystemExit("the running config has no <matrix> body")
    close = xml.find(b"</matrix>", m.end())
    return xml[m.end() : close]


def _post_process_block(body: bytes) -> bytes:
    m = re.search(rb"[ \t]*<post_process>.*?</post_process>", body, re.DOTALL)
    if m is None:
        raise SystemExit("the running config's matrix carries no <post_process>")
    return m.group(0)


def _profile_element(xml: bytes, name: str) -> bytes | None:
    m = re.search(
        rb'<matrix_profile\b[^>]*name="' + re.escape(name.encode()) + rb'"(?:[^>]*/>|[^>]*>.*?</matrix_profile>)',
        xml,
        re.DOTALL,
    )
    return m.group(0) if m else None


def _with_probe_profile(xml: bytes, carry_post: bool = True) -> bytes:
    """Insert one probe profile: the live pipeline rows, plus (unless
    ``carry_post`` is off) a verbatim copy of the live post-process block.
    Nothing else in the snapshot moves.

    The rows-only variant is the control: if THAT profile registers and the
    post-process one does not, the daemon's parser is rejecting the element."""
    if _profile_element(xml, PROFILE) is not None:
        raise SystemExit(f"a {PROFILE!r} profile is already in the config — clean it out first")
    body = _matrix_body(xml)
    rows = b"".join(m.group(0) for m in re.finditer(rb"\n?[ \t]*<pipeline\b[^>]*/>", body))
    post = _post_process_block(body)
    anchor = re.search(rb"(?:\n([ \t]*))?<matrix\b", xml)
    if anchor is None:
        raise SystemExit("the matrix element is absent")
    indent = anchor.group(1)
    lead = b"" if indent is None else b"\n" + indent
    tail = lead + post if carry_post else b""
    block = lead + f'<matrix_profile name="{PROFILE}">'.encode() + rows + tail + lead + b"</matrix_profile>"
    return xml[: anchor.start()] + block + xml[anchor.start() :]


def _correction(fields: list[dict[str, object]]) -> dict[str, object]:
    return {f["name"]: f.get("value") for f in fields if str(f.get("name", "")).startswith("post_correction")}


async def main() -> int:
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        raise SystemExit("set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)")

    control = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    await control.connect()
    state = await control.get_state()
    if state.get("state") != "0":
        raise SystemExit(f"engine is not stopped (state={state.get('state')!r}) — refusing to write")
    original_profile = state.get("matrix_profile", "")
    print(f"engine idle; active matrix profile {original_profile!r}")

    http = HttpConfigClient(HOST, HTTP_PORT, user, password, timeout=60.0)
    active = (await control.get_active_config()) or None
    pristine = await _rpc(http.backup)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "pristine-settings.zip").write_bytes(pristine)
    print(f"pristine archive saved to {OUT / 'pristine-settings.zip'} ({len(pristine)} bytes)")

    before = _correction((await _rpc(http.get_matrix))["fields"])
    print(f"running correction BEFORE: {before}")

    rc = 0
    try:
        carry_post = os.environ.get("PROBE_VARIANT", "post") != "rows"
        print(f"variant: probe profile {'WITH' if carry_post else 'WITHOUT'} a <post_process>")
        working = engineconf.base_config_xml(pristine, active)
        got = await _push(http, pristine, _with_probe_profile(working, carry_post), active)

        # Q1 — did the daemon keep the post-process we authored inside the profile?
        element = _profile_element(got, PROFILE)
        kept = element is not None and b"<post_process>" in element
        print(f"Q1 daemon keeps <post_process> inside <matrix_profile>: {kept}")
        if element is not None:
            print(f"  profile as the daemon now holds it:\n{element.decode(errors='replace')}")

        # Q2 — does a live switch install it into the running engine? The registry
        # only rebuilds at process start, so the daemon has to come back first.
        _restart_daemon()
        await _settle(http)
        # the registry lands after the reload settles; an immediate list is stale
        names: list[str] = []
        for _ in range(30):
            await control.close()
            await control.connect()
            names = await control.get_matrix_profiles()
            if PROFILE in names:
                break
            await asyncio.sleep(1.0)
        print(f"probe profile reachable by a live switch: {PROFILE in names}")
        print(f"profiles the daemon registered ({len(names)}): {names}")
        in_file = re.findall(rb'<matrix_profile\b[^>]*name="([^"]*)"', got)
        print(f"profiles in the config file ({len(in_file)}): {[n.decode() for n in in_file]}")
        if PROFILE in names:
            await control.set_matrix_profile(PROFILE)
            after = _correction((await _rpc(http.get_matrix))["fields"])
            print(f"running correction AFTER the switch: {after}")
            print(f"Q2 MatrixSetProfile installs the profile's post-process: {after != before}")
        else:
            print("Q2 unanswered — the daemon never registered the probe profile")
            rc = 1
    finally:
        back = await _push(http, pristine, engineconf.base_config_xml(pristine, active), active)
        identical = back == engineconf.base_config_xml(pristine, active)
        print(f"config restored byte-identical to the pristine capture: {identical}")
        # second restart: the probe profile is still in the daemon's memory
        # registry until the process comes back on the pristine config
        _restart_daemon()
        await _settle(http)
        await control.close()
        await control.connect()
        await control.set_matrix_profile(original_profile)
        readback = (await control.get_state()).get("matrix_profile", "")
        print(f"matrix profile restored to {readback!r}: {readback == original_profile}")
        await control.close()
        if not identical or readback != original_profile:
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
