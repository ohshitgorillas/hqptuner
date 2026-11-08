"""The socket guard's decision: which audit events in which tests count as an offline test opening a connection."""

import socket

import pytest
from socket_guard import Current, flagged

OFFLINE = Current("call", frozenset({"asyncio"}))


@pytest.mark.parametrize(
    ("event", "family", "current", "expected"),
    [
        ("socket.connect", socket.AF_INET, OFFLINE, True),
        ("socket.connect", socket.AF_INET6, OFFLINE, True),
        ("socket.sendto", socket.AF_INET, OFFLINE, True),
        ("socket.connect", socket.AF_INET, Current("setup"), True),
        ("socket.connect", socket.AF_INET, Current("teardown"), True),
        ("socket.connect", socket.AF_UNIX, OFFLINE, False),
        ("socket.bind", socket.AF_INET, OFFLINE, False),
        ("socket.connect", socket.AF_INET, Current("call", frozenset({"live"})), False),
        ("socket.connect", socket.AF_INET, Current("call", frozenset({"e2e"})), False),
        ("socket.connect", socket.AF_INET, Current(), False),
    ],
)
def test_an_offline_test_opening_a_tcp_or_udp_connection_is_flagged(
    event: str, family: int, current: Current, *, expected: bool
) -> None:
    assert flagged(event, family, current) is expected
