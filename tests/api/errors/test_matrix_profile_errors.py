"""`POST /api/matrix/profile` when the daemon refuses the live switch.

hqplayerd 6.0.4 answers `MatrixSetProfile` with `result="Error"` and the
diagnostic `clHQPlayerEngine::MatrixSetProfile(): clPlaylist::GetTrackFile():
trackn > last` when there is nothing loaded to play (a setter's Error carries
the daemon's diagnostic as the element's text). That one diagnostic is
translated into a sentence a listener can act on; every other refusal keeps the
daemon's own words. HQPTuner never pre-checks playback state itself — the
refusal here is the daemon's alone.

The control-lane fake refuses on the `_error`/`_error_text` knobs; the daemon
never sees a difference between these cases and any other setter refusal.
"""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response

#: What the daemon says when the switch cannot happen for want of playback.
NO_PLAYBACK = "clHQPlayerEngine::MatrixSetProfile(): clPlaylist::GetTrackFile(): trackn > last"

#: Any other refusal — the daemon's words, not one HQPTuner knows about.
OTHER_ERROR = "MatrixSetProfile(): no such profile"


def _switch(client: TestClient) -> Response:
    resp: Response = client.post("/api/matrix/profile", json={"action": "switch", "name": "Default"})
    return resp


@pytest.fixture
def refusing_api(chain_api: Callable[..., TestClient]) -> Callable[[str], TestClient]:
    """The REST app over a daemon that refuses `MatrixSetProfile` with the given
    diagnostic, exactly as a real refusal comes back on the wire."""

    def build(text: str) -> TestClient:
        return chain_api(_error="MatrixSetProfile", _error_text=text)

    return build


def test_a_switch_refused_for_want_of_playback_is_unavailable(
    refusing_api: Callable[[str], TestClient],
) -> None:
    assert _switch(refusing_api(NO_PLAYBACK)).status_code == 503


def test_a_switch_refused_for_another_reason_is_unavailable(
    refusing_api: Callable[[str], TestClient],
) -> None:
    assert _switch(refusing_api(OTHER_ERROR)).status_code == 503
