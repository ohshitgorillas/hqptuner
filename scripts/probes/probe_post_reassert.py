#!/usr/bin/env python3
"""Probe: can a wiped post-process be re-asserted after a live profile switch,
and what does the re-assert cost?

``MatrixSetProfile`` installs the profile's whole matrix context, and every
profile HQPTuner writes is ``<pipeline>`` rows only — so a switch clears the
running post-process (probe_profile_post_process.py, Q2). 4321 has no
post-process verb (protocol.md §151), leaving one lane: a complete
``POST /matrix``. Two things decide whether that is a usable fix:

  Q3  does the POST PERSIST the profile's rows into the working config XML —
      i.e. does re-asserting turn a memory-only Load into a permanent one?
  Q4  does the POST actually RESTORE the correction plugin in the running
      engine after a switch cleared it?

Switch-post-restore against the live daemon, every step readback-verified. The
pristine archive captured up front is pushed back and the daemon restarted at
the end, so the memory-only switch is undone too.

Aborts before any write unless the engine is stopped.

    .venv/bin/python scripts/probes/probe_post_reassert.py
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
from hqptuner.conf.httpconf import HttpConfigClient, serialize_matrix_form
from hqptuner.engine.control import ControlClient

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
OUT = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / "hqptuner-probe"
SETTLE_TRIES = 40
SETTLE_WAIT = 1.0


def _restart_daemon() -> None:
    subprocess.run(["/usr/bin/sudo", "systemctl", "restart", "hqplayerd"], check=True)


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


async def _working(http: HttpConfigClient, active: str | None) -> bytes:
    return engineconf.base_config_xml(await _rpc(http.backup), active)


def _rows(xml_or_body: bytes) -> list[bytes]:
    return [m.group(0) for m in re.finditer(rb"<pipeline\b[^>]*/>", xml_or_body)]


def _matrix_rows(xml: bytes) -> list[bytes]:
    m = re.search(rb"<matrix\b[^>]*>", xml)
    if m is None or m.group(0).endswith(b"/>"):
        return []
    return _rows(xml[m.end() : xml.find(b"</matrix>", m.end())])


def _profile_rows(xml: bytes, name: str) -> list[bytes]:
    m = re.search(
        rb'<matrix_profile\b[^>]*name="' + re.escape(name.encode()) + rb'"[^>]*>(.*?)</matrix_profile>',
        xml,
        re.DOTALL,
    )
    return _rows(m.group(1)) if m else []


def _correction(fields: list[dict[str, object]]) -> dict[str, object]:
    return {str(f["name"]): f.get("value") for f in fields if str(f.get("name", "")).startswith("post_correction")}


async def _post_matrix(client: httpx.AsyncClient, overlay: dict[str, str]) -> None:
    """Echo the daemon's own /matrix form back complete, with ``overlay`` applied.
    Checkbox contract enforced: ``1`` when on, OMITTED when off — a stray ``on``
    or ``0`` is written verbatim and wedges engine init (matrix-spec.md:99)."""
    form = await client.get("/matrix")
    form.raise_for_status()
    fields, _ = serialize_matrix_form(form.text)
    if not fields:
        raise SystemExit("GET /matrix served no form fields — the POST would be a silent no-op")
    for key, value in overlay.items():
        fields[key] = value
    for key in [k for k, v in fields.items() if v in ("0", "on", "")]:
        if key.endswith("enabled"):
            fields.pop(key)
    print(
        f"  POST /matrix with {len(fields)} fields; correction slice: "
        f"{ {k: v for k, v in fields.items() if k.startswith('post_correction')} }"
    )
    # the form is enctype="multipart/form-data" (it carries the filter file
    # inputs); a urlencoded POST is accepted with HTTP 200 and silently ignored
    resp = await client.post("/matrix", files={k: (None, v) for k, v in fields.items()})
    print(f"  POST /matrix -> HTTP {resp.status_code}")


async def main() -> int:  # noqa: C901 — probe: one linear script, read top to bottom
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        raise SystemExit("set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)")
    target = os.environ.get("PROBE_PROFILE", "stereo")

    control = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    await control.connect()
    state = await control.get_state()
    if state.get("state") != "0":
        raise SystemExit(f"engine is not stopped (state={state.get('state')!r}) — refusing to write")
    original_profile = state.get("matrix_profile", "")

    http = HttpConfigClient(HOST, HTTP_PORT, user, password, timeout=60.0)
    active = (await control.get_active_config()) or None
    pristine = await _rpc(http.backup)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "pristine-settings.zip").write_bytes(pristine)
    before_xml = engineconf.base_config_xml(pristine, active)
    config_rows = _matrix_rows(before_xml)
    target_rows = _profile_rows(before_xml, target)
    print(f"engine idle; active profile {original_profile!r}; switching to {target!r}")
    print(f"config <matrix> rows: {len(config_rows)}; {target!r} profile rows: {len(target_rows)}")
    if not target_rows or config_rows == target_rows:
        raise SystemExit(f"{target!r} is not a discriminating target — pick one whose rows differ")

    # PROBE_MODE=toggle is the control: no profile switch at all, just flip the
    # correction plugin off and on through the same POST path. If THAT does not
    # move, the POST mechanics are wrong and the re-assert result means nothing.
    mode = os.environ.get("PROBE_MODE", "reassert")
    rc = 0
    try:
        if mode == "toggle":
            async with httpx.AsyncClient(
                base_url=f"http://{HOST}:{HTTP_PORT}", auth=httpx.DigestAuth(user, password), timeout=120.0
            ) as raw:
                start = _correction((await _rpc(http.get_matrix))["fields"])
                print(f"correction at rest: {start}")
                await _post_matrix(raw, {"post_correction_enabled": "0"})
                await _settle(http)
                # the reload takes ~6.5 s (matrix-spec.md:95) and /config keeps
                # serving through it, so poll the form rather than read once
                off = start
                for _ in range(20):
                    off = _correction((await _rpc(http.get_matrix))["fields"])
                    if off != start:
                        break
                    await asyncio.sleep(1.0)
                in_file = re.search(rb'<plugin[^>]*type="correction"/>', await _working(http, active))
                found = in_file.group(0) if in_file else None
                print(f"correction in the config file after the POST: {found!r}")
                print(f"correction after a POST turning it OFF: {off}")
                print(f"CONTROL POST /matrix can change the running post-process: {off != start}")
            return rc
        await control.set_matrix_profile(target)
        cleared = _correction((await _rpc(http.get_matrix))["fields"])
        print(f"correction after the switch (expect wiped): {cleared}")

        dac = os.environ.get("PROBE_DAC", "Holo Audio Cyan 2")
        async with httpx.AsyncClient(
            base_url=f"http://{HOST}:{HTTP_PORT}", auth=httpx.DigestAuth(user, password), timeout=120.0
        ) as raw:
            await _post_matrix(raw, {"post_correction_enabled": "1", "post_correction_dac0": dac})
        await _settle(http)

        # Q4 — is the correction plugin running again? Poll past the reload.
        restored = cleared
        for _ in range(20):
            restored = _correction((await _rpc(http.get_matrix))["fields"])
            if restored != cleared:
                break
            await asyncio.sleep(1.0)
        print(f"correction after the re-assert POST: {restored}")
        print(f"Q4 POST /matrix restores the wiped post-process: {restored != cleared}")

        # Q3 — did the POST persist the profile's rows into the working config?
        after_xml = await _working(http, active)
        after_rows = _matrix_rows(after_xml)
        print(f"config <matrix> rows after the POST: {len(after_rows)}")
        print(f"Q3 POST persists the profile's rows into the config: {after_rows == target_rows}")
        print(f"   (config rows unchanged from before the load: {after_rows == config_rows})")
    finally:
        with zipfile.ZipFile(io.BytesIO(pristine)) as z:
            member = engineconf.running_config_name(z.namelist(), active)
        if member is None:
            raise SystemExit("cannot resolve the working config member")
        archive = engineconf.rewrite_zip(pristine, {member: before_xml})
        await _rpc(lambda: http.restore(archive, scope="system"))
        await _settle(http)
        back = await _working(http, active)
        identical = back == before_xml
        print(f"config restored byte-identical to the pristine capture: {identical}")
        _restart_daemon()
        await _settle(http)
        await control.close()
        await control.connect()
        if original_profile:
            await control.set_matrix_profile(original_profile)
        readback = (await control.get_state()).get("matrix_profile", "")
        print(f"matrix profile restored to {readback!r}: {readback == original_profile}")
        final = _correction((await _rpc(http.get_matrix))["fields"])
        print(f"correction as left running: {final}")
        await control.close()
        if not identical or readback != original_profile:
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
