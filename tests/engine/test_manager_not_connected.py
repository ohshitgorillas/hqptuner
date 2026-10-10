"""What a user is told when HQPTuner holds no control connection to HQPlayer and a write or a heartbeat needs one.

What is asserted is
what the fixture knows: the host and port the manager is configured with, and the error code.
"""

import pytest

from hqptuner.config import Config
from hqptuner.core import loader
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError

#: Where the manager is configured to look for HQPlayer; nothing is ever dialled.
HOST = "192.0.2.7"
PORT = 4999


def _unconnected_manager() -> ConnectionManager:
    return ConnectionManager(Config(hqp_host=HOST, hqp_control_port=PORT))


def test_a_write_with_no_connection_names_the_address_hqplayer_was_looked_for_at() -> None:
    with pytest.raises(ControlError) as caught:
        _unconnected_manager().require_control()
    assert f"{HOST}:{PORT}" in str(caught.value)


async def test_a_heartbeat_with_no_connection_names_the_address_hqplayer_was_looked_for_at() -> None:
    with pytest.raises(ControlError) as caught:
        await loader.poll(_unconnected_manager())
    assert f"{HOST}:{PORT}" in str(caught.value)


def test_a_write_with_no_connection_keeps_its_code() -> None:
    with pytest.raises(ControlError) as caught:
        _unconnected_manager().require_control()
    assert caught.value.code == "daemon_unavailable"


async def test_a_heartbeat_with_no_connection_keeps_its_code() -> None:
    with pytest.raises(ControlError) as caught:
        await loader.poll(_unconnected_manager())
    assert caught.value.code == "daemon_unavailable"
