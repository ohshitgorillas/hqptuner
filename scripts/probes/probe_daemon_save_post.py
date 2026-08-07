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

Saved profiles are memory-only (matrix-spec.md "Probe findings — saved"), so
this writes nothing to disk; the switch back to the original profile is the only
cleanup needed. ``/matrix/save`` costs an engine reload.

Aborts before any write unless the engine is stopped.

    .venv/bin/python scripts/probes/probe_daemon_save_post.py
"""

import asyncio
import os
import sys
from collections.abc import Awaitable, Callable

import httpx

from hqptuner.conf.httpconf import HttpConfigClient, serialize_matrix_form
from hqptuner.engine.control import ControlClient

PROFILE = os.environ.get("PROBE_PROFILE", "hqptuner-probe-post")
HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
OTHER = os.environ.get("PROBE_OTHER", "stereo")
SETTLE_TRIES = 40
SETTLE_WAIT = 1.0


async def _rpc[T](make: Callable[[], Awaitable[T]]) -> T:
    last: Exception | None = None
    for _ in range(SETTLE_TRIES):
        try:
            return await make()
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            await asyncio.sleep(SETTLE_WAIT)
    raise SystemExit(f"daemon never answered: {last}")


def _correction(fields: list[dict[str, object]]) -> dict[str, object]:
    return {str(f["name"]): f.get("value") for f in fields if str(f.get("name", "")).startswith("post_correction")}


async def _settled_correction(http: HttpConfigClient, differs_from: dict[str, object] | None) -> dict[str, object]:
    """Read the correction slice, polling past the reload and the device-discovery transient (matrix-spec.md:101)."""
    seen: dict[str, object] = {}
    for _ in range(20):
        seen = _correction((await _rpc(http.get_matrix))["fields"])
        if differs_from is None or seen != differs_from:
            return seen
        await asyncio.sleep(1.0)
    return seen


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

    http = HttpConfigClient(HOST, HTTP_PORT, user, password, timeout=120.0)
    at_rest = _correction((await _rpc(http.get_matrix))["fields"])
    print(f"active profile {original_profile!r}; correction at rest: {at_rest}")
    if not at_rest.get("post_correction_enabled"):
        raise SystemExit("correction is not engaged — nothing to prove a profile carries")

    try:
        # save the CURRENT matrix (correction engaged) under the daemon's own route
        async with httpx.AsyncClient(
            base_url=f"http://{HOST}:{HTTP_PORT}", auth=httpx.DigestAuth(user, password), timeout=120.0
        ) as raw:
            form = await raw.get("/matrix")
            form.raise_for_status()
            fields, _ = serialize_matrix_form(form.text)
            if not fields:
                raise SystemExit("GET /matrix served no form fields")
            fields["profile"] = PROFILE
            # multipart: the form is enctype="multipart/form-data" and a
            # urlencoded POST is accepted with 200 and silently ignored
            resp = await raw.post("/matrix/save", files={k: (None, v) for k, v in fields.items()})
            print(f"POST /matrix/save {PROFILE!r} -> HTTP {resp.status_code}")

        # registration lands only once the reload settles — an immediate list is
        # stale, which is what made the first run of this probe read "not saved"
        names: list[str] = []
        for _ in range(30):
            await control.close()
            await control.connect()
            names = await control.get_matrix_profiles()
            if PROFILE in names:
                break
            await asyncio.sleep(1.0)
        print(f"profile registered: {PROFILE in names}")
        if PROFILE not in names:
            print("Q5 unanswered — the daemon did not register its own save")
            return 1

        # switch away: post-process should go with it
        await control.set_matrix_profile(OTHER)
        away = await _settled_correction(http, at_rest)
        print(f"correction after switching to {OTHER!r}: {away}")

        # switch back: does the saved profile bring post-process with it?
        await control.set_matrix_profile(PROFILE)
        back = await _settled_correction(http, away)
        print(f"correction after switching back to {PROFILE!r}: {back}")
        print(f"Q5 a daemon-saved profile carries its post-process: {bool(back.get('post_correction_enabled'))}")
    finally:
        await control.close()
        await control.connect()
        await control.set_matrix_profile(original_profile)
        readback = (await control.get_state()).get("matrix_profile", "")
        final = await _settled_correction(http, None)
        print(f"profile restored to {readback!r}: {readback == original_profile}; correction now: {final}")
        print(f"note: {PROFILE!r} is memory-only and disappears at the next daemon restart")
        await control.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
