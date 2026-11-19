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
by readback, and the pristine archive captured up front is restored and
verified at the end.

Aborts before any write unless the engine is stopped.

    .venv/bin/python scripts/probes/absent_plugin/probe_absent_plugin.py
"""

import asyncio
import os
import re
import sys
from pathlib import Path

import httpx

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import HttpConfigClient, serialize_matrix_form
from hqptuner.engine.control import ControlClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "kit"))

from probekit import (
    CONTROL_PORT,
    HOST,
    CliError,
    backup,
    connect_state,
    credentials,
    open_http,
    open_raw,
    push,
    rpc,
    run_cli,
    save_pristine,
    settle,
    working,
)

PLUGIN = "loudness"
# which questions to run, comma-separated in PROBE_STEPS
STEPS = set((os.environ.get("PROBE_STEPS") or "q1,q2,q3,q4").split(","))


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
    client = ControlClient(HOST, CONTROL_PORT)
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
    user, password = credentials()

    control, state = await connect_state()
    if state.get("state") != "0":
        await control.close()
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to write"
        raise CliError(message)
    active = (await control.get_active_config()) or None
    await control.close()

    http = open_http(user, password, 60.0)
    raw = open_raw(user, password, 60.0)
    findings: list[str] = []
    # captured BEFORE the try: the revert in the finally reads them
    pristine = await save_pristine(http)
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


if __name__ == "__main__":
    sys.exit(asyncio.run(run_cli(_run)))
