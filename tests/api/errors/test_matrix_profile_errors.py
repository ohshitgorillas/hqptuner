"""`POST /api/matrix/profile` when the daemon refuses the live switch.

hqplayerd 6.0.4 answers `MatrixSetProfile` with `result="Error"` and the
diagnostic `clHQPlayerEngine::MatrixSetProfile(): clPlaylist::GetTrackFile():
trackn > last` when there is nothing loaded to play (a setter's Error carries
the daemon's diagnostic as the element's text). That one diagnostic is
translated into a sentence a listener can act on; every other refusal keeps the
daemon's own words. HQPTuner never pre-checks playback state itself — the
refusal here is the daemon's alone.

The four parametrized jargon cases are the whole-body guard: no fragment of the
daemon's raw diagnostic may reach the listener by any route, `detail` or not.

The control-lane fake refuses on the `_error`/`_error_text` knobs; the daemon
never sees a difference between these cases and any other setter refusal.
"""

import re
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response

#: What the daemon says when the switch cannot happen for want of playback.
NO_PLAYBACK = "clHQPlayerEngine::MatrixSetProfile(): clPlaylist::GetTrackFile(): trackn > last"

#: Any other refusal — the daemon's words, not one HQPTuner knows about.
OTHER_ERROR = "MatrixSetProfile(): no such profile"

TRANSLATED = "Live playback is needed to load a matrix profile."

#: The command a switch puts on the wire, and the result value a refusal carries:
#: parts of the daemon's own answer, not HQPTuner's words.
SWITCH_COMMAND = "MatrixSetProfile"
RESULT_ERROR = "Error"


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


def test_a_switch_refused_for_want_of_playback_says_playback_is_needed(
    refusing_api: Callable[[str], TestClient],
) -> None:
    assert _switch(refusing_api(NO_PLAYBACK)).json()["detail"] == TRANSLATED


@pytest.mark.parametrize("jargon", ["clHQPlayerEngine", "clPlaylist", "GetTrackFile", "trackn"])
def test_the_daemons_raw_diagnostic_never_reaches_the_listener(
    refusing_api: Callable[[str], TestClient], jargon: str
) -> None:
    assert jargon not in _switch(refusing_api(NO_PLAYBACK)).text


def test_a_switch_refused_for_another_reason_is_unavailable(
    refusing_api: Callable[[str], TestClient],
) -> None:
    assert _switch(refusing_api(OTHER_ERROR)).status_code == 503


#: The daemon's refusal in full, as it must reach the listener unchanged.
OTHER_REFUSAL = f"{SWITCH_COMMAND}: {RESULT_ERROR}: {OTHER_ERROR}"


def _clause_ahead_of(detail: object, refusal: str) -> str | None:
    """What ``detail`` says ahead of ``refusal``, less punctuation and spacing:
    HQPTuner's own clause. None where ``refusal`` is not carried unchanged."""
    text = detail if isinstance(detail, str) else ""
    at = text.find(refusal)
    return None if at < 0 else re.sub(r"[\W_]+", "", text[:at])


def test_a_switch_refused_for_another_reason_reports_the_daemons_refusal_unchanged_after_a_clause_of_hqptuners_own(
    refusing_api: Callable[[str], TestClient],
) -> None:
    # the translation is one diagnostic, not a catch-all: every other refusal reaches
    # the listener whole, command and result included, behind a clause of HQPTuner's
    # own (the clause is copy, so only its presence is asserted)
    detail = _switch(refusing_api(OTHER_ERROR)).json()["detail"]
    assert _clause_ahead_of(detail, OTHER_REFUSAL) not in {None, ""}
