"""The port `closed_port` hands a test stays shut for the life of that test, even when something else on the host
tries to serve on it in the meantime."""

import errno
import socket
from collections.abc import Iterator

import pytest

HOST = "127.0.0.1"
BACKLOG = 1


def intruder(port: int) -> socket.socket | None:
    """A socket listening on ``port`` the way a stray server would take it, or None when the port is not free."""
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((HOST, port))
        sock.listen(BACKLOG)
    except OSError:
        sock.close()
        return None
    return sock


def connect_errno(port: int) -> int:
    """The errno a TCP connect to ``port`` on loopback ends with, 0 when the connection is taken."""
    with socket.socket() as sock:
        return sock.connect_ex((HOST, port))


@pytest.fixture
def intruded(closed_port: int) -> Iterator[int]:
    """The test's closed port, after a stray server has tried to listen on it; the stray is closed afterwards."""
    stray = intruder(closed_port)
    yield closed_port
    if stray is not None:
        stray.close()


def test_a_closed_port_refuses_connections_after_a_stray_server_tries_to_listen_on_it(intruded: int) -> None:
    assert connect_errno(intruded) == errno.ECONNREFUSED
