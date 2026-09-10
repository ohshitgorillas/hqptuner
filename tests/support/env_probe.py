"""Probe plugin: report what a test body inherits from the shell it was run in.

Registered with ``-p env_probe`` in a CHILD pytest run whose shell environment
is deliberately polluted, so the parent can observe the isolation the session
guards in ``tests/conftest.py`` give a body. At the start of every test's call
phase - after fixture setup, so after the guards have installed whatever they
install, and before the body itself patches anything - it appends one JSON
record per test to the file named by ``ENV_PROBE_OUT``: the ``HQPTUNER_*``
mapping visible at that moment, and the ``(hqp_http_port, hqp_password)`` pair a
bare ``Config()`` resolves out of it.

Those records are the child run's whole output as far as the parent is
concerned; the child's own pass/fail verdict is never read. With
``ENV_PROBE_OUT`` unset the plugin records nothing, so importing it costs a
normal run nothing.
"""

import json
import os
from pathlib import Path

import pytest

from hqptuner.config import Config

#: Path the records are appended to, one JSON object per line.
OUT_ENV = "ENV_PROBE_OUT"


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_call(item: pytest.Item) -> None:
    """Record what this test body is about to see, before it runs."""
    out = os.environ.get(OUT_ENV)
    if not out:
        return
    cfg = Config()
    record = {
        "nodeid": item.nodeid,
        "env": {name: value for name, value in os.environ.items() if name.startswith("HQPTUNER_")},
        "hqp_http_port": cfg.hqp_http_port,
        "hqp_password": cfg.hqp_password,
    }
    with Path(out).open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")
