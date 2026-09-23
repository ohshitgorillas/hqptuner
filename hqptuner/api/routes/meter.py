"""The METER page's event stream — the metering reader's feed as server-sent events.

One ``geometry`` event ahead of the ``frame`` events it describes, then one ``frame`` per stride
(``engine/meterfeed.py``). The stream sends nothing while the engine is not playing and stays open.
"""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse

from hqptuner.api.deps import Mgr
from hqptuner.engine.meterfeed import MeterFeed

router = APIRouter(prefix="/api")


@router.get("/meter/feed")
def meter_feed(manager: Mgr) -> Response:
    """Stream the metering feed as ``text/event-stream``, or answer 204 while metering is off.

    An ``EventSource`` takes the 204 as a failed connection and does not retry, so a page left open against an
    install with metering off costs nothing.
    """
    if manager.metering is None:
        return Response(status_code=204)
    return StreamingResponse(
        _events(manager.metering.feed), media_type="text/event-stream", headers={"Cache-Control": "no-cache"}
    )


async def _events(feed: MeterFeed) -> AsyncIterator[str]:
    """Relay one subscriber's queue as SSE lines, detaching it however the stream ends.

    Subscribing inside the generator ties the queue's lifetime to the stream's: a client gone before the first send
    never attaches one.
    """
    queue = feed.subscribe()
    try:
        while True:
            event, data = await queue.get()
            yield f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"
    finally:
        feed.unsubscribe(queue)
