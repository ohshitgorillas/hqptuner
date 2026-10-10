"""Direct live fields are validated before anything reaches the daemon: a flag
setter such as SetAdaptiveVolume takes exactly "0" or "1" (hqplayerd-readme.txt),
so any other string is refused as a batch (409) and the engine's flag is left
where it was. Runs the app under TestClient over the threaded fake control
daemon, which stores whatever SetAdaptiveVolume carries verbatim, so an
unvalidated forward is visible on the State readback."""

import pytest
from fastapi.testclient import TestClient
from httpx import Response

# spec: tests/specs/live-direct-validate.txt, line 1

#: Each value posted, the status the post answers, and the flag State reads back.
#: Forwarding the string unvalidated answers 200 and reads back "1.5"; parsing it
#: as a number lets "01" and "1.5" through as "1". Only the literal flag domain
#: answers this table.
ADAPTIVE_VALUES = [
    ("1", 200, "1"),
    ("1.5", 409, "0"),
    ("true", 409, "0"),
    ("", 409, "0"),
    ("01", 409, "0"),
]


def _post_adaptive(client: TestClient, value: str) -> Response:
    resp: Response = client.post("/api/config/live", json={"fields": {"adaptive_volume": value}})
    return resp


@pytest.mark.parametrize(("value", "status"), [(value, status) for value, status, _ in ADAPTIVE_VALUES])
def test_adaptive_volume_takes_only_a_flag_literal(live_api: TestClient, value: str, status: int) -> None:
    assert _post_adaptive(live_api, value).status_code == status


@pytest.mark.parametrize(("value", "flag"), [(value, flag) for value, _, flag in ADAPTIVE_VALUES])
def test_adaptive_volume_reaches_the_engine_only_as_a_flag_literal(live_api: TestClient, value: str, flag: str) -> None:
    _post_adaptive(live_api, value)
    assert live_api.get("/api/state").json()["data"]["adaptive"] == flag
