#!/usr/bin/env python3
"""Probe whether the daemon's OWN saved profile carries the post-process chain.

Jussi: ``<matrix>`` is the unnamed default profile, and /matrix "Apply" writes
it. That makes post-processing per-profile in HQPlayer's model — so a profile
saved through the daemon's own route should restore its post-process when loaded
back. HQPTuner-authored ``<matrix_profile>`` elements carry ``<pipeline>`` rows
only, which is why loading one leaves the correction plugin bypassed.

  Q5  does a profile saved through the daemon's own ``POST /matrix/save``
      capture the post-process chain, so switching back to it restores the
      correction plugin?

If yes, the gap is only the config-file format HQPTuner writes. If no, a saved
profile cannot carry post-process at all and the fix has to live elsewhere.

Saved profiles are memory-only, so this writes nothing to disk; the switch back
to the original profile is the only cleanup needed. ``/matrix/save`` costs an
engine reload.

Aborts before any write unless the engine is stopped.

    .venv/bin/python scripts/probes/probe_daemon_save_post.py
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "kit"))

from probekit import (
    CliError,
    await_profile,
    connect_state,
    correction,
    credentials,
    open_http,
    open_raw,
    poll_correction,
    rpc,
)

from hqptuner.conf.httpconf import serialize_matrix_form

PROFILE = os.environ.get("PROBE_PROFILE", "hqptuner-probe-post")
OTHER = os.environ.get("PROBE_OTHER", "stereo")


async def _run() -> int:
    """Establish whether a profile saved through the daemon's own POST /matrix/save carries its post-process chain."""
    user, password = credentials()

    control, state = await connect_state()
    if state.get("state") != "0":
        message = f"engine is not stopped (state={state.get('state')!r}) — refusing to write"
        raise CliError(message)
    original_profile = state.get("matrix_profile", "")

    http = open_http(user, password, 120.0)
    at_rest = correction((await rpc(http.get_matrix))["fields"])
    print(f"active profile {original_profile!r}; correction at rest: {at_rest}")
    if not at_rest.get("post_correction_enabled"):
        message = "correction is not engaged — nothing to prove a profile carries"
        raise CliError(message)

    try:
        # save the CURRENT matrix (correction engaged) under the daemon's own route
        async with open_raw(user, password, 120.0) as raw:
            form = await raw.get("/matrix")
            form.raise_for_status()
            fields, _ = serialize_matrix_form(form.text)
            if not fields:
                message = "GET /matrix served no form fields"
                raise CliError(message)
            fields["profile"] = PROFILE
            # multipart: the form is enctype="multipart/form-data" and a
            # urlencoded POST is accepted with 200 and silently ignored
            resp = await raw.post("/matrix/save", files={k: (None, v) for k, v in fields.items()})
            print(f"POST /matrix/save {PROFILE!r} -> HTTP {resp.status_code}")

        # registration lands only once the reload settles — an immediate list is
        # stale, which is what made the first run of this probe read "not saved"
        names = await await_profile(control, PROFILE)
        print(f"profile registered: {PROFILE in names}")
        if PROFILE not in names:
            print("Q5 unanswered — the daemon did not register its own save")
            return 1

        # switch away: post-process should go with it
        await control.set_matrix_profile(OTHER)
        away = await poll_correction(http, at_rest)
        print(f"correction after switching to {OTHER!r}: {away}")

        # switch back: does the saved profile bring post-process with it?
        await control.set_matrix_profile(PROFILE)
        back = await poll_correction(http, away)
        print(f"correction after switching back to {PROFILE!r}: {back}")
        print(f"Q5 a daemon-saved profile carries its post-process: {bool(back.get('post_correction_enabled'))}")
    finally:
        await control.close()
        await control.connect()
        await control.set_matrix_profile(original_profile)
        readback = (await control.get_state()).get("matrix_profile", "")
        final = await poll_correction(http, None)
        print(f"profile restored to {readback!r}: {readback == original_profile}; correction now: {final}")
        print(f"note: {PROFILE!r} is memory-only and disappears at the next daemon restart")
        await control.close()
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
