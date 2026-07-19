"""The /matrix post-processing lane (Bauer crossfeed / DAC correction), through
the faithful fake (docs/testing.md). Two behaviours: the serializer never emits
a file input (which would clear a loaded matrix/convolution filter), and a
staged post_* field routes to POST /matrix — not /config — and round-trips.
"""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from hqptuner.config import Config
from hqptuner.httpconf import HttpConfigClient, serialize_config_form
from hqptuner.manager import ConnectionManager


def test_serialize_omits_file_inputs() -> None:
    fields = [
        {"name": "post_bauer_frequency", "type": "number", "value": 700},
        {"name": "filter_0", "type": "file", "value": ""},
    ]
    assert "filter_0" not in serialize_config_form(fields)


@pytest.fixture
async def matrix_apply(
    http_daemon: dict[str, Any],
    tmp_path: Path,
) -> AsyncIterator[tuple[ConnectionManager, HttpConfigClient]]:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    manager = ConnectionManager(Config(alarm_threshold=1.0, backup_dir=tmp_path), http)
    manager.matrix_form = await http.get_matrix()  # normally loaded on connect
    yield manager, http
    await http.aclose()


async def test_matrix_field_applies_via_matrix_form(
    matrix_apply: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = matrix_apply
    await manager.apply({}, {"post_bauer_frequency": "500"})
    fields = {f["name"]: f["value"] for f in (await http.get_matrix())["fields"]}
    assert fields["post_bauer_frequency"] == 500
