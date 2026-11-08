"""A control client handed the suite's in-process network reaches a fake daemon that listens on no port.

Policy: docs/testing.md. The refusal of an address nothing is served at is pinned by the closed-port tests.
"""

import functools

import fake_network
import pytest
from fake_control import DEFAULTS, serve_shared

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError


async def _volume_read(client: ControlClient) -> str | None:
    """The volume the daemon's State carries, or None when the daemon was not reached."""
    try:
        await client.connect()
        return (await client.get_state())["volume"]
    except ControlError:
        return None
    finally:
        await client.close()


@pytest.mark.parametrize("volume", ["-23.5", "-41.0"])
async def test_a_client_handed_the_network_reads_a_daemon_served_in_process(volume: str) -> None:
    state = {**DEFAULTS, "volume": volume}
    with fake_network.serving(functools.partial(serve_shared, state=state)) as port:
        client = ControlClient("127.0.0.1", port, 2.0, opener=fake_network.open_stream)
        assert await _volume_read(client) == volume
