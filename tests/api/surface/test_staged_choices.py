"""A staged value its own page does not offer is refused at stage, and nothing is staged or written.

The pages are the fake 8088 daemon's own captures, so the choices are the daemon's.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import unserved_login
from fastapi.testclient import TestClient
from fixtures_clients import Lanes
from virtual_clock import VirtualClock

from hqptuner.config import Config


@pytest.fixture
def unloaded_client(tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """An app started with neither lane answering, so no page was ever read."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_username="u",
        hqp_password="p",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with unserved_login(cfg, VirtualClock()) as client:
        yield client


def _stage(lanes: Lanes, **http: str) -> str | None:
    answer: str | None = lanes.post("/api/config/stage", {"http": http}).json().get("code")
    return answer


def test_a_flag_spelled_on_is_refused_at_stage(lanes: Lanes) -> None:
    assert _stage(lanes, matrix_enabled="on") == "invalid_input"


def test_a_refused_value_leaves_the_buffer_as_it_was(lanes: Lanes) -> None:
    _stage(lanes, title="kept")
    _stage(lanes, matrix_enabled="on")
    assert lanes.client.get("/api/config/pending").json()["http"] == {"title": "kept"}


def test_an_apply_after_a_refused_value_sends_no_restore(lanes: Lanes) -> None:
    sent = lanes.http["_restore_attempts"]
    _stage(lanes, matrix_enabled="on")
    lanes.post("/api/config/apply", {})
    assert lanes.http["_restore_attempts"] == sent


def test_a_filter_the_page_does_not_list_is_refused_at_stage(lanes: Lanes) -> None:
    assert _stage(lanes, filter="999999") == "invalid_input"


def test_a_value_the_page_offers_is_staged(lanes: Lanes) -> None:
    _stage(lanes, matrix_enabled="1")
    assert lanes.client.get("/api/config/pending").json()["http"] == {"matrix_enabled": "1"}


def test_a_staged_value_before_its_page_is_loaded_answers_not_loaded(unloaded_client: TestClient) -> None:
    resp = unloaded_client.post("/api/config/stage", json={"http": {"title": "x"}})
    assert resp.json().get("code") == "not_loaded"
