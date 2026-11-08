"""A pytest plugin that fails any offline test which opens a TCP or UDP connection (docs/testing.md rule 16).

Loaded with ``-p socket_guard``. At import it installs one audit hook; the hook records every ``socket.connect`` and
``socket.sendto`` on an IPv4 or IPv6 socket, from any thread, while a test not marked ``live`` or ``e2e`` is being
set up, run or torn down. A bind is not a connection and is not recorded. At that test's teardown a fixture raises
``FixtureError`` naming each address and the phase it was opened in.

The decision to record is ``flagged``; the hook and the fixture only carry it out.
"""

import socket
import sys
import threading
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from narrow import FixtureError

__all__ = ["pytest_runtest_call", "pytest_runtest_setup", "pytest_runtest_teardown"]

#: The audit events that open a conversation with a peer.
_EVENTS = frozenset({"socket.connect", "socket.sendto"})

#: The socket families whose peers are TCP and UDP ones; AF_UNIX stays inside the host.
_INTERNET = frozenset({socket.AF_INET, socket.AF_INET6})

#: The markers whose tests are allowed to reach a real daemon.
EXEMPT_MARKS = frozenset({"live", "e2e"})


@dataclass(frozen=True)
class Current:
    """Where the session is: the phase of the test being run, or None between tests, and that test's marker names."""

    phase: str | None = None
    marks: frozenset[str] = frozenset()


def flagged(event: str, family: int, current: Current) -> bool:
    """Whether an audit ``event`` on a socket of ``family`` is an offline test opening a connection."""
    return event in _EVENTS and family in _INTERNET and current.phase is not None and not current.marks & EXEMPT_MARKS


class _Window:
    """The one place the session's current position is kept; the audit hook reads it from any thread."""

    current = Current()


_LOCK = threading.Lock()
_FOUND: list[tuple[str, str]] = []


def _address(address: object) -> str:
    if isinstance(address, tuple) and len(address) >= 2:
        return f"{address[0]}:{address[1]}"
    return str(address)


def _hook(event: str, args: tuple[object, ...]) -> None:
    if event not in _EVENTS:
        return
    current = _Window.current
    sock, address = args[0], args[1]
    if isinstance(sock, socket.socket) and flagged(event, sock.family, current) and current.phase is not None:
        with _LOCK:
            _FOUND.append((current.phase, _address(address)))


sys.addaudithook(_hook)


def _enter(phase: str, item: pytest.Item) -> None:
    if phase == "setup":
        with _LOCK:
            _FOUND.clear()
    _Window.current = Current(phase, frozenset(mark.name for mark in item.iter_markers()))


def _leave() -> None:
    _Window.current = Current()


def _wrapped(phase: str, item: pytest.Item) -> Iterator[None]:
    _enter(phase, item)
    try:
        yield
    finally:
        _leave()


@pytest.hookimpl(wrapper=True)
def pytest_runtest_setup(item: pytest.Item) -> Iterator[None]:
    """Open the setup window."""
    yield from _wrapped("setup", item)


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item: pytest.Item) -> Iterator[None]:
    """Open the call window."""
    yield from _wrapped("call", item)


@pytest.hookimpl(wrapper=True)
def pytest_runtest_teardown(item: pytest.Item) -> Iterator[None]:
    """Open the teardown window."""
    yield from _wrapped("teardown", item)


@pytest.fixture(autouse=True)
def _no_offline_connection() -> Iterator[None]:
    """Refuse a test that opened a TCP or UDP connection, naming each address and the phase it was opened in."""
    yield
    with _LOCK:
        found = list(_FOUND)
    if found:
        opened = ", ".join(f"{address} ({phase})" for phase, address in found)
        raise FixtureError(reason=f"an offline test opened a connection: {opened}")
