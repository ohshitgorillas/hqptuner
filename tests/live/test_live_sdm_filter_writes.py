"""A PCM-source filter written live in SDM output mode is one `SetFilter` and nothing else.

The page pick, the bottom switcher, Filter presets and Easy Mode all write a 1x or Nx
filter through `POST /api/config/live`. With the SDM chain loaded the engine takes the
write on that chain: no `SetMode`, and no `POST /restore` to the config lane, which would
restart the daemon under the listener. The app runs against both fakes, so the 4321
command log shows what reached the engine and the 8088 fake counts the restores.

Enum ID 23 is `sinc-M` on the fake's SDM filter list.
"""

import contextlib
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from apps import phase_is_ready, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog
from fixtures_clients import app

#: The fake's State mode index for SDM.
SDM_MODE = "2"
#: An enum ID on the fake's SDM filter list.
SINC_M_ID = "23"
#: The two PCM-source filter fields of the SDM chain.
SDM_FILTER_FIELDS = ["oversampling1x", "oversampling"]


class Write(NamedTuple):
    """What one live write put on each wire: the commands the engine received after the
    write, and the config lane's restore arrivals before and after it."""

    commands: list[str]
    restores_before: int
    restores_after: int


@pytest.fixture
def written(http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[Callable[[str], Write]]:
    stack = contextlib.ExitStack()

    def write(field: str) -> Write:
        log: CommandLog = []
        ports = spawn_threaded_daemon(state={**DEFAULTS, "mode": SDM_MODE}, log=log)
        port = next(ports)
        stack.callback(next, ports, None)
        clients = app(http_daemon, tmp_path, port, None)
        client = next(clients)
        stack.callback(next, clients, None)
        wait_for_api(client, phase_is_ready)
        sent, restores = len(log), http_daemon["_restore_attempts"]
        client.post("/api/config/live", json={"fields": {field: SINC_M_ID}})
        return Write([name for name, _attrs in log[sent:]], restores, http_daemon["_restore_attempts"])

    yield write
    stack.close()


@pytest.mark.parametrize("field", SDM_FILTER_FIELDS)
def test_a_live_filter_write_in_sdm_mode_sends_one_set_filter(written: Callable[[str], Write], field: str) -> None:
    assert written(field).commands.count("SetFilter") == 1


@pytest.mark.parametrize("field", SDM_FILTER_FIELDS)
def test_a_live_filter_write_in_sdm_mode_does_not_set_the_mode(written: Callable[[str], Write], field: str) -> None:
    assert "SetMode" not in written(field).commands


@pytest.mark.parametrize("field", SDM_FILTER_FIELDS)
def test_a_live_filter_write_in_sdm_mode_posts_no_restore(written: Callable[[str], Write], field: str) -> None:
    write = written(field)
    assert write.restores_after == write.restores_before
