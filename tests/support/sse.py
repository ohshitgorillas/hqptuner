"""An endless server-sent event stream, read over ASGI on the app's own loop.

A route that streams forever cannot be read through `TestClient.get`, which
waits for the body to end. `open_stream` speaks ASGI to the app directly
instead: the request runs as a task on the app's loop for as long as the
stream stays open, so the case can act on the app between reads, and every
read collects blocks until a condition the case names holds. Hanging up is
the `with` block ending.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING, Any, NamedTuple

from fastapi import FastAPI
from narrow import FixtureError

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, MutableMapping, Sequence

    from fastapi.testclient import TestClient

#: A ceiling on each read from the app; only a stream that never meets the
#: condition reaches it, and the read then answers what it had.
READ_CEILING = 10.0


class SseEvent(NamedTuple):
    """One dispatched event: its name and its data lines joined."""

    name: str
    data: str


class SseComment(NamedTuple):
    """One block of comment lines alone, which dispatches no event."""

    text: str


type SseBlock = SseEvent | SseComment

#: A read's stopping condition, asked of every block read since the stream opened.
type Until = Callable[[Sequence[SseBlock]], bool]


def _parse(block: str) -> SseBlock | None:
    """One block per the event-stream format: a block with a data field
    dispatches an event, one with only comment lines is a comment, and any
    other dispatches nothing."""
    name = "message"
    data: list[str] = []
    notes: list[str] = []
    for line in block.split("\n"):
        field, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if field == "event":
            name = value
        elif field == "data":
            data.append(value)
        elif not field and line:
            notes.append(value)
    if data:
        return SseEvent(name, "\n".join(data))
    if notes:
        return SseComment("\n".join(notes))
    return None


def blocks_of(text: str) -> list[SseBlock]:
    """Every complete block in ``text``; a trailing block not yet ended by a
    blank line is left out."""
    parts = text.replace("\r\n", "\n").replace("\r", "\n").split("\n\n")
    return [block for block in map(_parse, parts[:-1]) if block is not None]


def events(blocks: Sequence[SseBlock], name: str | None = None) -> list[SseEvent]:
    """The events among ``blocks``, in order; only those named ``name`` where
    one is given."""
    return [b for b in blocks if isinstance(b, SseEvent) and (name is None or b.name == name)]


def comments(blocks: Sequence[SseBlock]) -> list[SseComment]:
    """The comment blocks among ``blocks``, in order."""
    return [b for b in blocks if isinstance(b, SseComment)]


def any_event(blocks: Sequence[SseBlock]) -> bool:
    """A read's condition: at least one event has been dispatched."""
    return bool(events(blocks))


class _Reader:
    """The open request, living on the app's loop between the case's reads."""

    def __init__(self, app: FastAPI, state: dict[str, Any], path: str) -> None:
        self.sent: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.hung_up = asyncio.Event()
        self.requested = False
        self.ended = False
        self.body = ""
        self.scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(b"host", b"testserver"), (b"accept", b"text/event-stream")],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
            "state": state,
        }
        self.app = app
        self.task: asyncio.Future[None] | None = None

    async def receive(self) -> MutableMapping[str, Any]:
        if not self.requested:
            self.requested = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await self.hung_up.wait()
        return {"type": "http.disconnect"}

    async def send(self, message: MutableMapping[str, Any]) -> None:
        await self.sent.put(dict(message))

    async def start(self) -> None:
        self.task = asyncio.ensure_future(self.app(self.scope, self.receive, self.send))

    async def until(self, done: Until) -> list[SseBlock]:
        blocks = blocks_of(self.body)
        while not done(blocks) and not self.ended:
            try:
                message = await asyncio.wait_for(self.sent.get(), timeout=READ_CEILING)
            except TimeoutError:
                break
            if message["type"] != "http.response.body":
                continue
            self.body += bytes(message.get("body", b"")).decode()
            self.ended = not message.get("more_body", False)
            blocks = blocks_of(self.body)
        return blocks

    async def close(self) -> None:
        self.hung_up.set()
        if self.task is not None:
            self.task.cancel()
            with contextlib.suppress(BaseException):
                await self.task


class SseStream:
    """An open stream the case reads, a condition at a time."""

    def __init__(self, client: TestClient, reader: _Reader) -> None:
        """Hold the client whose loop the reader runs on, and the reader."""
        self._client = client
        self._reader = reader

    def until(self, done: Until) -> list[SseBlock]:
        """Every block read since the stream opened, once ``done`` holds of
        them, the response ended, or a read passed ``READ_CEILING``."""
        portal = self._client.portal
        if portal is None:
            raise FixtureError(reason="the client is not running its app")
        blocks: list[SseBlock] = portal.call(self._reader.until, done)
        return blocks


@contextlib.contextmanager
def open_stream(client: TestClient, path: str) -> Iterator[SseStream]:
    """GET ``path`` on the app under ``client`` and hold the stream open for
    the ``with`` block, hanging up as it ends."""
    portal = client.portal
    app = client.app
    if portal is None or not isinstance(app, FastAPI):
        raise FixtureError(reason="the client is not running its app")
    reader = _Reader(app, dict(getattr(client, "app_state", {})), path)
    portal.call(reader.start)
    try:
        yield SseStream(client, reader)
    finally:
        portal.call(reader.close)
