"""Convolution filter upload lane (matrix-spec.md "Filter upload"): parked wav/txt files
ride the next persistent apply's restore archive as data/<name> members — where
the daemon lands them in its home dir, so the staged process path resolves."""

import json
from typing import Any

import pytest
from conftest import ManagerFactory, minimal_wave
from fastapi.testclient import TestClient
from narrow import FixtureError

from hqptuner.core.manager import ConnectionManager

ROWS = json.dumps(
    [
        {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": "/x/home/probe.wav"},
        {"source": "1", "gain": "0", "gainunit": "dB", "mixdown": "1", "process": ""},
    ]
)

#: What the park does with a name (spec `filter-upload-bdfd` line 3): a path, a
#: `process` list separator, a control byte and a leading dot are refused, not
#: rewritten, because a rewritten name is one the user never typed; plain
#: punctuation is stored as typed.
NAME_OUTCOMES = [
    pytest.param("../../etc/evil.wav", ValueError, id="path-components"),
    pytest.param("a,b.wav", ValueError, id="process-list-separator"),
    pytest.param("ctrl\x00null.wav", ValueError, id="control-byte"),
    pytest.param(".hidden.wav", ValueError, id="leading-dot"),
    pytest.param("Left (v2) 'final'.wav", "Left (v2) 'final'.wav", id="parenthesized-and-quoted"),
]


def _park_outcome(manager: ConnectionManager, name: str) -> str | type[ValueError]:
    """The stored name, or `ValueError` when the park refused the name."""
    try:
        return manager.presetops.park_filter(name, minimal_wave())["name"]
    except ValueError:
        return ValueError


@pytest.fixture
def manager(http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]) -> ConnectionManager:
    """A daemon home the parked-filter path assertions can be read verbatim."""
    return http_manager_factory(http_daemon, hqp_home="/x/home")


async def test_parked_filter_rides_the_restore_archive(manager: ConnectionManager, http_daemon: dict[str, Any]) -> None:
    manager.presetops.park_filter("probe.wav", minimal_wave())
    await manager.applyops.apply({}, {"matrix_pipelines": ROWS})
    assert "data/probe.wav" in http_daemon["_restore_members"]


def test_park_returns_the_daemon_home_path(manager: ConnectionManager) -> None:
    assert manager.presetops.park_filter("probe.wav", minimal_wave())["path"] == "/x/home/probe.wav"


def test_colliding_upload_name_gets_a_serial_suffix(manager: ConnectionManager) -> None:
    manager.presetops.park_filter("probe.wav", minimal_wave())
    assert manager.presetops.park_filter("probe.wav", minimal_wave())["name"] == "probe-1.wav"


@pytest.mark.parametrize(("name", "expected"), NAME_OUTCOMES)
def test_an_unsafe_name_is_refused_and_a_plain_one_stored_unchanged(
    manager: ConnectionManager, name: str, expected: str | type[ValueError]
) -> None:
    assert _park_outcome(manager, name) == expected


def test_parametric_eq_txt_is_accepted(manager: ConnectionManager) -> None:
    assert manager.presetops.park_filter("autoeq.txt", b"Preamp: -6.4 dB")["name"] == "autoeq.txt"


def _apply_pipelines(client: TestClient, pipelines: str, code: str | None) -> None:
    """Stage and apply that pipeline value through the REST surface, which shares the park on disk;
    refuse to go on unless the apply answered ``code`` (None: not refused)."""
    client.post("/api/config/stage", json={"http": {"matrix_pipelines": pipelines}})
    got = client.post("/api/config/apply").json().get("code")
    if got != code:
        raise FixtureError(reason=f"the apply was meant to answer code {code!r}, got {got!r}")


APPLY_OUTCOMES = [
    pytest.param(ROWS, None, [], id="accepted-clears"),
    pytest.param("not json", "invalid_input", ["data/probe.wav"], id="refused-keeps"),
]


@pytest.mark.parametrize(("pipelines", "code", "expected"), APPLY_OUTCOMES)
def test_an_apply_clears_the_parking_area_only_when_it_succeeds(
    manager: ConnectionManager, http_client: TestClient, pipelines: str, code: str | None, expected: list[str]
) -> None:
    manager.presetops.park_filter("probe.wav", minimal_wave())
    _apply_pipelines(http_client, pipelines, code)
    assert list(manager.presetops.parked_filter_members()) == expected
