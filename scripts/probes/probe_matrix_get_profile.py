#!/usr/bin/env python3
"""Probe: what does the daemon say a matrix profile CONTAINS?

Jussi: "When you click Apply there, it saves to the unnamed default profile that
is also the startup default." So ``<matrix>`` is the default profile, and its
``<post_process>`` belongs to that profile — which makes post-processing
per-profile in HQPlayer's own model. ``MatrixGetProfile`` is the daemon's own
answer, and it costs nothing: read-only, unauthenticated, no reload
(docs/matrix-spec.md:105).

Read-only. Writes nothing, changes nothing.

    .venv/bin/python scripts/probes/probe_matrix_get_profile.py
"""

import asyncio
import os
import sys
import xml.etree.ElementTree as ET

from hqptuner.engine.control import ControlClient

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
PORT = int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321"))


async def main() -> int:
    control = ControlClient(HOST, PORT)
    await control.connect()
    try:
        state = await control.get_state()
        print(f"active matrix profile: {state.get('matrix_profile', '')!r}")
        names = await control.get_matrix_profiles()
        print(f"profiles: {names}")

        for name in ["", *names]:
            try:
                root = await control.request(f'<MatrixGetProfile value="{name}"/>')
            except Exception as exc:  # probe: report, keep going
                print(f"\n--- {name or '[Default]'!r}: {type(exc).__name__}: {exc}")
                continue
            raw = ET.tostring(root, encoding="unicode")
            print(f"\n--- {name or '[Default]'} ({len(raw)} chars)")
            print(f"    children: {[child.tag for child in root]}")
            print(raw[:1500])
    finally:
        await control.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
