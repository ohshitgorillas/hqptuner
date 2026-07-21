"""Matrix profile operations (matrix-spec step 5): the live 4321 switch and the
form-lane save/delete/load — whose wire contract (complete form, checkbox
value-attr encoding) the fake records verbatim, since violating it on the real
daemon ranges from silent no-op to a wedged engine (probe findings)."""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from hqptuner.config import Config
from hqptuner.control import ControlClient
from hqptuner.httpconf import HttpConfigClient
from hqptuner.manager import ConnectionManager


@pytest.fixture
async def manager(http_daemon: dict[str, Any], tmp_path: Path) -> AsyncIterator[ConnectionManager]:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    mgr = ConnectionManager(Config(alarm_threshold=1.0, backup_dir=tmp_path), http)
    yield mgr
    await http.aclose()


async def test_live_switch_reads_back_from_state(live_client: ControlClient) -> None:
    await live_client.set_matrix_profile("Mch-to-Stereo mixdown")
    assert (await live_client.get_state())["matrix_profile"] == "Mch-to-Stereo mixdown"


async def test_save_adds_the_profile_to_the_daemon_list(
    manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    await manager.matrix_profile_action("save", "Crossfeed EQ")
    assert "Crossfeed EQ" in http_daemon["_matrix_profiles"]


async def test_delete_removes_the_profile_from_the_daemon_list(
    manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    await manager.matrix_profile_action("delete", "Mch-to-Stereo mixdown")
    assert "Mch-to-Stereo mixdown" not in http_daemon["_matrix_profiles"]


async def test_load_sets_the_active_profile_label(manager: ConnectionManager, http_daemon: dict[str, Any]) -> None:
    await manager.matrix_profile_action("load", "Default")
    assert http_daemon["matrix_active"] == "Default"


async def test_profile_post_carries_the_complete_form(manager: ConnectionManager, http_daemon: dict[str, Any]) -> None:
    await manager.matrix_profile_action("save", "New")
    assert {"engine", "iir2fir", "source_0", "gain_0", "gainunit_0", "mixdown_0", "process_1"} <= set(
        http_daemon["_matrix_post"]
    )


async def test_profile_post_encodes_checkboxes_as_their_value_attr(
    manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    await manager.matrix_profile_action("save", "New")
    assert http_daemon["_matrix_post"]["enabled"] == "1"


async def test_unknown_action_is_refused(manager: ConnectionManager) -> None:
    with pytest.raises(ValueError, match="unknown matrix profile action"):
        await manager.matrix_profile_action("rename", "X")
