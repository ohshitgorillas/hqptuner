"""What HQPTuner reports when HQPlayer does not answer a request in time, on either lane it talks to HQPlayer over.

The 8088 web interface and the 4321 Control API give up on a silent HQPlayer in the same words, so the one
sentence lives here, below both.
"""

import contextlib
from collections.abc import Awaitable, Iterator
from typing import Protocol

import httpx

#: How many of an 8088 request's own timeouts a whole exchange may take: the Digest challenge round trip and every
#: read of the body together. httpx's timeout restarts at every read, so a daemon that sends one byte just inside it
#: holds the exchange open for as long as it likes. Six is 60 s at the default 10 s, in which the largest body, an
#: 8.7 MB settings backup, arrives over any link of 1.2 Mbit/s or faster; a silent daemon is still given up on by the
#: first timeout, not the sixth.
TOTAL_TIMEOUTS = 6


class WaitFor(Protocol):
    """What an 8088 exchange waits on its total deadline under. The ``asyncio`` module itself is one, the default."""

    def wait_for[T](self, fut: Awaitable[T], timeout: float, /) -> Awaitable[T]:
        """Answer ``fut``'s own result, or raise ``TimeoutError`` when ``timeout`` seconds pass first."""
        ...


def no_answer_message(timeout: float) -> str:
    """Render the sentence for a request HQPlayer left unanswered for ``timeout`` seconds."""
    return f"HQPlayer did not answer within {timeout:g} seconds."


class HttpNoAnswerError(httpx.TimeoutException):
    """An 8088 request HQPlayer did not answer within the timeout it was sent with.

    Subclasses ``httpx.TimeoutException`` so every site that catches ``httpx.HTTPError`` handles it unchanged.
    """

    def __init__(self, *, timeout: float, request: httpx.Request | None = None) -> None:
        """Render the no-answer sentence for ``timeout``, keeping the unanswered request where one is known."""
        super().__init__(no_answer_message(timeout), request=request)


@contextlib.contextmanager
def http_deadline(timeout: float) -> Iterator[None]:
    """Report an 8088 request httpx gave up on after ``timeout`` seconds as one HQPlayer did not answer."""
    try:
        yield
    except httpx.TimeoutException as exc:
        raise HttpNoAnswerError(timeout=timeout, request=exc.request) from exc


async def under_total[T](deadline: WaitFor, wait: float, exchange: Awaitable[T]) -> T:
    """Run ``exchange`` for at most ``TOTAL_TIMEOUTS`` times ``wait`` on ``deadline``; running out is no answer.

    The report names the total's seconds, the time actually waited, in the one no-answer sentence.
    """
    total = wait * TOTAL_TIMEOUTS
    try:
        return await deadline.wait_for(exchange, total)
    except TimeoutError as exc:
        raise HttpNoAnswerError(timeout=total) from exc
