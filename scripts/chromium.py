"""The one way ``scripts/`` and ``tests/`` start a headless chromium.

``launch`` hands back a playwright ``Browser`` whose process runs under
``nice -n 10``, pinned to half of the CPUs this process may use (``nproc``),
with the swiftshader flags that give the headless shell a software WebGL2
context. The binary is the one named by ``HQPTUNER_CHROMIUM`` when that is
set, else playwright's own chromium.

Playwright starts the binary it is given with its own arguments, so the binary
it is given is a two-line ``sh`` script that ``exec``s ``nice``, ``taskset``
and the real chromium in turn. Every step is an ``exec``, so the browser keeps
the PID and the pipes playwright started it with, and every process chromium
forks inherits the niceness and the affinity.
"""

import os
import shlex
import tempfile
from collections.abc import Iterable
from pathlib import Path

from playwright.sync_api import Browser, Playwright

#: Chromium flags that give the headless shell a software WebGL2 context, so the
#: app's shaders compile and draw with no GPU on the host.
SWIFTSHADER_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]

#: How much ``nice`` lowers the browser's priority.
NICENESS = 10


def half_of_nproc(available: Iterable[int]) -> list[int]:
    """Return the lower half of the CPUs in ``available``, never fewer than one."""
    cpus = sorted(available)
    return cpus[: max(1, len(cpus) // 2)]


def wrapper_script(binary: str, cpus: list[int]) -> str:
    """Return an ``sh`` script that runs ``binary`` with its arguments, niced and pinned to ``cpus``."""
    cpu_list = ",".join(str(cpu) for cpu in cpus)
    return f'#!/bin/sh\nexec nice -n {NICENESS} taskset -c {cpu_list} {shlex.quote(binary)} "$@"\n'


def launch(pw: Playwright) -> Browser:
    """Launch headless chromium with the swiftshader flags, at niceness 10, on half of ``nproc``."""
    binary = os.environ.get("HQPTUNER_CHROMIUM") or pw.chromium.executable_path
    script = wrapper_script(binary, half_of_nproc(os.sched_getaffinity(0)))
    with tempfile.TemporaryDirectory(prefix="hqptuner-chromium-") as scratch:
        wrapper = Path(scratch) / "chromium"
        wrapper.write_text(script, encoding="utf-8")
        wrapper.chmod(0o700)
        return pw.chromium.launch(executable_path=wrapper, args=SWIFTSHADER_ARGS)
