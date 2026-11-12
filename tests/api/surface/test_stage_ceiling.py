"""A staged value and the staged buffer are bounded: an oversized value or a flood of field names is refused.

The over-ceiling inputs are literal sizes, far past anything the UI stages, so the cases name no constant.
"""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import live_app
from conftest import spawn_threaded_daemon
from fake_control import CommandLog
from fastapi.testclient import TestClient

_MIB = 1024 * 1024
_ROW = {"source": "0", "gain": "-3", "gainunit": "dB", "mixdown": "0"}
_PROCESS = "/home/hqp/filters/" + ";".join(f"filter-{n}.wav" for n in range(24))


@pytest.fixture
def logged_live_api(tmp_path: Path) -> Iterator[tuple[TestClient, CommandLog]]:
    """The two-lane app on a fake 4321 daemon whose received commands land in the returned log."""
    log: CommandLog = []
    daemon = spawn_threaded_daemon(log=log)
    app = live_app(next(daemon), tmp_path)
    yield next(app), log
    next(app, None)
    next(daemon, None)


def _pending(client: TestClient) -> dict[str, dict[str, str]]:
    pending: dict[str, dict[str, str]] = client.get("/api/config/pending").json()
    return pending


def test_a_one_mebibyte_value_is_refused_at_stage(http_client: TestClient) -> None:
    resp = http_client.post("/api/config/stage", json={"http": {"title": "x" * _MIB}})
    assert resp.json()["code"] == "invalid_input"


def test_a_refused_oversized_value_leaves_the_buffer_unchanged(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "kept"}})
    http_client.post("/api/config/stage", json={"http": {"title": "x" * _MIB}})
    assert _pending(http_client)["http"] == {"title": "kept"}


def test_a_oversized_live_argument_is_refused_at_stage(http_client: TestClient) -> None:
    resp = http_client.post("/api/config/stage", json={"live": {"junk_filter": {"value": "x" * _MIB}}})
    assert resp.json()["code"] == "invalid_input"


def test_ten_thousand_field_names_are_refused_at_stage(http_client: TestClient) -> None:
    resp = http_client.post("/api/config/stage", json={"http": {f"field_{n}": "1" for n in range(10_000)}})
    assert resp.json()["code"] == "invalid_input"


def test_a_refused_flood_of_field_names_leaves_the_buffer_unchanged(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "kept"}})
    http_client.post("/api/config/stage", json={"http": {f"field_{n}": "1" for n in range(10_000)}})
    assert _pending(http_client)["http"] == {"title": "kept"}


def test_a_flood_arriving_in_small_requests_is_refused_once_the_buffer_is_full(http_client: TestClient) -> None:
    codes = [
        http_client.post("/api/config/stage", json={"http": {f"field_{n}": "1" for n in range(start, start + 500)}})
        .json()
        .get("code")
        for start in range(0, 10_000, 500)
    ]
    assert "invalid_input" in codes


def test_a_full_matrix_of_realistic_rows_still_stages(http_client: TestClient) -> None:
    rows = [{**_ROW, "process": _PROCESS} for _ in range(128)]
    resp = http_client.post("/api/config/stage", json={"http": {"matrix_pipelines": json.dumps(rows)}})
    assert resp.status_code == 200


def test_a_one_mebibyte_live_value_is_refused(logged_live_api: tuple[TestClient, CommandLog]) -> None:
    client, _ = logged_live_api
    resp = client.post("/api/config/live", json={"fields": {"junk_filter": "1" * _MIB}})
    assert resp.json()["code"] == "invalid_input"


def _setters(log: CommandLog) -> list[str]:
    return [name for name, _ in log if name.startswith("Set")]


def test_a_refused_live_value_sends_no_setter(logged_live_api: tuple[TestClient, CommandLog]) -> None:
    client, log = logged_live_api
    client.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    sent = _setters(log)
    client.post("/api/config/live", json={"fields": {"junk_filter": "1" * _MIB}})
    assert _setters(log) == sent
