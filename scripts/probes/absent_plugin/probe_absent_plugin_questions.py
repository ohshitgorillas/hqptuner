#!/usr/bin/env python3
"""Q1-Q8 answer bodies for the absent-plugin probe.

Each function takes an ``Ops`` bundle of the daemon read/write/settle operations, plus the HTTP handle and
the config snapshots, and returns the finding lines for its one question. This module is a library, never
the ``__main__`` script, and imports nothing from the probe script.
"""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from hqptuner.conf.httpconf import HttpConfigClient


@dataclass
class Ops:
    """The daemon read/write/settle operations every Q body calls through."""

    plugin: str
    push: Callable[[HttpConfigClient, bytes, bytes, str | None], Awaitable[bytes]]
    backup: Callable[[HttpConfigClient], Awaitable[bytes]]
    working: Callable[[HttpConfigClient, str | None], Awaitable[bytes]]
    settle: Callable[[HttpConfigClient], Awaitable[None]]
    rpc: Callable[[Callable[[], Awaitable[Any]]], Awaitable[Any]]
    has_plugin: Callable[[bytes, str], bool]
    plugin_tag: Callable[[bytes, str], bytes]
    strip_plugin: Callable[[bytes, str], bytes]
    post_matrix_form: Callable[[httpx.AsyncClient], Awaitable[None]]
    engine_alive: Callable[[], Awaitable[bool]]


async def q1_insert(
    ops: Ops, http: HttpConfigClient, stripped: bytes, authored: bytes, active: str | None
) -> list[str]:
    """Put a HQPTuner-authored element back and see whether the daemon keeps it."""
    reinserted = stripped.replace(b"<post_process>", b"<post_process>\n\t\t\t\t" + authored, 1)
    after = await ops.push(http, await ops.backup(http), reinserted, active)
    if not ops.has_plugin(after, ops.plugin):
        return ["Q1 insert-via-restore: daemon kept our authored element: False"]
    out = ["Q1 insert-via-restore: daemon kept our authored element: True"]
    same = ops.plugin_tag(after, ops.plugin) == authored
    out.append(f"Q1 byte-identical to the daemon's own tag: {same}")
    if not same:
        out.append(f"  daemon rewrote it as: {ops.plugin_tag(after, ops.plugin).decode()}")
    return out


async def q2_form(ops: Ops, http: HttpConfigClient, raw: httpx.AsyncClient, active: str | None) -> list[str]:
    """From a stripped config, submit the daemon's own form and look for the element."""
    current = await ops.working(http, active)
    if ops.has_plugin(current, ops.plugin):
        current = await ops.push(http, await ops.backup(http), ops.strip_plugin(current, ops.plugin), active)
    if ops.has_plugin(current, ops.plugin):
        return ["Q2 skipped: could not get back to a stripped config"]
    await ops.post_matrix_form(raw)
    await ops.settle(http)
    return [f"Q2 POST /matrix created the element: {ops.has_plugin(await ops.working(http, active), ops.plugin)}"]


async def q3_partial(ops: Ops, http: HttpConfigClient, stripped: bytes, active: str | None) -> list[str]:
    """Write a MINIMAL plugin element — type and enabled only.

    If the daemon does not fill the rest in, HQPTuner must author every
    attribute itself or ship a half-configured plugin.
    """
    stub = b'<plugin enabled="1" type="' + ops.plugin.encode() + b'"/>'
    after = await ops.push(
        http,
        await ops.backup(http),
        stripped.replace(b"<post_process>", b"<post_process>\n\t\t\t\t" + stub, 1),
        active,
    )
    alive = await ops.engine_alive()
    if not ops.has_plugin(after, ops.plugin):
        return [f"Q3 partial element kept: False (engine alive: {alive})"]
    tag = ops.plugin_tag(after, ops.plugin)
    filled = b"low_frequency" in tag
    return [
        f"Q3 partial element kept: True (engine alive: {alive})",
        f"Q3 daemon filled in the missing attributes: {filled}",
        f"  daemon left it as: {tag.decode()}",
    ]


async def q4_container(ops: Ops, http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """Test the container itself — whether a config can carry no <post_process> at all, and HQPTuner put one back.

    A config may have neither.
    """
    without, n = re.subn(rb"\n?[ \t]*<post_process>.*?</post_process>", b"", original, flags=re.DOTALL)
    if n != 1:
        return [f"Q4 skipped: matched {n} post_process containers"]
    after = await ops.push(http, await ops.backup(http), without, active)
    gone = b"<post_process>" not in after
    out = [
        (
            f"Q4 daemon accepted a config with no post_process container: {gone} "
            f"(engine alive: {await ops.engine_alive()})"
        )
    ]
    if not gone:
        return out
    rebuilt = after.replace(b"</matrix>", b"\t<post_process>\n\t\t\t\t</post_process>\n\t\t\t</matrix>", 1)
    back = await ops.push(http, await ops.backup(http), rebuilt, active)
    out.append(
        f"Q4 HQPTuner-authored container kept: {b'<post_process>' in back} "
        f"(engine alive: {await ops.engine_alive()})"
    )
    return out


async def q5_form_fields(ops: Ops, http: HttpConfigClient, active: str | None) -> list[str]:
    """Check whether the daemon's /matrix form still renders the plugin's fields once gone, and with what values.

    This decides where an authored element's attributes come from. If the form
    carries them, HQPTuner writes the daemon's own numbers and invents nothing;
    if it does not, the only source left is the readme's documented defaults.
    """
    current = await ops.working(http, active)
    if ops.has_plugin(current, ops.plugin):
        current = await ops.push(http, await ops.backup(http), ops.strip_plugin(current, ops.plugin), active)
    if ops.has_plugin(current, ops.plugin):
        return ["Q5 skipped: could not get back to a stripped config"]
    form = await ops.rpc(http.get_matrix)
    fields = {f.get("name"): f.get("value") for f in form["fields"] if ops.plugin in (f.get("name") or "")}
    if not fields:
        return [f"Q5 form still renders {ops.plugin} fields with the element absent: False"]
    return [
        f"Q5 form still renders {ops.plugin} fields with the element absent: True ({len(fields)} fields)",
        f"  {fields}",
    ]


async def q6_matrix_body(ops: Ops, http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """Probe a ``<matrix/>`` with no body, a shape with nowhere to put ``<post_process>``.

    Two questions: does the daemon accept a bodyless matrix, and can HQPTuner
    give it a body back?
    """
    m = re.search(rb"<matrix\b[^>]*>.*?</matrix>", original, flags=re.DOTALL)
    if m is None:
        return ["Q6 skipped: no matrix element with a body to collapse"]
    open_tag = re.match(rb"<matrix\b[^>]*>", m.group(0))
    if open_tag is None:
        return ["Q6 skipped: could not read the matrix open tag"]
    collapsed = original[: m.start()] + open_tag.group(0)[:-1] + b"/>" + original[m.end() :]
    after = await ops.push(http, await ops.backup(http), collapsed, active)
    bodyless = re.search(rb"<matrix\b[^>]*/>", after) is not None
    out = [f"Q6 daemon accepted a bodyless matrix: {bodyless} (engine alive: {await ops.engine_alive()})"]
    if not bodyless:
        return out
    rebuilt = re.sub(
        rb"<matrix\b([^>]*)/>",
        rb"<matrix\1>\n\t\t\t\t<post_process>\n\t\t\t\t</post_process>\n\t\t\t</matrix>",
        after,
        count=1,
    )
    back = await ops.push(http, await ops.backup(http), rebuilt, active)
    kept = re.search(rb"<matrix\b[^>]*>", back) is not None and b"</matrix>" in back
    out.append(f"Q6 HQPTuner-authored matrix body kept: {kept} (engine alive: {await ops.engine_alive()})")
    return out


async def q7_element(ops: Ops, http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """Ask the same three questions for a plain ELEMENT rather than a plugin.

    ``<defaults>`` is the representative case: it carries the startup volume.
    """
    if re.search(rb"<defaults\b[^>]*/>", original) is None:
        return ["Q7 skipped: no defaults element in this config"]
    without = re.sub(rb"\n?[ \t]*<defaults\b[^>]*/>", b"", original, count=1)
    after = await ops.push(http, await ops.backup(http), without, active)
    gone = re.search(rb"<defaults\b", after) is None
    out = [f"Q7 daemon accepted a config with no defaults element: {gone} (engine alive: {await ops.engine_alive()})"]
    if not gone:
        return out
    stub = b'<defaults volume="-12"/>'
    anchor = re.search(rb"<engine\b[^>]*>", after)
    if anchor is None:
        out.append("Q7 skipped: no engine element to insert into")
        return out
    cut = anchor.end()
    partial = after[:cut] + b"\n\t\t" + stub + after[cut:]
    back = await ops.push(http, await ops.backup(http), partial, active)
    tag = re.search(rb"<defaults\b[^>]*/>", back)
    if tag is None:
        out.append(f"Q7 HQPTuner-authored element kept: False (engine alive: {await ops.engine_alive()})")
        return out
    out.append(f"Q7 HQPTuner-authored element kept: True (engine alive: {await ops.engine_alive()})")
    out.append(f"Q7 daemon filled in the missing attributes: {b'samplerate' in tag.group(0)}")
    out.append(f"  authored: {stub.decode()}")
    out.append(f"  daemon left it as: {tag.group(0).decode()}")
    return out


async def q8_config_form(ops: Ops, http: HttpConfigClient, original: bytes, active: str | None) -> list[str]:
    """Check whether the /config form carries values with ``<defaults>`` gone.

    If it does, an authored element takes every attribute from the daemon's
    own statement of it and HQPTuner invents nothing.
    """
    if re.search(rb"<defaults\b", original) is None:
        return ["Q8 skipped: no defaults element in this config"]
    without = re.sub(rb"\n?[ \t]*<defaults\b[^>]*/>", b"", original, count=1)
    after = await ops.push(http, await ops.backup(http), without, active)
    if re.search(rb"<defaults\b", after) is not None:
        return ["Q8 skipped: could not get back to a stripped config"]
    form = await ops.rpc(http.get_config)
    fields = {f.get("name"): f.get("value") for f in form["fields"] if (f.get("name") or "").startswith("defaults_")}
    if not fields:
        return ["Q8 /config still carries the absent element's fields: False"]
    return [f"Q8 /config still carries the absent element's fields: True ({len(fields)})", f"  {fields}"]
