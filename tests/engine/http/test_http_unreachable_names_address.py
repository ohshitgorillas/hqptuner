"""What the 8088 web-interface lane reports when it cannot reach HQPlayer at all.

The client is pointed at a loopback port nothing listens on, so every connection is refused at once by the kernel:
a real refusal on a real socket, with nothing dialled beyond this host and no clock run.

The sentence is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is what the test put
there: the host and port the configuration client was built with.
"""

from collections.abc import Awaitable, Callable

import httpx
import pytest

from hqptuner.conf.httpconf import HttpConfigClient

#: Two loopback addresses, so a report that names one fixed host is wrong on the other. The port is the
#: ``closed_port`` fixture's, never the stock 8088, so a report naming the stock port regardless is wrong too.
HOSTS = ["127.0.0.1", "127.0.0.2"]

#: What a request is handed instead of a report when nothing raised.
NO_ERROR = ""

Operation = Callable[[HttpConfigClient], Awaitable[object]]


async def _read(client: HttpConfigClient) -> object:
    return await client.get_config()


async def _write(client: HttpConfigClient) -> None:
    await client.post_profile("save", name="unreachable")


async def _backup(client: HttpConfigClient) -> object:
    return await client.backup()


async def _report(host: str, port: int, operation: Operation) -> str:
    """The text of the error ``operation`` raises on a client pointed at ``host``:``port``, or ``NO_ERROR``."""
    client = HttpConfigClient(host, port, "u", "p")
    try:
        await operation(client)
    except httpx.HTTPError as exc:
        return str(exc)
    finally:
        await client.aclose()
    return NO_ERROR


@pytest.mark.parametrize("host", HOSTS)
@pytest.mark.parametrize("operation", [_read, _write, _backup], ids=["read", "write", "backup"])
async def test_a_config_request_that_cannot_reach_hqplayer_names_the_host_and_port_it_tried(
    operation: Operation, host: str, closed_port: int
) -> None:
    assert f"{host}:{closed_port}" in await _report(host, closed_port, operation)
