"""A staged apply that aborts on a failed daemon or write lane still leaves its ``apply`` row.

Every attempted apply is supposed to be on the record, including one whose
lane raised partway, with what is known when it aborted: the staged set as it
stood when the apply began, the preset switch and the save target the request
asked for, and the apply recorded as not ok. Two aborts are driven through the
real REST surface: the 8088 fake going down after the edit is staged, so the
restore lane cannot land the config, and a live edit whose control lane has no
daemon listening. Each reading first checks the request still failed, so a
scene that stopped aborting refuses to run rather than passing. Rows are read
back off the JSONL file, whose keys are the rows ``GET /api/audit`` serves.
"""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from audit_records import records
from fastapi.testclient import TestClient
from fixtures_clients import app
from narrow import FixtureError

#: The config-file title staged before the 8088 lane goes down.
TITLE = "Aborted Title"

#: The noise-shaper value staged for the live lane with no daemon behind it.
SHAPER = "5"

#: The save target the aborted request names, recorded under the row's ``save`` key.
SAVE_NAME = "Aborted Save Target"

#: The preset switch the aborted request names: the "(no preset)" switch.
SWITCH_TO = ""


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def audit_client(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int, audit_log: Path
) -> Iterator[TestClient]:
    yield from app(http_daemon, tmp_path, closed_port, audit_log)


class Abort(NamedTuple):
    """One way to make a staged apply abort: what it stages, how it breaks the
    lane, and where in the ``apply`` row the staged value is read back."""

    stage: dict[str, Any]
    break_lane: Callable[[dict[str, Any]], None]
    staged: Callable[[dict[str, Any]], object]


def take_config_lane_down(daemon: dict[str, Any]) -> None:
    daemon["_down"] = True


def leave_control_lane_closed(_daemon: dict[str, Any]) -> None:
    """The client's control port already has nothing listening."""


def staged_title(row: dict[str, Any]) -> object:
    return row["http"]["title"]


def staged_shaper(row: dict[str, Any]) -> object:
    return row["live"]["shaper"]["value"]


CONFIG_LANE_DOWN = Abort({"http": {"title": TITLE}}, take_config_lane_down, staged_title)
CONTROL_LANE_CLOSED = Abort({"live": {"shaper": {"value": SHAPER}}}, leave_control_lane_closed, staged_shaper)

ABORTS = [
    pytest.param(CONFIG_LANE_DOWN, TITLE, id="config-lane-down"),
    pytest.param(CONTROL_LANE_CLOSED, SHAPER, id="control-lane-closed"),
]


def aborted_rows(
    client: TestClient, daemon: dict[str, Any], log: Path, abort: Abort, body: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Every ``apply`` row the log holds after the aborted apply, an empty list
    when it left none. A request that did not fail was not an abort, and the
    scene refuses to run rather than read a row an apply that landed wrote."""
    client.post("/api/config/stage", json=abort.stage)
    abort.break_lane(daemon)
    status: int = client.post("/api/config/apply", json=body).status_code
    if status < 500:
        raise FixtureError(reason=f"the apply answered {status}, so it did not abort")
    return [record for record in records(log) if record.get("event") == "apply"]


@pytest.mark.parametrize(("abort", "expected"), ABORTS)
def test_an_aborted_apply_records_the_value_that_was_staged_when_it_began(
    audit_client: TestClient, http_daemon: dict[str, Any], audit_log: Path, abort: Abort, expected: str
) -> None:
    rows = aborted_rows(audit_client, http_daemon, audit_log, abort)
    assert [abort.staged(row) for row in rows] == [expected]


@pytest.mark.parametrize(
    "abort", [CONFIG_LANE_DOWN, CONTROL_LANE_CLOSED], ids=["config-lane-down", "control-lane-closed"]
)
def test_an_aborted_apply_is_recorded_as_not_ok(
    audit_client: TestClient, http_daemon: dict[str, Any], audit_log: Path, abort: Abort
) -> None:
    # a row recorded ok would claim the staged set landed when the lane raised
    rows = aborted_rows(audit_client, http_daemon, audit_log, abort)
    assert [row["ok"] for row in rows] == [False]


def test_an_aborted_apply_records_the_preset_switch_it_asked_for(
    audit_client: TestClient, http_daemon: dict[str, Any], audit_log: Path
) -> None:
    body = {"switch_to": SWITCH_TO, "save": {"name": SAVE_NAME}}
    rows = aborted_rows(audit_client, http_daemon, audit_log, CONFIG_LANE_DOWN, body)
    assert [row["switch_to"] for row in rows] == [SWITCH_TO]


def test_an_aborted_apply_records_the_save_target_it_asked_for(
    audit_client: TestClient, http_daemon: dict[str, Any], audit_log: Path
) -> None:
    body = {"switch_to": SWITCH_TO, "save": {"name": SAVE_NAME}}
    rows = aborted_rows(audit_client, http_daemon, audit_log, CONFIG_LANE_DOWN, body)
    assert [row["save"] for row in rows] == [SAVE_NAME]


# --- an apply refused before anything reaches the engine ----------------------
#
# Refused by HQPTuner itself, not aborted by a lane: nothing was sent, so there
# is no attempted apply to record.

#: A preset name the store has never held.
UNHELD_PRESET = "Never Stored Preset"

#: A name the shared preset name rule refuses: the separator breaks the store's filename.
INVALID_NAME = "x/y"

#: Preset switches refused by name, each beside a staged edit so the refusal is
#: the name's and not an empty stage's.
REFUSED_SWITCHES = [
    pytest.param(UNHELD_PRESET, id="unheld-preset"),
    pytest.param(INVALID_NAME, id="invalid-name"),
]


#: The two events a stage-then-apply can leave: the stage's row and the apply's.
STAGE_AND_APPLY = ("stage", "apply")


def refused_apply_events(client: TestClient, log: Path, switch_to: str) -> list[str]:
    """The ``stage`` and ``apply`` events the log holds, oldest first, after an
    edit is staged and an apply refused for its ``switch_to``. A request not
    refused with a 4xx was not a refusal, and the scene refuses to run."""
    client.post("/api/config/stage", json={"http": {"title": TITLE}})
    status: int = client.post("/api/config/apply", json={"switch_to": switch_to}).status_code
    if not 400 <= status < 500:
        raise FixtureError(reason=f"the apply answered {status}, so it was not refused")
    return [str(record["event"]) for record in records(log) if record.get("event") in STAGE_AND_APPLY]


@pytest.mark.parametrize("switch_to", REFUSED_SWITCHES)
def test_an_apply_refused_for_its_preset_switch_writes_no_apply_row(
    audit_client: TestClient, audit_log: Path, switch_to: str
) -> None:
    # the stage's row alone: an apply row beside it would put an apply on the
    # record that never touched the engine
    assert refused_apply_events(audit_client, audit_log, switch_to) == ["stage"]
