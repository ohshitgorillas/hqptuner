"""HTTP-lane persistent apply, end to end through a faithful fake config daemon
(docs/testing.md). The fake (conftest `http_daemon` and its variants) speaks the
real wire contract discovered on 6.0.4: it rejects a partial form, rejects a
checkbox sent as anything but "1", answers HTTP 200 even when it rejects, and
its GET reflects persisted state. So a change only "round-trips" if
`manager.apply` produced a submission the real daemon would accept — any
serialization fault (dropped field, `on`, partial) makes the fake reject and
the readback fail."""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from hqptuner.config import Config
from hqptuner.httpconf import HttpConfigClient
from hqptuner.manager import ConnectionManager


def _manager(daemon: dict[str, Any], tmp_path: Path, alarm: float) -> tuple[ConnectionManager, HttpConfigClient]:
    http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
    # backup lands in a tmp dir, not the repo; small alarm so a rejected apply
    # polls only briefly before it times out
    manager = ConnectionManager(Config(alarm_threshold=alarm, backup_dir=tmp_path), http)
    return manager, http


@pytest.fixture
async def apply_via(
    http_daemon: dict[str, Any],
    tmp_path: Path,
) -> AsyncIterator[tuple[ConnectionManager, HttpConfigClient]]:
    manager, http = _manager(http_daemon, tmp_path, alarm=1.0)
    yield manager, http
    await http.aclose()


async def _readback(http: HttpConfigClient) -> dict[str, Any]:
    return {f["name"]: f["value"] for f in (await http.get_config())["fields"]}


async def test_staged_persistent_change_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.apply({}, {"title": "Renamed"})
    assert (await _readback(http))["title"] == "Renamed"


async def test_enabling_a_checkbox_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.apply({}, {"net_dop": "1"})
    assert (await _readback(http))["net_dop"] is True


@pytest.mark.parametrize(
    ("field", "expected"),
    [("auto_family", True), ("samplerate", "0"), ("bitrate", "0")],
)
async def test_config_write_pins_the_field_regardless_of_staging(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
    field: str,
    expected: Any,
) -> None:
    # HQPTuner's friendly-rate UI only holds if every config write forces
    # auto_family on and the fixed sample/bit rate to Auto (0). The daemon starts
    # with the opposite values (see _http_state), and nothing here stages these
    # fields — so seeing the pinned value proves the write forced it.
    manager, http = apply_via
    await manager.apply({}, {"title": "Renamed"})
    assert (await _readback(http))[field] == expected


async def test_apply_reports_failure_when_the_daemon_rejects(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, _ = apply_via
    report = await manager.apply({}, {"title": "REJECT"})
    assert report["http"]["verified"]["applied"] is False


async def test_a_rejected_apply_is_reported_as_rejected(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # the daemon stays up and keeps serving the old form — a bad value, not a
    # crashed restart, so the reason must be "rejected"
    manager, _ = apply_via
    report = await manager.apply({}, {"title": "REJECT"})
    assert report["http"]["verified"]["reason"] == "rejected"


async def test_a_daemon_that_never_returns_is_reported_as_unreachable(
    dying_http_daemon: dict[str, Any],
    tmp_path: Path,
) -> None:
    # the daemon accepts the POST then never comes back; a rejection would keep
    # serving, so the end-state connection failure must read as "unreachable"
    manager, http = _manager(dying_http_daemon, tmp_path, alarm=1.0)
    try:
        report = await manager.apply({}, {"title": "Renamed"})
    finally:
        await http.aclose()
    assert report["http"]["verified"]["reason"] == "unreachable"


async def test_the_pre_apply_backup_is_written_to_disk(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
    tmp_path: Path,
) -> None:
    # a crash mid-apply must leave a recoverable copy behind, so the backup is
    # persisted before the POST, not just held in memory
    manager, _ = apply_via
    await manager.apply({}, {"title": "Renamed"})
    assert (tmp_path / "pre-apply-settings.zip").read_bytes() == b"PK\x03\x04"


async def test_apply_verifies_through_the_post_restart_stale_window(
    stale_http_daemon: dict[str, Any],
    tmp_path: Path,
) -> None:
    # the daemon serves the old form for a read after the POST; a single-GET
    # verify would false-negative here — the poll must ride through the stale read
    manager, http = _manager(stale_http_daemon, tmp_path, alarm=3.0)
    try:
        report = await manager.apply({}, {"title": "Renamed"})
    finally:
        await http.aclose()
    assert report["http"]["verified"]["applied"] is True
