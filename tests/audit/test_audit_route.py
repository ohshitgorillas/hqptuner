"""Reading the audit log back over REST (docs/testing.md).

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

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config


def _app(daemon: dict[str, Any], tmp_path: Path, port: int, debug_log: Path | None) -> Iterator[TestClient]:
    """The REST surface on the fake 8088 daemon (the `http_client` shape), with
    the audit log pointed wherever the case wants it — or disabled."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=port,
        hqp_http_port=daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        hqp_home="/x/home",
        debug_log=debug_log,
    )
    with TestClient(create_app(cfg)) as client:
        yield client


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def audit_client(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int, audit_log: Path
) -> Iterator[TestClient]:
    yield from _app(http_daemon, tmp_path, closed_port, audit_log)


@pytest.fixture
def unlogged_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """The same app with the audit log unset — the disabled case."""
    yield from _app(http_daemon, tmp_path, closed_port, None)


# --- driving the write paths, and reading them back over the route ------------


def stage_title(client: TestClient, value: str = "Renamed") -> None:
    """The cheapest write that leaves a record: one staged http-lane edit."""
    client.post("/api/config/stage", json={"http": {"title": value}})


def stage_several(client: TestClient, count: int) -> None:
    """`count` separate staged edits, so the log holds that many stage records."""
    for index in range(count):
        stage_title(client, f"Renamed {index}")


def highest_seq(path: Path) -> int:
    """The newest record's `seq`, read off the file itself with a plain
    `json.loads` per line — the wiring suite's way, so the route is checked
    against the log rather than against itself."""
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return max(int(json.loads(line)["seq"]) for line in lines)


def fetched(client: TestClient, **params: Any) -> list[dict[str, Any]]:
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


def test_the_audit_route_returns_the_records_the_activity_produced(audit_client: TestClient) -> None:
    stage_title(audit_client)
    assert fetched(audit_client) != []


def test_a_returned_record_carries_the_event_key(audit_client: TestClient) -> None:
    # the envelope, not some other shape: ts/seq/event plus the event's fields
    stage_title(audit_client)
    assert "event" in fetched(audit_client)[-1]


# --- limit and ordering -------------------------------------------------------


def test_the_limit_bounds_how_many_records_come_back(audit_client: TestClient) -> None:
    stage_several(audit_client, 5)
    assert len(fetched(audit_client, limit=2)) == 2


def test_a_limited_response_carries_the_newest_records_not_the_oldest(
    audit_client: TestClient, audit_log: Path
) -> None:
    # the whole point of the parameter: a `tail` implemented as "first n" would
    # still return two records, and would still return them in seq order — only
    # the newest record's seq tells the two implementations apart
    stage_several(audit_client, 5)
    newest = highest_seq(audit_log)
    assert fetched(audit_client, limit=2)[-1]["seq"] == newest


def test_the_records_come_back_oldest_first_by_seq(audit_client: TestClient) -> None:
    # ordering is asserted on the monotonic counter, never on timestamps: two
    # records written in the same clock tick carry the same ts and would make a
    # timestamp check pass on any order
    stage_several(audit_client, 5)
    seqs = [record["seq"] for record in fetched(audit_client)]
    assert seqs == sorted(seqs)
