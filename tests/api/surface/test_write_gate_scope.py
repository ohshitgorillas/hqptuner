"""Which requests the readiness gate holds while the app is not ready (docs/testing.md).

The decision is one function of a request's method and path, so the cases run it directly (rule 15).
"""

import pytest

from hqptuner.api.gate import Access
from hqptuner.api.readygate import decide

#: The six routes that send the engine a command, and the second half of an apply.
ENGINE_WRITES = [
    ("POST", "/api/config/live"),
    ("POST", "/api/volume"),
    ("POST", "/api/livepresets/warm/apply"),
    ("POST", "/api/matrix/profile"),
    ("POST", "/api/autopilot"),
    ("POST", "/api/config/apply"),
]

#: Writes to HQPTuner's own stores, and the two that are the way back to a working install.
OWN_STORE_WRITES = [
    ("POST", "/api/login"),
    ("POST", "/api/connection"),
    ("POST", "/api/config/stage"),
    ("DELETE", "/api/config/pending"),
    ("PUT", "/api/favorites"),
    ("PUT", "/api/descriptions"),
    ("PUT", "/api/narrowing"),
    ("PUT", "/api/matrixmodes"),
    ("PUT", "/api/livepresets/warm"),
    ("DELETE", "/api/livepresets/warm"),
    ("POST", "/api/autosave"),
]


@pytest.mark.parametrize(("method", "path"), ENGINE_WRITES)
def test_an_engine_write_is_held(method: str, path: str) -> None:
    assert decide(path, method) is Access.DENY


@pytest.mark.parametrize(("method", "path"), OWN_STORE_WRITES)
def test_a_write_to_hqptuners_own_store_or_the_way_back_is_not_held(method: str, path: str) -> None:
    assert decide(path, method) is Access.ALLOW


def test_a_write_to_a_route_nobody_listed_is_held() -> None:
    # Holding by default is what covers a route added later without anyone remembering the gate.
    assert decide("/api/a/route/added/later", "POST") is Access.DENY


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_a_read_is_not_held(method: str) -> None:
    assert decide("/api/state", method) is Access.ALLOW


def test_a_write_outside_the_api_is_not_held() -> None:
    assert decide("/assets/app.js", "POST") is Access.ALLOW
