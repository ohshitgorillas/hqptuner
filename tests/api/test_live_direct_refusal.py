"""Direct live fields are validated before anything reaches the daemon: a flag
setter such as SetAdaptiveVolume takes exactly "0" or "1" (hqplayerd-readme.txt,
docs/settings-classification.md), so any other string is refused as a batch
(409, docs/architecture.md) and the engine's flag is left where it was. Runs the
app under TestClient over the threaded fake control daemon, which stores whatever
SetAdaptiveVolume carries verbatim, so an unvalidated forward is visible on the
State readback."""

import pytest
from fastapi.testclient import TestClient

# spec: tests/specs/live-direct-validate.txt, line 1


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1", (200, "1")),
        ("1.5", (409, "0")),
        ("true", (409, "0")),
        ("", (409, "0")),
        ("01", (409, "0")),
    ],
)
def test_adaptive_volume_takes_only_a_flag_literal(live_api: TestClient, value: str, expected: tuple[int, str]) -> None:
    # Forwarding the string unvalidated answers 200 and reads back "1.5"; parsing
    # it as a number lets "01" and "1.5" through as "1". Only the literal flag
    # domain answers this table.
    resp = live_api.post("/api/config/live", json={"fields": {"adaptive_volume": value}})
    adaptive = live_api.get("/api/state").json()["data"]["adaptive"]
    assert (resp.status_code, adaptive) == expected
