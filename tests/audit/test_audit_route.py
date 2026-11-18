"""Reading the audit log back over REST.

`GET /api/audit` is the operator's window onto the same JSONL envelope
`test_audit_wiring.py` asserts on from the file side. Two facts shape every case
here. The route exists only when `Config.debug_log` is set — with logging off it
is not registered at all, so an operator gets a 404 rather than an endpoint
answering "no records", which would be indistinguishable from a quiet log. And
the records it returns are produced by driving the real REST write paths against
the faithful fake 8088 daemon, never by writing the file by hand: these are
wiring cases, and a hand-seeded file would stay green even if the app emitted
nothing at all.
"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

# --- driving the write paths, and reading them back over the route ------------


def stage_title(client: TestClient, value: str = "Renamed") -> None:
    """The cheapest write that leaves a record: one staged http-lane edit."""
    client.post("/api/config/stage", json={"http": {"title": value}})


def stage_several(client: TestClient, count: int) -> None:
    """`count` separate staged edits, so the log holds that many stage records."""
    for index in range(count):
        stage_title(client, f"Renamed {index}")


def fetched(client: TestClient, **params: int) -> list[dict[str, Any]]:
    response = client.get("/api/audit", params=params)
    records: list[dict[str, Any]] = response.json()["records"]
    return records


# --- the route exists only when logging is on ---------------------------------


def test_the_audit_route_is_absent_when_the_log_is_disabled(unlogged_client: TestClient) -> None:
    # not an empty answer: "logging is off" must be tellable from "logging is on
    # and nothing happened", and only a 404 says the former
    assert unlogged_client.get("/api/audit").status_code == 404


def test_the_audit_route_answers_when_the_log_is_enabled(audit_client: TestClient) -> None:
    assert audit_client.get("/api/audit").status_code == 200


# --- what it hands back -------------------------------------------------------


def discard_pending(client: TestClient) -> None:
    """Throw the staged buffer away, which leaves a discard record."""
    client.delete("/api/config/pending")


@pytest.mark.parametrize(
    ("activity", "events"),
    [([stage_title], ["stage"]), ([stage_title, discard_pending], ["stage", "discard"])],
    ids=["one event", "two events"],
)
def test_the_audit_route_returns_the_records_the_activity_produced(
    audit_client: TestClient, activity: list[Callable[[TestClient], None]], events: list[str]
) -> None:
    for act in activity:
        act(audit_client)
    assert [record["event"] for record in fetched(audit_client)] == events


# --- limit and ordering -------------------------------------------------------


def test_the_limit_bounds_how_many_records_come_back(audit_client: TestClient) -> None:
    stage_several(audit_client, 5)
    assert len(fetched(audit_client, limit=2)) == 2
