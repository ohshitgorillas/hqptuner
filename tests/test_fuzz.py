"""``scripts/fuzz/fuzz.py``'s ``probe``: the health check sent after every attack.

``probe(client)`` must not let a transport failure escape as anything other than
the error it raises; the caller (``Run.one``/``Run.parallel``) is the one that
turns that into a recorded ``ProbeResult``. Lives in ``scripts/fuzz/``,
which is not a package, so it is loaded by path — the same pattern
``tests/test_build_manual.py`` uses for its own script-under-test.
"""

import importlib.util
import io
import sys
from pathlib import Path
from types import ModuleType

import httpx
import pytest

#: The fuzz scripts directory, found relative to this file rather than through an import.
SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts" / "fuzz"


class FixtureError(Exception):
    """A test's own scaffolding is wrong, not a failure of the behavior under test."""

    def __init__(self, *, reason: str) -> None:
        super().__init__(reason)


def load(name: str, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    """Load ``scripts/fuzz/<name>.py`` the way ``python scripts/fuzz/<name>.py`` would see it.

    The fuzz scripts directory goes on ``sys.path`` so a sibling import resolves, and the
    module is registered in ``sys.modules`` before it runs, as an ordinary import does.
    """
    monkeypatch.syspath_prepend(str(SCRIPTS_DIR))
    path = SCRIPTS_DIR / f"{name}.py"
    module_name = f"{name}_under_test"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {path}")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def fuzz(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return load("fuzz", monkeypatch)


#: The connect failure a refusing transport raises.
_REFUSED = "refused"


def _refuse(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError(_REFUSED, request=request)


def test_probe_raises_probe_failed_error_on_a_connect_error(fuzz: ModuleType) -> None:
    """A transport that refuses the connection surfaces as ``fuzz.ProbeFailedError``, not a return value."""
    with (
        httpx.Client(transport=httpx.MockTransport(_refuse), base_url="http://test") as client,
        pytest.raises(fuzz.ProbeFailedError),
    ):
        fuzz.probe(client)


def _state_fails(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/state":
        return httpx.Response(500, text="Internal Server Error")
    return httpx.Response(200, json={})


def test_gated_raises_state_unavailable_error_for_apply_when_state_route_fails(fuzz: ModuleType) -> None:
    """An apply-class attack whose state read answers 500 surfaces as ``fuzz.StateUnavailableError`` from ``gated``."""
    attack = fuzz.Attack(category=0, method="POST", path="/api/apply", note="apply", klass="apply")
    with (
        httpx.Client(transport=httpx.MockTransport(_state_fails), base_url="http://test") as client,
        pytest.raises(fuzz.StateUnavailableError),
    ):
        fuzz.Run(client, io.StringIO()).gated(attack)
