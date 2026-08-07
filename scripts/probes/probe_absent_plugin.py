#!/usr/bin/env python3
"""Probe: can a post-process plugin element be brought back once it is absent?

A user's 6.0.4 config had no ``<plugin type="loudness">`` at all, so every
loudness edit was refused ("the loudness plugin is absent from this snapshot").
HQPTuner writes by restore only, and a restore can edit elements that exist —
nothing in it creates one. The readme is silent on absent elements, on content
the daemon did not author, and on whether the daemon rewrites the file, so the
two candidate fixes each rest on an unverified assumption:

  Q1  does the daemon KEEP a ``<plugin>`` element HQPTuner authored?
  Q2  does a POST of the daemon's own /matrix form CREATE an absent one?

Both need the reporter's config shape, which this manufactures by stripping the
element first. Read-strip-restore against the live daemon, every step confirmed
by readback (an HTTP 200 is not proof — protocol.md §3.6), and the pristine
archive captured up front is restored and verified at the end.

Aborts before any write unless the engine is stopped.

    .venv/bin/python scripts/probes/probe_absent_plugin.py
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
# which questions to run; answered ones are skipped so a re-run costs one restart
STEPS = set((os.environ.get("PROBE_STEPS") or "q1,q2,q3,q4").split(","))


def _strip_plugin(xml: bytes, plugin_type: str) -> bytes:
    """Remove one ``<plugin type="X" .../>`` line, indentation included."""
    pattern = rb'\n?[ \t]*<plugin\b[^>]*type="' + plugin_type.encode() + rb'"[^>]*/>'
    stripped, n = re.subn(pattern, b"", xml)
    if n != 1:
        raise SystemExit(f"expected exactly one {plugin_type} plugin, matched {n}")
    return stripped


def _has_plugin(xml: bytes, plugin_type: str) -> bool:
    return re.search(rb'<plugin\b[^>]*type="' + plugin_type.encode() + rb'"', xml) is not None


def _plugin_tag(xml: bytes, plugin_type: str) -> bytes:
    m = re.search(rb'<plugin\b[^>]*type="' + plugin_type.encode() + rb'"[^>]*/>', xml)
    return m.group(0) if m else b""


async def _settle(http: HttpConfigClient) -> None:
    """Wait for the daemon to serve again after a restore."""
    for _ in range(SETTLE_TRIES):
        try:
            await http.get_config()
            return
        except httpx.HTTPError:
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit("daemon never came back after a restore")


async def _rpc[T](make: Callable[[], Awaitable[T]]) -> T:
    """Any daemon call, retried through a restart window.

    Every step here follows a restore, and a restore restarts the daemon — so a
    connect attempt landing in that window is expected, not a failure. An earlier
    run wrapped only ``get_config`` this way and died on a bare ``backup()``,
    which took the revert down with it.
    """
    last: Exception | None = None
    for _ in range(SETTLE_TRIES):
        try:
            return await make()
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit(f"daemon never answered: {last}")


async def _backup(http: HttpConfigClient) -> bytes:
    return await _rpc(http.backup)


async def _working(http: HttpConfigClient, active: str | None) -> bytes:
    return engineconf.base_config_xml(await _backup(http), active)


async def _push(http: HttpConfigClient, backup: bytes, working: bytes, active: str | None) -> bytes:
    """Restore an archive carrying ``working`` as its working member, then read
    the running config back — never trust the POST's own 200.
    """
    with zipfile.ZipFile(io.BytesIO(backup)) as z:
        member = engineconf.running_config_name(z.namelist(), active)
    if member is None:
        raise SystemExit("cannot resolve the working config member")
    archive = engineconf.rewrite_zip(backup, {member: working})
    await _rpc(lambda: http.restore(archive, scope="system"))
    await _settle(http)
    return await _working(http, active)


async def _post_matrix_form(client: httpx.AsyncClient) -> None:
    """Submit the daemon's own /matrix form, complete and unchanged.

    A partial POST is silently ignored (matrix-spec), so the whole form is read
    and echoed back. `enabled=on` wedges engine init (matrix-spec probe), so the
    checkbox contract is enforced: `1` when on, omitted when off.
    """
    html = (await client.get("/matrix")).text
    fields, _ = serialize_matrix_form(html)
    if fields.get("enabled") in ("0", "on", ""):
        fields.pop("enabled", None)
    await client.post("/matrix", data=fields)


async def _q1_insert(http: HttpConfigClient, stripped: bytes, authored: bytes, active: str | None) -> list[str]:
    """Put a HQPTuner-authored element back and see whether the daemon keeps it."""
    reinserted = stripped.replace(b"<post_process>", b"<post_process>\n\t\t\t\t" + authored, 1)
    after = await _push(http, await _backup(http), reinserted, active)
    if not _has_plugin(after, PLUGIN):
        return ["Q1 insert-via-restore: daemon kept our authored element: False"]
    out = ["Q1 insert-via-restore: daemon kept our authored element: True"]
    same = _plugin_tag(after, PLUGIN) == authored
    out.append(f"Q1 byte-identical to the daemon's own tag: {same}")
    if not same:
        out.append(f"  daemon rewrote it as: {_plugin_tag(after, PLUGIN).decode()}")
    return out


async def _q2_form(http: HttpConfigClient, raw: httpx.AsyncClient, active: str | None) -> list[str]:
    """From a stripped config, submit the daemon's own form and look for the element."""
    current = await _working(http, active)
    if _has_plugin(current, PLUGIN):
        current = await _push(http, await _backup(http), _strip_plugin(current, PLUGIN), active)
    if _has_plugin(current, PLUGIN):
        return ["Q2 skipped: could not get back to a stripped config"]
    await _post_matrix_form(raw)
    await _settle(http)
    return [f"Q2 POST /matrix created the element: {_has_plugin(await _working(http, active), PLUGIN)}"]


async def _engine_alive() -> bool:
    """Does 4321 still answer? The matrix-spec wedge (a config the daemon cannot
    init on) shows up exactly here: the web lane keeps serving while the engine
    is dead, so _settle alone would not notice.
    """
    client = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    try:
        await client.connect()
        await client.get_state()
        return True
    except (OSError, TimeoutError):
        return False
    finally:
        await client.close()


async def _q3_partial(http: HttpConfigClient, stripped: bytes, active: str | None) -> list[str]:
    """Write a MINIMAL plugin element — type and enabled only. The daemon keeps
    exactly what we give it (Q1), so if it does not fill the rest in, HQPTuner
    must author every attribute itself or ship a half-configured plugin.
    """
    stub = b'<plugin enabled="1" type="' + PLUGIN.encode() + b'"/>'
    after = await _push(
        http, await _backup(http), stripped.replace(b"<post_process>", b"<post_process>\n\t\t\t\t" + stub, 1), active
    )
    alive = await _engine_alive()
    if not _has_plugin(after, PLUGIN):
        return [f"Q3 partial element kept: False (engine alive: {alive})"]
    tag = _plugin_tag(after, PLUGIN)
    filled = b"low_frequency" in tag
    return [
        f"Q3 partial element kept: True (engine alive: {alive})",
        f"Q3 daemon filled in the missing attributes: {filled}",
        f"  daemon left it as: {tag.decode()}",
    ]


async def _q4_container(http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """The container itself: can a config carry no <post_process> at all, and can
    HQPTuner put one back? The reporter's file may have neither.
    """
    without, n = re.subn(rb"\n?[ \t]*<post_process>.*?</post_process>", b"", original, flags=re.DOTALL)
    if n != 1:
        return [f"Q4 skipped: matched {n} post_process containers"]
    after = await _push(http, await _backup(http), without, active)
    gone = b"<post_process>" not in after
    out = [
        f"Q4 daemon accepted a config with no post_process container: {gone} (engine alive: {await _engine_alive()})"
    ]
    if not gone:
        return out
    rebuilt = after.replace(b"</matrix>", b"\t<post_process>\n\t\t\t\t</post_process>\n\t\t\t</matrix>", 1)
    back = await _push(http, await _backup(http), rebuilt, active)
    out.append(
        f"Q4 HQPTuner-authored container kept: {b'<post_process>' in back} (engine alive: {await _engine_alive()})"
    )
    return out


async def _q5_form_fields(http: HttpConfigClient, active: str | None) -> list[str]:
    """With the element gone, does the daemon's own /matrix form still render the
    plugin's fields — and with what values?

    This decides where an authored element's attributes come from. If the form
    carries them, HQPTuner writes the daemon's own numbers and invents nothing;
    if it does not, the only source left is the readme's documented defaults.
    """
    current = await _working(http, active)
    if _has_plugin(current, PLUGIN):
        current = await _push(http, await _backup(http), _strip_plugin(current, PLUGIN), active)
    if _has_plugin(current, PLUGIN):
        return ["Q5 skipped: could not get back to a stripped config"]
    form = await _rpc(http.get_matrix)
    fields = {f.get("name"): f.get("value") for f in form["fields"] if PLUGIN in (f.get("name") or "")}
    if not fields:
        return [f"Q5 form still renders {PLUGIN} fields with the element absent: False"]
    return [
        f"Q5 form still renders {PLUGIN} fields with the element absent: True ({len(fields)} fields)",
        f"  {fields}",
    ]


async def _q6_matrix_body(http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """A ``<matrix/>`` with no body — the shape ``matrixconf`` already refuses.

    If a user's config is like this there is nowhere to put ``<post_process>``,
    so the insertion fix would still fail for them. Two questions: does the
    daemon accept a bodyless matrix, and can HQPTuner give it a body back?
    """
    m = re.search(rb"<matrix\b[^>]*>.*?</matrix>", original, flags=re.DOTALL)
    if m is None:
        return ["Q6 skipped: no matrix element with a body to collapse"]
    open_tag = re.match(rb"<matrix\b[^>]*>", m.group(0))
    if open_tag is None:
        return ["Q6 skipped: could not read the matrix open tag"]
    collapsed = original[: m.start()] + open_tag.group(0)[:-1] + b"/>" + original[m.end() :]
    after = await _push(http, await _backup(http), collapsed, active)
    bodyless = re.search(rb"<matrix\b[^>]*/>", after) is not None
    out = [f"Q6 daemon accepted a bodyless matrix: {bodyless} (engine alive: {await _engine_alive()})"]
    if not bodyless:
        return out
    rebuilt = re.sub(
        rb"<matrix\b([^>]*)/>",
        rb"<matrix\1>\n\t\t\t\t<post_process>\n\t\t\t\t</post_process>\n\t\t\t</matrix>",
        after,
        count=1,
    )
    back = await _push(http, await _backup(http), rebuilt, active)
    kept = re.search(rb"<matrix\b[^>]*>", back) is not None and b"</matrix>" in back
    out.append(f"Q6 HQPTuner-authored matrix body kept: {kept} (engine alive: {await _engine_alive()})")
    return out


async def _q7_element(http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """The same three questions for a plain ELEMENT rather than a plugin.

    ``<defaults>`` is the representative case: it carries the startup volume, so
    it is exactly the Volume-tab class the report came from. Everything proved so
    far is evidence about ``<plugin>`` and ``<post_process>`` only.
    """
    if re.search(rb"<defaults\b[^>]*/>", original) is None:
        return ["Q7 skipped: no defaults element in this config"]
    without = re.sub(rb"\n?[ \t]*<defaults\b[^>]*/>", b"", original, count=1)
    after = await _push(http, await _backup(http), without, active)
    gone = re.search(rb"<defaults\b", after) is None
    out = [f"Q7 daemon accepted a config with no defaults element: {gone} (engine alive: {await _engine_alive()})"]
    if not gone:
        return out
    stub = b'<defaults volume="-12"/>'
    anchor = re.search(rb"<engine\b[^>]*>", after)
    if anchor is None:
        out.append("Q7 skipped: no engine element to insert into")
        return out
    cut = anchor.end()
    partial = after[:cut] + b"\n\t\t" + stub + after[cut:]
    back = await _push(http, await _backup(http), partial, active)
    tag = re.search(rb"<defaults\b[^>]*/>", back)
    if tag is None:
        out.append(f"Q7 HQPTuner-authored element kept: False (engine alive: {await _engine_alive()})")
        return out
    out.append(f"Q7 HQPTuner-authored element kept: True (engine alive: {await _engine_alive()})")
    out.append(f"Q7 daemon filled in the missing attributes: {b'samplerate' in tag.group(0)}")
    out.append(f"  authored: {stub.decode()}")
    out.append(f"  daemon left it as: {tag.group(0).decode()}")
    return out


# Wide by necessity: the probe body needs both daemon handles plus all three
# config snapshots it compares against, which share no identity to bundle under.
async def _probe(  # noqa: PLR0913
    http: HttpConfigClient,
    raw: httpx.AsyncClient,
    pristine: bytes,
    original: bytes,
    authored: bytes,
    active: str | None,
) -> list[str]:
    out: list[str] = []
    if STEPS & {"q1", "q2", "q3", "q5"}:
        stripped = await _push(http, pristine, _strip_plugin(original, PLUGIN), active)
        gone = not _has_plugin(stripped, PLUGIN)
        out.append(f"STRIP: daemon accepted a config with no {PLUGIN} plugin: {gone}")
        if not gone:
            out.append("  (daemon re-created it on its own — that alone answers Q1 and Q2)")
            return out
        if "q1" in STEPS:
            out += await _q1_insert(http, stripped, authored, active)
        if "q2" in STEPS:
            out += await _q2_form(http, raw, active)
        if "q3" in STEPS:
            current = await _working(http, active)
            if _has_plugin(current, PLUGIN):
                current = await _push(http, await _backup(http), _strip_plugin(current, PLUGIN), active)
            out += await _q3_partial(http, current, active)
        if "q5" in STEPS:
            out += await _q5_form_fields(http, active)
    out += await _later_steps(http, original, active)
    return out


async def _q8_config_form(http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """Q5's analogue for a plain element: with ``<defaults>`` gone, does the
    daemon's /config form still carry its values?

    Q5 proved the /matrix form does for a plugin. If /config does too, an
    authored element takes every attribute from the daemon's own statement of
    it and HQPTuner invents nothing anywhere.
    """
    if re.search(rb"<defaults\b", original) is None:
        return ["Q8 skipped: no defaults element in this config"]
    without = re.sub(rb"\n?[ \t]*<defaults\b[^>]*/>", b"", original, count=1)
    after = await _push(http, await _backup(http), without, active)
    if re.search(rb"<defaults\b", after) is not None:
        return ["Q8 skipped: could not get back to a stripped config"]
    form = await _rpc(http.get_config)
    fields = {f.get("name"): f.get("value") for f in form["fields"] if (f.get("name") or "").startswith("defaults_")}
    if not fields:
        return ["Q8 /config still carries the absent element's fields: False"]
    return [f"Q8 /config still carries the absent element's fields: True ({len(fields)})", f"  {fields}"]


async def _later_steps(http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """The steps that need no stripped-plugin state of their own."""
    out: list[str] = []
    if "q4" in STEPS:
        out += await _q4_container(http, original, active)
    if "q6" in STEPS:
        out += await _q6_matrix_body(http, original, active)
    if "q7" in STEPS:
        out += await _q7_element(http, original, active)
    if "q8" in STEPS:
        out += await _q8_config_form(http, original, active)
    return out


async def main() -> int:
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        raise SystemExit("set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)")

    control = ControlClient(HOST, int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321")))
    await control.connect()
    state = await control.get_state()
    if state.get("state") != "0":
        await control.close()
        raise SystemExit(f"engine is not stopped (state={state.get('state')!r}) — refusing to write")
    active = (await control.get_active_config()) or None
    await control.close()

    http = HttpConfigClient(HOST, HTTP_PORT, user, password, timeout=60.0)
    raw = httpx.AsyncClient(base_url=f"http://{HOST}:{HTTP_PORT}", auth=httpx.DigestAuth(user, password), timeout=60.0)
    OUT.mkdir(parents=True, exist_ok=True)
    findings: list[str] = []
    # captured BEFORE the try: the revert below reads them, and a capture that
    # fails half-way inside the try leaves the finally raising NameError over
    # the real error — losing both the diagnosis and the revert
    pristine = await _backup(http)
    (OUT / "pristine-settings.zip").write_bytes(pristine)
    original = engineconf.base_config_xml(pristine, active)
    if not original:
        raise SystemExit("no working config in /backup — nothing to probe against")
    if not _has_plugin(original, PLUGIN):
        raise SystemExit(f"this daemon's config already has no {PLUGIN} plugin — nothing to strip")
    authored = _plugin_tag(original, PLUGIN)
    print(f"active config: {active!r}\noriginal tag: {authored.decode()}\n")
    try:
        findings += await _probe(http, raw, pristine, original, authored, active)
    finally:
        # --- revert, and prove it by readback -------------------------------
        try:
            restored = await _push(http, await _backup(http), original, active)
            findings.append(f"REVERT: working config byte-identical to the original: {restored == original}")
            if restored != original:
                await _rpc(lambda: http.restore(pristine, scope="system"))
                await _settle(http)
                again = await _working(http, active)
                findings.append(f"REVERT via pristine archive: byte-identical: {again == original}")
        finally:
            await raw.aclose()

    print("\n".join(findings))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
