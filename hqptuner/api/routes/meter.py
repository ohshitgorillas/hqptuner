"""The Source meter's event stream — the metering reader's feed as server-sent events.

One ``geometry`` event ahead of the ``frame`` events it describes, then one ``frame`` per stride
(``engine/meterfeed.py``). The stream sends nothing while the engine is not playing and stays open.
"""

from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse

from hqptuner.api.deps import Mgr
from hqptuner.api.push import relay

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
        relay(manager.metering.feed), media_type="text/event-stream", headers={"Cache-Control": "no-cache"}
    )
