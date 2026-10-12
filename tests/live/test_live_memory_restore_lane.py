"""What LIVE remembers for the loaded chain after a staged apply whose config half took the restore lane.

A staged batch carrying a restart-required field sends its whole config half down the
restore lane, while its live half still goes to the engine. A config field that rode the
restore was never confirmed by the engine live, so it never comes back on the engine as if
applied live, even where it shares the Control API setter of a live-half setting that
verified in the same apply. A restore the daemon refuses does not restart it, so nothing
clears the chain's memory; what that memory holds goes back on the engine when the chain is
loaded again, and the assertion is on the traffic the fake control daemon receives on that
re-entry.

The engine starts on the PCM chain. The live half carries the raw PCM filter index 2,
sinc-M; the config half carries PCM filter enum 57, which sits at index 3 on the fake's PCM
filter list (`tests/support/fake_control.py`). A config value remembered as live would
reach the wire as index 3.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The live half: the PCM filter at raw list index 2, sinc-M.
LIVE_FILTER_INDEX = "2"
#: The config half's PCM filter, enum 57 (PCM index 3).
RESTORED_FILTER = {"filter": "57"}
#: The PCM list index enum 57 reaches the wire as, were it remembered as applied live.
RESTORED_FILTER_INDEX = "3"
#: A restart-required title change, which sends the whole config half down the restore lane.
TITLE = {"title": "Renamed"}
#: More restore refusals than any apply makes attempts.
EVERY_RESTORE_REFUSED = 10_000

#: The live writes that load the SDM chain and then the PCM chain again.
ENTER_SDM = {"mode": "sdm"}
ENTER_PCM = {"mode": "pcm"}


@pytest.fixture
def control_log() -> CommandLog:
    return []


@pytest.fixture
def control_port(control_log: CommandLog) -> Iterator[int]:
    yield from spawn_threaded_daemon(state={**DEFAULTS, "_cfg_dither": "0", "_cfg_modulator": "0"}, log=control_log)


@pytest.fixture
def config_daemon() -> Iterator[dict[str, Any]]:
    server = fake_http.spawn(fake_http.state(mode="pcm", dither="0", modulator="0"))
    yield next(server)
    next(server, None)


def _config_loaded(client: TestClient) -> bool:
    resp = client.get("/api/config")
    return resp.status_code == 200 and "title" in resp.json()["data"]["file"]


@pytest.fixture
def client(control_port: int, config_daemon: dict[str, Any], tmp_path: Path) -> Iterator[TestClient]:
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=config_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg, VirtualClock())) as test_client:
        wait_for_api(test_client, _config_loaded)
        yield test_client


def _filter_values_sent(log: CommandLog) -> list[str]:
    return [attrs.get("value", "") for name, attrs in log if name == "SetFilter"]


def test_reentering_the_chain_never_sends_a_shared_setter_field_whose_restore_was_refused(
    client: TestClient, config_daemon: dict[str, Any], control_log: CommandLog
) -> None:
    config_daemon["_restore_refusals"] = EVERY_RESTORE_REFUSED
    client.post(
        "/api/config/stage",
        json={"http": {**RESTORED_FILTER, **TITLE}, "live": {"filter": {"value": LIVE_FILTER_INDEX}}},
    )
    client.post("/api/config/apply")
    client.post("/api/config/live", json={"fields": ENTER_SDM})
    reentry = len(control_log)
    client.post("/api/config/live", json={"fields": ENTER_PCM})
    assert RESTORED_FILTER_INDEX not in _filter_values_sent(control_log[reentry:])
