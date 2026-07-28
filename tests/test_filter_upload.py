"""Convolution filter upload lane (matrix-spec.md "Filter upload"): parked wav/txt files
ride the next persistent apply's restore archive as data/<name> members — where
the daemon lands them in its home dir, so the staged process path resolves."""

import json
from typing import Any

import pytest
from conftest import ManagerFactory

from hqptuner.manager import ConnectionManager

ROWS = json.dumps(
    [
        {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": "/x/home/probe.wav"},
        {"source": "1", "gain": "0", "gainunit": "dB", "mixdown": "1", "process": ""},
    ]
)


@pytest.fixture
def manager(http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]) -> ConnectionManager:
    """A daemon home the parked-filter path assertions can be read verbatim."""
    return http_manager_factory(http_daemon, hqp_home="/x/home")


async def test_parked_filter_rides_the_restore_archive(manager: ConnectionManager, http_daemon: dict[str, Any]) -> None:
    manager.park_filter("probe.wav", b"RIFFxxxx")
    await manager.apply({}, {"matrix_pipelines": ROWS})
    assert "data/probe.wav" in http_daemon["_restore_members"]


def test_park_returns_the_daemon_home_path(manager: ConnectionManager) -> None:
    assert manager.park_filter("probe.wav", b"RIFF")["path"] == "/x/home/probe.wav"


def test_colliding_upload_name_gets_a_serial_suffix(manager: ConnectionManager) -> None:
    manager.park_filter("probe.wav", b"a")
    assert manager.park_filter("probe.wav", b"b")["name"] == "probe-1.wav"


def test_path_components_are_stripped_from_upload_names(manager: ConnectionManager) -> None:
    assert manager.park_filter("../../etc/evil.wav", b"RIFF")["name"] == "evil.wav"


def test_non_filter_extension_is_refused(manager: ConnectionManager) -> None:
    with pytest.raises(ValueError, match=r"wav or \.txt"):
        manager.park_filter("payload.exe", b"MZ")


def test_parametric_eq_txt_is_accepted(manager: ConnectionManager) -> None:
    assert manager.park_filter("autoeq.txt", b"Preamp: -6.4 dB")["name"] == "autoeq.txt"


async def test_successful_apply_clears_the_parking_area(manager: ConnectionManager) -> None:
    manager.park_filter("probe.wav", b"RIFF")
    await manager.apply({}, {"matrix_pipelines": ROWS})
    assert manager.parked_filter_members() == {}


async def test_failed_apply_keeps_the_parked_file(manager: ConnectionManager) -> None:
    manager.park_filter("probe.wav", b"RIFF")
    await manager.apply({}, {"matrix_pipelines": "not json"})
    assert list(manager.parked_filter_members()) == ["data/probe.wav"]
