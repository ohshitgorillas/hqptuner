"""An exception no registered handler maps still answers in the shared error
shape, and its traceback reaches the in-memory log ring the state zip exports.

The fault is planted as an extra route on the app under test, raising an
exception type defined here, so nothing in HQPTuner can have a handler for it.

At startup the log ring is attached to the root logger; `create_app` does not
do that, so the ring fixture attaches it the same way for the length of a case.
"""

import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.logbuffer import RECENT

FAULT_PATH = "/api/planted-fault"
INTERNAL_ERROR_CODE = "internal_error"


class PlantedFaultError(Exception):
    """A fault type no handler in HQPTuner can name."""


def raise_a_fault_no_handler_maps() -> None:
    """The planted route. Its name is the needle: it appears in the traceback's
    frames and nowhere in the exception's own message."""
    raise PlantedFaultError


@pytest.fixture
def faulting_client(tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_username="",
        hqp_password="",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    app = create_app(cfg, VirtualClock())
    app.add_api_route(FAULT_PATH, raise_a_fault_no_handler_maps, methods=["GET"])
    # the server's own re-raise is not the contract; the response is
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def ring_on_root() -> Iterator[None]:
    root = logging.getLogger()
    already_attached = RECENT in root.handlers
    root.addHandler(RECENT)
    yield
    if not already_attached:
        root.removeHandler(RECENT)


def body_code(response: Response) -> object:
    """The `code` field of a JSON object body, or None when the body is not one."""
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    return body.get("code")


def test_an_exception_no_handler_maps_answers_with_code_internal_error(faulting_client: TestClient) -> None:
    assert body_code(faulting_client.get(FAULT_PATH)) == INTERNAL_ERROR_CODE


@pytest.mark.usefixtures("ring_on_root")
def test_the_traceback_of_an_exception_no_handler_maps_reaches_the_log_ring(faulting_client: TestClient) -> None:
    faulting_client.get(FAULT_PATH)
    assert raise_a_fault_no_handler_maps.__name__ in "\n".join(RECENT.lines())
