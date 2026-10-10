"""The page's push stream: the read snapshots it would otherwise poll, as server-sent events sent again on change.

Each event is named for its route and carries that route's JSON body: ``health``, ``state``, ``status``, ``volume``,
``enumerations``, ``config``, ``matrix`` and ``pending``. A body is sent once, then again only when its content moves.
For the routes answering a ``deps.Snapshot`` the content is its ``data`` member, since ``loaded_at`` moves on every
poll pass; for the other three it is the whole body. A body its route would refuse is withheld, and the text held for
it forgotten, so the next body that route answers goes out however it compares with the last one sent.

While it has a subscriber, the feed recomputes whenever the manager reports an edge (``changed``) and whenever the
staging buffer is written, and never asks the daemon anything itself; with none, it reads nothing. A keepalive interval
with nothing to send writes an SSE comment instead, which is how a client gone without hanging up is found: the write
to its dead socket ends its stream.

Each event's text is written once and that same string is queued for every subscriber. A subscriber attaching first
has the feed recompute, so the subscribers already attached get whatever moved, then gets every held text at once, in
route order. Each queue is bounded and drops its oldest text on overflow, so a stalled
client never holds the feed back.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from hqptuner.api.deps import credentialed
from hqptuner.api.errors import ApiError
from hqptuner.api.routes import config, status, volume
from hqptuner.api.routes.matrix import matrix
from hqptuner.api.routes.pending import PendingStore
from hqptuner.core.clock import Clock
from hqptuner.core.manager import ConnectionManager
from hqptuner.errors import HQPTunerError
from hqptuner.metadata import StaticMetadata

router = APIRouter(prefix="/api")

#: Seconds the feed waits for an edge before writing a keepalive comment.
KEEPALIVE = 15.0
#: Texts a subscriber's queue holds before its oldest is dropped: room for every held event twice over.
QUEUE_DEPTH = 16
KEEPALIVE_TEXT = ": keepalive\n\n"


@dataclass(frozen=True)
class Source:
    """One event: its name, the read answering its route's body, and whether that body is a ``deps.Snapshot``."""

    name: str
    read: Callable[[], object]
    snapshot: bool


@dataclass(frozen=True)
class Held:
    """The text last sent for one event, and the compact JSON its next body is compared on."""

    key: str
    text: str


def sources(manager: ConnectionManager, static: StaticMetadata, store: PendingStore) -> list[Source]:
    """Return the eight events in the order a new subscriber receives them, each read through its route's body."""
    return [
        Source("health", lambda: status.health(manager, static), snapshot=False),
        Source("state", lambda: status.state(manager), snapshot=True),
        Source("status", lambda: status.status(manager), snapshot=True),
        Source("volume", lambda: volume.volume_get(manager), snapshot=False),
        Source("enumerations", lambda: status.merged_enumerations(manager, static), snapshot=True),
        Source("config", lambda: config.config(credentialed(manager)), snapshot=True),
        Source("matrix", lambda: matrix.matrix(credentialed(manager)), snapshot=True),
        Source("pending", store.snapshot, snapshot=False),
    ]


def _compact(body: object) -> str:
    """JSON as a route's response writes it: no spaces, non-ASCII left as it is."""
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


class PushFeed:
    """The held texts, and the subscriber set, of the push stream."""

    def __init__(self, reads: Sequence[Source]) -> None:
        """Start with nothing held and no subscriber; ``reads`` are the events, in subscribe order."""
        self._sources = list(reads)
        self._held: dict[str, Held] = {}
        self._subscribers: list[asyncio.Queue[str]] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self) -> "asyncio.Queue[str]":
        """Recompute, then attach a subscriber whose queue receives every held text at once, in route order.

        The recompute runs before the new queue is attached, so the subscribers already attached receive whatever
        moved and the new one receives each event once.
        """
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_DEPTH)
        self.publish()
        for source in self._sources:
            held = self._held.get(source.name)
            if held is not None:
                queue.put_nowait(held.text)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: "asyncio.Queue[str]") -> None:
        """Detach a subscriber."""
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def publish(self) -> int:
        """Recompute every event and send each one whose content moved; answer how many were sent.

        An event whose route refuses is withheld and its held text forgotten.
        """
        sent = 0
        for source in self._sources:
            try:
                sent += self._refresh(source)
            except (ApiError, HQPTunerError):
                self._held.pop(source.name, None)
        return sent

    def poke(self) -> None:
        """Recompute on the feed's own loop, from whatever thread wrote the staging buffer; before ``run``, nothing."""
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._publish_watched)

    async def run(self, clock: Clock, changed: asyncio.Event) -> None:
        """Publish now, then again on every edge of ``changed``, writing a keepalive where an interval sent nothing.

        Each publish here is skipped while the feed has no subscriber.
        """
        self._loop = asyncio.get_running_loop()
        self._publish_watched()
        while True:
            woke = await clock.pace(changed, KEEPALIVE)
            changed.clear()
            if not self._publish_watched() and not woke:
                self._send(KEEPALIVE_TEXT)

    def _publish_watched(self) -> int:
        """``publish`` while the feed has a subscriber, answering how many were sent; with none, read nothing."""
        return self.publish() if self._subscribers else 0

    def _refresh(self, source: Source) -> bool:
        """Send ``source``'s body where its content moved, and answer whether it did; a route's refusal propagates."""
        body = jsonable_encoder(source.read())
        key = _compact(body["data"] if source.snapshot else body)
        held = self._held.get(source.name)
        if held is not None and held.key == key:
            return False
        text = f"event: {source.name}\ndata: {_compact(body)}\n\n"
        self._held[source.name] = Held(key, text)
        self._send(text)
        return True

    def _send(self, text: str) -> None:
        """Queue one text for every subscriber, dropping the oldest where a queue is full."""
        for queue in self._subscribers:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(text)


def push_feed(request: Request) -> PushFeed:
    """Return the app's push feed."""
    feed: PushFeed = request.app.state.push
    return feed


@router.get("/push")
def push(request: Request) -> StreamingResponse:
    """Stream the page's read snapshots as ``text/event-stream``, each again whenever its content changes."""
    return StreamingResponse(
        _events(push_feed(request)), media_type="text/event-stream", headers={"Cache-Control": "no-cache"}
    )


async def _events(feed: PushFeed) -> AsyncIterator[str]:
    """Relay one subscriber's queue of ready texts, detaching it however the stream ends.

    Subscribing inside the generator ties the queue's lifetime to the stream's: a client gone before the first send
    never attaches one.
    """
    queue = feed.subscribe()
    try:
        while True:
            yield await queue.get()
    finally:
        feed.unsubscribe(queue)
