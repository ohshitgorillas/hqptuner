"""The post-processing controls (Bauer crossfeed / DAC correction) through the
faithful fake (docs/testing.md). A staged post_* field rides the persistent
restore lane — the manager edits its <post_process><plugin> node in the snapshot
— and the change appears in the running config's /matrix readback.
"""

import pytest

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.manager import ConnectionManager


@pytest.fixture
def matrix_apply(http_manager: ConnectionManager) -> tuple[ConnectionManager, HttpConfigClient]:
    """The manager plus its config client — these assertions read the daemon's
    own /matrix back, not the manager's cached form."""
    return http_manager, http_manager.require_http()


async def test_crossfeed_field_reaches_the_running_config(
    matrix_apply: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = matrix_apply
    await manager.apply({}, {"post_bauer_frequency": "500"})
    fields = {f["name"]: f["value"] for f in (await http.get_matrix())["fields"]}
    assert fields["post_bauer_frequency"] == 500
