#!/usr/bin/env python3
"""Probe whether a post-process plugin element can be brought back once it is absent.

A config with no ``<plugin type="loudness">`` at all refuses every loudness
edit ("the loudness plugin is absent from this snapshot"). HQPTuner writes by
restore only, and a restore can edit elements that exist — nothing in it
creates one. The readme is silent on absent elements, on content the daemon
did not author, and on whether the daemon rewrites the file, so this asks:

  Q1  does the daemon KEEP a ``<plugin>`` element HQPTuner authored?
  Q2  does a POST of the daemon's own /matrix form CREATE an absent one?

Both need a config without the element, which this manufactures by stripping
it first. Read-strip-restore against the live daemon, every step confirmed
by readback (an HTTP 200 is not proof — protocol.md §3.6), and the pristine
archive captured up front is restored and verified at the end.

Aborts before any write unless the engine is stopped.

    .venv/bin/python scripts/probes/absent_plugin/probe_absent_plugin.py
"""

import asyncio
import io
import os
import re
import sys
import tempfile
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import HttpConfigClient, serialize_matrix_form
from hqptuner.engine.control import ControlClient

PLUGIN = "loudness"
HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
OUT = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / "hqptuner-probe"
SETTLE_TRIES = 40
SETTLE_WAIT = 1.0
# which questions to run, comma-separated in PROBE_STEPS
STEPS = set((os.environ.get("PROBE_STEPS") or "q1,q2,q3,q4").split(","))


class CliError(Exception):
    """A condition that stops this probe cold; `main` prints it and owns the exit code."""


def strip_plugin(xml: bytes, plugin_type: str) -> bytes:
    """Remove one ``<plugin type="X" .../>`` line, indentation included."""
    pattern = rb'\n?[ \t]*<plugin\b[^>]*type="' + plugin_type.encode() + rb'"[^>]*/>'
    stripped, n = re.subn(pattern, b"", xml)
    if n != 1:
        message = f"expected exactly one {plugin_type} plugin, matched {n}"
        raise CliError(message)
    return stripped


def has_plugin(xml: bytes, plugin_type: str) -> bool:
    """Return whether the config carries a ``<plugin type="plugin_type">`` element."""
    return re.search(rb'<plugin\b[^>]*type="' + plugin_type.encode() + rb'"', xml) is not None


def plugin_tag(xml: bytes, plugin_type: str) -> bytes:
    """Return the whole ``<plugin type="plugin_type" .../>`` tag, or an empty string when absent."""
    m = re.search(rb'<plugin\b[^>]*type="' + plugin_type.encode() + rb'"[^>]*/>', xml)
    return m.group(0) if m else b""


async def settle(http: HttpConfigClient) -> None:
    """Wait for the daemon to serve again after a restore."""
    for _ in range(SETTLE_TRIES):
        try:
            await http.get_config()
            return
        except httpx.HTTPError:
            await asyncio.sleep(SETTLE_WAIT)
    message = "daemon never came back after a restore"
    raise CliError(message)


async def rpc[T](make: Callable[[], Awaitable[T]]) -> T:
    """Any daemon call, retried through a restart window.

    Every step here follows a restore, and a restore restarts the daemon — so a
    connect attempt landing in that window is expected, not a failure.
    """
    last: Exception | None = None
    for _ in range(SETTLE_TRIES):
        try:
            return await make()
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            await asyncio.sleep(SETTLE_WAIT)
    message = f"daemon never answered: {last}"
    raise CliError(message)


async def backup(http: HttpConfigClient) -> bytes:
    """Return the daemon's own settings archive, retried through a restart window."""
    return await rpc(http.backup)


async def working(http: HttpConfigClient, active: str | None) -> bytes:
    """Return the running config's working-member XML, from a fresh backup."""
    return engineconf.base_config_xml(await backup(http), active)


async def push(http: HttpConfigClient, backup_bytes: bytes, working_xml: bytes, active: str | None) -> bytes:
    """Restore an archive carrying ``working_xml`` as its working member, then read the running config back.

    Never trust the POST's own 200.
    """
    with zipfile.ZipFile(io.BytesIO(backup_bytes)) as z:
        member = engineconf.running_config_name(z.namelist(), active)
    if member is None:
        message = "cannot resolve the working config member"
        raise CliError(message)
    archive = engineconf.rewrite_zip(backup_bytes, {member: working_xml})
    await rpc(lambda: http.restore(archive, scope="system"))
    await settle(http)
    return await working(http, active)


async def post_matrix_form(client: httpx.AsyncClient) -> None:
    """Submit the daemon's own /matrix form, complete and unchanged.

    A partial POST is silently ignored, so the whole form is read and echoed
    back. `enabled=on` wedges engine init, so the checkbox contract is
    enforced: `1` when on, omitted when off.
    """
    html = (await client.get("/matrix")).text
    fields, _ = serialize_matrix_form(html)
    if fields.get("enabled") in ("0", "on", ""):
        fields.pop("enabled", None)
    await client.post("/matrix", data=fields)


async def engine_alive() -> bool:
    """Return whether 4321 still answers.

    A config the daemon cannot init on shows up exactly here: the web lane
    keeps serving while the engine is dead, so `settle` alone would not notice.
    """
    client = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    errors: list[Exception] = []
    try:
        await client.connect()
        await client.get_state()
    except (OSError, TimeoutError) as exc:
        errors.append(exc)
    finally:
        await client.close()
    return not errors


from probe_absent_plugin_questions import (  # noqa: E402
    Ops,
    q1_insert,
    q2_form,
    q3_partial,
    q4_container,
    q5_form_fields,
    q6_matrix_body,
    q7_element,
    q8_config_form,
)


def _ops() -> Ops:
    """Bundle this module's read/write/settle helpers for the Q1-Q8 bodies, which never import this module back."""
    return Ops(
        plugin=PLUGIN,
        push=push,
        backup=backup,
        working=working,
        settle=settle,
        rpc=rpc,
        has_plugin=has_plugin,
        plugin_tag=plugin_tag,
        strip_plugin=strip_plugin,
        post_matrix_form=post_matrix_form,
        engine_alive=engine_alive,
    )


# Wide by necessity: the probe body needs both daemon handles plus all three
# config snapshots it compares against, which share no identity to bundle under.
async def _probe(  # noqa: PLR0913
    http: HttpConfigClient,
    raw: httpx.AsyncClient,
    *,
    pristine: bytes,
    original: bytes,
    authored: bytes,
    active: str | None,
) -> list[str]:
    ops = _ops()
    out: list[str] = []
    if STEPS & {"q1", "q2", "q3", "q5"}:
        stripped = await push(http, pristine, strip_plugin(original, PLUGIN), active)
        gone = not has_plugin(stripped, PLUGIN)
        out.append(f"STRIP: daemon accepted a config with no {PLUGIN} plugin: {gone}")
        if not gone:
            out.append("  (daemon re-created it on its own — that alone answers Q1 and Q2)")
            return out
        if "q1" in STEPS:
            out += await q1_insert(ops, http, stripped, authored, active)
        if "q2" in STEPS:
            out += await q2_form(ops, http, raw, active)
        if "q3" in STEPS:
            current = await working(http, active)
            if has_plugin(current, PLUGIN):
                current = await push(http, await backup(http), strip_plugin(current, PLUGIN), active)
            out += await q3_partial(ops, http, current, active)
        if "q5" in STEPS:
            out += await q5_form_fields(ops, http, active)
    out += await _later_steps(http, original, active)
    return out


async def _later_steps(http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """Run the steps that need no stripped-plugin state of their own."""
    ops = _ops()
    out: list[str] = []
    if "q4" in STEPS:
        out += await q4_container(ops, http, original, active)
    if "q6" in STEPS:
        out += await q6_matrix_body(ops, http, original, active)
    if "q7" in STEPS:
        out += await q7_element(ops, http, original, active)
    if "q8" in STEPS:
        out += await q8_config_form(ops, http, original, active)
    return out


async def _run() -> int:
    """Establish whether an absent post-process plugin element can be brought back, reverting the config afterwards."""
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        message = "set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)"
        raise CliError(message)

    control = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    await control.connect()
    state = await control.get_state()
    if state.get("state") != "0":
        await control.close()
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to write"
        raise CliError(message)
    active = (await control.get_active_config()) or None
    await control.close()

    http = HttpConfigClient(HOST, HTTP_PORT, user, password, timeout=60.0)
    raw = httpx.AsyncClient(base_url=f"http://{HOST}:{HTTP_PORT}", auth=httpx.DigestAuth(user, password), timeout=60.0)
    OUT.mkdir(parents=True, exist_ok=True)
    findings: list[str] = []
    # captured BEFORE the try: the revert in the finally reads them
    pristine = await backup(http)
    (OUT / "pristine-settings.zip").write_bytes(pristine)
    original = engineconf.base_config_xml(pristine, active)
    if not original:
        message = "no working config in /backup — nothing to probe against"
        raise CliError(message)
    if not has_plugin(original, PLUGIN):
        message = f"this daemon's config already has no {PLUGIN} plugin — nothing to strip"
        raise CliError(message)
    authored = plugin_tag(original, PLUGIN)
    print(f"active config: {active!r}\noriginal tag: {authored.decode()}\n")
    try:
        findings += await _probe(http, raw, pristine=pristine, original=original, authored=authored, active=active)
    finally:
        # --- revert, and prove it by readback -------------------------------
        try:
            restored = await push(http, await backup(http), original, active)
            findings.append(f"REVERT: working config byte-identical to the original: {restored == original}")
            if restored != original:
                await rpc(lambda: http.restore(pristine, scope="system"))
                await settle(http)
                again = await working(http, active)
                findings.append(f"REVERT via pristine archive: byte-identical: {again == original}")
        finally:
            await raw.aclose()

    print("\n".join(findings))
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
