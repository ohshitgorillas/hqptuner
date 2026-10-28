"""Address evidence distinguishes a failed service from an unfound host."""

import contextlib
import errno
import socket

import pytest
from conftest import DaemonFactory
from virtual_deadline import VirtualDeadline

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError, dial_outcome

LOOPBACK = "127.0.0.1"
HANDSHAKE = "GetInfo"


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        pytest.param(socket.gaierror(socket.EAI_NONAME, "fixture DNS failure"), False, id="dns"),
        pytest.param(OSError(errno.EHOSTUNREACH, "fixture host unreachable"), False, id="host-unreachable"),
        pytest.param(OSError(errno.ENETUNREACH, "fixture network unreachable"), False, id="network-unreachable"),
        pytest.param(ConnectionRefusedError(errno.ECONNREFUSED, "fixture refusal"), True, id="refused"),
        pytest.param(None, True, id="tcp-success"),
    ],
)
def test_dial_classifies_whether_the_host_was_found(failure: OSError | None, *, expected: bool) -> None:
    # Breaks when DNS/unreachable errors imply found, or refusal/TCP success imply unfound.
    assert dial_outcome(failure).address_found is expected


async def test_tcp_success_proves_the_host_was_found_before_handshake(daemon: DaemonFactory) -> None:
    # Breaks when address evidence is delayed until an application reply.
    port, _log, _state = await daemon()
    client = ControlClient(LOOPBACK, port, deadline=VirtualDeadline())
    try:
        await client.connect()
        assert client.dial_outcome.address_found is True
    finally:
        await client.close()


@pytest.mark.parametrize("failure_mode", ["_error", "_close"])
async def test_a_failed_handshake_preserves_found_address_evidence(daemon: DaemonFactory, failure_mode: str) -> None:
    # Breaks when an application refusal or dropped handshake clears TCP evidence.
    port, _log, _state = await daemon(**{failure_mode: HANDSHAKE})
    client = ControlClient(LOOPBACK, port, deadline=VirtualDeadline())
    try:
        await client.connect()
        with contextlib.suppress(ControlError):
            await client.request(f"<{HANDSHAKE}/>")
        assert client.dial_outcome.address_found is True
    finally:
        await client.close()


def test_a_dial_timeout_has_less_address_evidence_than_an_explicit_refusal() -> None:
    # Breaks when a timeout is classified as either found or unfound instead of inconclusive.
    refused = dial_outcome(ConnectionRefusedError(errno.ECONNREFUSED, "fixture refusal"))
    timed_out = dial_outcome(TimeoutError(errno.ETIMEDOUT, "fixture timeout"))
    assert (refused.address_found, timed_out.address_found) == (True, None)
