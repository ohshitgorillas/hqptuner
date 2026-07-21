"""The post-processing controls (Bauer crossfeed / DAC correction) through the
faithful fake (docs/testing.md). A staged post_* field rides the persistent
restore lane — the manager edits its <post_process><plugin> node in the snapshot
— and the change appears in the running config's /matrix readback.
"""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.manager import ConnectionManager


@pytest.fixture
async def matrix_apply(
    http_daemon: dict[str, Any],
    tmp_path: Path,
) -> AsyncIterator[tuple[ConnectionManager, HttpConfigClient]]:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    manager = ConnectionManager(Config(alarm_threshold=1.0, backup_dir=tmp_path), http)
    yield manager, http
    await http.aclose()


async def test_crossfeed_field_reaches_the_running_config(
    matrix_apply: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = matrix_apply
    await manager.apply({}, {"post_bauer_frequency": "500"})
    fields = {f["name"]: f["value"] for f in (await http.get_matrix())["fields"]}
    assert fields["post_bauer_frequency"] == 500
