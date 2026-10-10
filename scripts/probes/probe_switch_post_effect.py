#!/usr/bin/env python3
"""Probe what a live ``MatrixSetProfile`` does to the running post-process chain.

``docs/protocol.md`` "Matrix profile commands" asserts the switch installs the profile's whole
matrix context, ``<post_process>`` included, and derives it from the readme's
content model (§1.12 -> §1.11) rather than from a measurement. Everything that
decides how a saved profile should carry DAC correction rests on that assertion,
so it gets measured.

Two questions, both answered from profiles the config ALREADY carries — nothing
is written, no daemon restart, no ``sudo``:

  QA  switching to a profile that carries NO ``<post_process>`` — does the
      running correction plugin survive, or is it cleared?
  QB  switching to a profile that carries one with ``enabled="1"`` — is it
      installed into the running engine?

The switch is memory-only, so the only cleanup is switching back to the profile
that was active, verified by readback.
Correction state is read from ``GET /matrix``, which is the running form.

Aborts before any switch unless the engine is stopped: this daemon is the host's
top-priority service.

    set -a; source hqpcreds; set +a
    .venv/bin/python scripts/probes/probe_switch_post_effect.py WITH_CHAIN NO_CHAIN
"""

import asyncio
import os
import sys
from typing import Any

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.conf.httpforms import FormField
from hqptuner.engine.control import ControlClient

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
CONTROL_PORT = int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321"))
SETTLE = 1.0
ARGC = 3  # script, profile-with-chain, profile-without-chain

# post_process fields worth printing: the whole chain, so a cleared bauer or
# loudness shows up next to correction rather than being inferred from it.
PREFIXES = ("post_correction", "post_bauer_enabled", "post_loudness_enabled")


class CliError(Exception):
    """A condition that stops this probe cold; `main` prints it and owns the exit code."""


def _chain(fields: list[FormField]) -> dict[str, Any]:
    return {str(f["name"]): f.get("value") for f in fields if str(f.get("name", "")).startswith(PREFIXES)}


async def _read(http: HttpConfigClient) -> dict[str, Any]:
    await asyncio.sleep(SETTLE)
    return _chain((await http.get_matrix())["fields"])


async def _switch(control: ControlClient, http: HttpConfigClient, name: str) -> dict[str, Any]:
    await control.set_matrix_profile(name)
    active = (await control.get_state()).get("matrix_profile", "")
    chain = await _read(http)
    print(f"  switched to {name or '[Default]'!r}; State.matrix_profile={active!r}")
    print(f"  running chain: {chain}")
    return chain


async def _run() -> int:
    """Measure the running post-process chain either side of two live profile switches."""
    if len(sys.argv) != ARGC:
        message = "usage: probe_switch_post_effect.py <profile-with-chain> <profile-without-chain>"
        raise CliError(message)
    with_chain, no_chain = sys.argv[1], sys.argv[2]
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        message = "set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)"
        raise CliError(message)

    control = ControlClient(HOST, CONTROL_PORT)
    await control.connect()
    state = await control.get_state()
    if state.get("state") != "0":
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to switch"
        raise CliError(message)
    original = state.get("matrix_profile", "")
    print(f"engine idle; active matrix profile {original!r}")

    http = HttpConfigClient(HOST, HTTP_PORT, user, password, HttpOptions(timeout=60.0))
    names = await control.get_matrix_profiles()
    for name in (with_chain, no_chain):
        if name not in names:
            message = f"the daemon does not know a profile named {name!r}; it has {names}"
            raise CliError(message)

    baseline = await _read(http)
    print(f"baseline running chain: {baseline}")

    rc = 0
    try:
        print(f"\nQA — switch to {no_chain!r} (config carries no <post_process> for it)")
        cleared = await _switch(control, http, no_chain)
        print(f"QA correction survives a chain-less profile: {cleared.get('post_correction_enabled')!r}")

        print(f"\nQB — switch to {with_chain!r} (config carries a chain with correction enabled)")
        installed = await _switch(control, http, with_chain)
        value = installed.get("post_correction_enabled")
        print(f"QB correction after switching to a profile that carries one: {value!r}")
    finally:
        print(f"\nrestoring the original profile {original!r}")
        restored = await _switch(control, http, original)
        ok = restored == baseline
        print(f"running chain restored to the baseline: {ok}")
        if not ok:
            print(f"  baseline {baseline}\n  now      {restored}")
            rc = 1
        await http.aclose()
        await control.close()
    return rc


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
