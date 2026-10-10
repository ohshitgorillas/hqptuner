"""What a listener is shown when HQPlayer refuses a Control API command a REST
request needed: the daemon answered `result="Error"` with its own diagnostic as
the element's text (docs/protocol.md §6).

The owner's spec: a route's error answer carries HQPlayer's refusal text
unchanged, preceded by a clause saying what HQPTuner was doing, and each route
says something different about what it was doing. A setter refused inside a
batch is not such an answer: its entry in the 200 report keeps HQPlayer's text
with nothing of HQPTuner's own ahead of it.

The clause itself is copy and is not asserted (docs/testing.md rule 9). What is
asserted is what the fixture put on the wire and how the routes relate: the
refusal text the fake answered with, the command name and result value of that
answer, and whether two routes lead into the same text with the same words.

The daemon is the repository's control fake, refusing on its `_error` and
`_error_text` knobs; the knobs are set only once the app has loaded, so the
refusal lands on the case's own request. The matrix switch's no-track refusal is
translated by a rule of its own and is not driven here.

`POST /api/config/apply`, `POST /api/config/live` and
`POST /api/livepresets/{name}/apply` are driven only inside a 200 body. The first
two report every single refused command this fake can answer there. A live
snapshot applied across a mode switch answers an error when the enumeration it
re-reads is refused, but that error is the live lane's routing refusal
(`route_refused`), not a Control API error, so it is outside this behavior.
"""

import contextlib
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from apps import wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import DEFAULTS
from fastapi.testclient import TestClient
from fixtures_clients import app
from httpx import Response

#: HQPlayer's own words for the refusal, as the fake answers every refused command.
REFUSAL = "request 7731 declined by engine"

#: The result attribute a refusing daemon answers with (docs/protocol.md §6).
RESULT_ERROR = "Error"

#: A live setting whose setter is one command with nothing else in the batch.
LIVE_FIELD = "junk_filter"
LIVE_VALUE = "1"
LIVE_SETTER = "SetJunkFilter"

#: A saved live snapshot, and a matrix profile the fake daemon lists.
SNAPSHOT = "Warm"
PROFILE = "Default"

#: The `State.mode` a snapshot is saved on (docs/protocol.md §6, 1 = PCM).
SAVED_MODE = "1"

#: What a response carrying no failure text reads as.
NO_TEXT = ""


def _detail(body: object) -> str:
    """The error answer's `detail`, when it is a sentence."""
    detail = body.get("detail") if isinstance(body, dict) else None
    return detail if isinstance(detail, str) else NO_TEXT


def _report_error(body: object) -> str:
    """The `error` a 200 body's live report carries for ``LIVE_FIELD``."""
    report = body.get("report") if isinstance(body, dict) else None
    entries = report.get("live", []) if isinstance(report, dict) else []
    errors = [e.get("error") for e in entries if isinstance(e, dict) and e.get("setting") == LIVE_FIELD]
    return errors[0] if errors and isinstance(errors[0], str) else NO_TEXT


#: The engine state the fake answers `State` from, shared with the running daemon.
EngineState = dict[str, str]


def _no_preparation(_: TestClient, __: EngineState) -> None:
    pass


def _stage_live_field(client: TestClient, _: EngineState) -> None:
    client.post("/api/config/stage", json={"live": {LIVE_FIELD: {"value": LIVE_VALUE}}})


def _move_engine(client: TestClient, state: EngineState, mode: str) -> None:
    state["mode"] = mode
    wait_for_api(client, lambda c: c.get("/api/state").json()["data"]["mode"] == mode)


def _save_snapshot(client: TestClient, state: EngineState) -> None:
    _move_engine(client, state, SAVED_MODE)
    client.put(f"/api/livepresets/{SNAPSHOT}")


@dataclass(frozen=True)
class Route:
    """One REST request that needs a Control API command HQPlayer may refuse."""

    command: str
    """The Control API command the request puts on the wire and the fake refuses."""
    send: Callable[[TestClient], Response]
    """The request itself."""
    text: Callable[[object], str]
    """Where the answer carries the failure: `detail`, or the live report's `error`."""
    prepare: Callable[[TestClient, EngineState], None] = _no_preparation
    """What has to exist before the request, done while the daemon still answers."""


def _apply(client: TestClient) -> Response:
    resp: Response = client.post("/api/config/apply")
    return resp


def _live(client: TestClient) -> Response:
    resp: Response = client.post("/api/config/live", json={"fields": {LIVE_FIELD: LIVE_VALUE}})
    return resp


def _apply_snapshot(client: TestClient) -> Response:
    resp: Response = client.post(f"/api/livepresets/{SNAPSHOT}/apply")
    return resp


#: Routes whose refusal comes back as an error answer.
ROUTES: dict[str, Route] = {
    "volume": Route("Volume", lambda c: c.post("/api/volume", json={"level": "-24.5"}), _detail),
    "matrix-profile": Route(
        "MatrixSetProfile",
        lambda c: c.post("/api/matrix/profile", json={"action": "switch", "name": PROFILE}),
        _detail,
    ),
}

#: Routes whose refused setter is reported inside a 200 body.
REPORT_ROUTES: dict[str, Route] = {
    "config-apply": Route(LIVE_SETTER, _apply, _report_error, _stage_live_field),
    "config-live": Route(LIVE_SETTER, _live, _report_error),
    "live-preset-apply": Route(LIVE_SETTER, _apply_snapshot, _report_error, _save_snapshot),
}


@dataclass(frozen=True)
class Refusal:
    """One refused request as the user received it, beside the command refused."""

    text: str
    command: str


Refuse = Callable[[Route], Refusal]


@pytest.fixture
def refused(http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[Refuse]:
    """Drive a route against a daemon that refuses its command, each on an app
    and a control daemon of its own, and return what the user received."""
    stack = contextlib.ExitStack()
    built: list[Route] = []

    def drive(route: Route) -> Refusal:
        built.append(route)
        state = dict(DEFAULTS)
        ports = spawn_threaded_daemon(state=state)
        port = next(ports)
        stack.callback(next, ports, None)
        clients = app(http_daemon, tmp_path / str(len(built)), port, None)
        client = next(clients)
        stack.callback(next, clients, None)
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        route.prepare(client, state)
        state["_error"] = route.command
        state["_error_text"] = REFUSAL
        return Refusal(route.text(route.send(client).json()), route.command)

    yield drive
    stack.close()


def lead_clause(text: str) -> str | None:
    """Everything ahead of HQPlayer's refusal text, or None where the text is
    absent or altered."""
    at = text.find(REFUSAL)
    return text[:at] if at >= 0 else None


def own_words(refusal: Refusal) -> str | None:
    """The lead clause less every part the daemon's answer itself supplied — the
    command name and the result value — and less punctuation and spacing: what
    is left is what HQPTuner said of its own. None where HQPlayer's text is not
    carried unchanged."""
    clause = lead_clause(refusal.text)
    return None if clause is None else re.sub(rf"{refusal.command}|{RESULT_ERROR}|[\W_]+", "", clause)


@pytest.mark.parametrize("route", list(ROUTES))
def test_a_refused_command_reports_hqplayers_words_after_a_clause_of_hqptuners_own(refused: Refuse, route: str) -> None:
    assert own_words(refused(ROUTES[route])) not in {None, NO_TEXT}


@pytest.mark.parametrize("route", list(ROUTES))
def test_no_other_route_says_what_this_one_says_ahead_of_the_same_refusal(refused: Refuse, route: str) -> None:
    # HQPTuner's own words are compared, never the command name the daemon's
    # answer supplies, which differs between routes whatever HQPTuner says. A
    # route that drops HQPlayer's text has no clause to compare; the test above
    # reports it. Two routes that say nothing ahead of it say the same thing.
    others = {own_words(refused(ROUTES[other])) for other in ROUTES if other != route}
    assert own_words(refused(ROUTES[route])) not in others - {None}


@pytest.mark.parametrize("route", list(REPORT_ROUTES))
def test_a_setter_refused_inside_a_batch_reports_hqplayers_words_with_nothing_of_hqptuners_own_ahead(
    refused: Refuse, route: str
) -> None:
    assert own_words(refused(REPORT_ROUTES[route])) == NO_TEXT
