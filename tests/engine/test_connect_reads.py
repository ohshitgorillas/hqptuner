"""What a connect costs the 8088 lane: each whole-payload read the connect body
needs is fetched once, however many of its steps consume it.

The settings archive (~5 MB on a real daemon) feeds both the file-config view and
the one-time preset migration, and the device-capability read wants the whole
log; the fake 8088 daemon counts every arrival of each."""

from typing import Any

from conftest import StartManager


async def _connected(start_manager: StartManager, http_daemon: dict[str, Any]) -> None:
    """Run a manager through its first connect against the 8088 fake, then let it idle."""
    port = http_daemon["_port"]
    await start_manager(port, hqp_http_port=port)


async def test_a_connect_reads_the_settings_archive_once(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    await _connected(start_manager, http_daemon)
    assert http_daemon["_backup_reads"] == 1


async def test_a_connect_reads_the_log_once(start_manager: StartManager, http_daemon: dict[str, Any]) -> None:
    await _connected(start_manager, http_daemon)
    assert http_daemon["_log_reads"] == 1
