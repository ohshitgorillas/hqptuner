"""What HQPTuner reports when HQPlayer does not answer a request in time, on either lane it talks to HQPlayer over.

The 8088 web interface and the 4321 Control API give up on a silent HQPlayer in the same words, so the one
sentence lives here, below both. So do the bounds on an 8088 answer that does arrive: the total deadline an exchange
runs under and the size ceiling a reply is read up to.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from typing import Any, Protocol

import httpx

#: How many of a request's own timeouts a whole exchange may take: for an 8088 request, the Digest challenge round
#: trip and every read of the body together; for a Control API command, every read of its answer after the first.
#: httpx's timeout restarts at every read, so a daemon that sends one byte just inside it holds the exchange open for
#: as long as it likes. Six is 60 s at the default 10 s, in which the largest 8088 body, an 8.7 MB settings backup,
#: arrives over any link of 1.2 Mbit/s or faster; a silent daemon is still given up on by the first timeout, not the
#: sixth.
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


class HttpReplyTooLargeError(httpx.RequestError):
    """An 8088 reply grew past the ceiling of its path, or came in an encoding whose size cannot be bounded.

    Subclasses ``httpx.RequestError`` so every site that catches ``httpx.HTTPError`` handles it unchanged. It is no
    ``TransportError``, so ``hqplayer_request`` leaves it as it is.
    """

    def __init__(self, *, request: httpx.Request) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPlayer's reply was too large.", request=request)


#: The most a form page or a write's answer is read up to, a refusal past it. A form page is the largest of these at
#: 29.5 KB, so 256 KiB is almost nine times that.
PAGE_CEILING = 256 * 1024

#: Asked of every 8088 server, so an honest one sends its body as it is and the count below is the size that arrives.
IDENTITY_ONLY = {"Accept-Encoding": "identity"}


class _Capped(httpx.AsyncByteStream):
    """The bytes of one reply, up to a ceiling: the byte after the last one allowed raises instead of arriving."""

    def __init__(self, inner: httpx.AsyncByteStream, limit: int, request: httpx.Request) -> None:
        self._inner = inner
        self._limit = limit
        self._request = request

    async def __aiter__(self) -> AsyncIterator[bytes]:
        seen = 0
        async for chunk in self._inner:
            seen += len(chunk)
            if seen > self._limit:
                raise HttpReplyTooLargeError(request=self._request)
            yield chunk

    async def aclose(self) -> None:
        await self._inner.aclose()


def reply_ceiling(limit_of: Callable[[str], int]) -> dict[str, list[Callable[..., Any]]]:
    """Answer the ``event_hooks`` that hold every reply of an ``httpx.AsyncClient`` to the ceiling of its path.

    The hook runs on each response before its body is read, the 401 of a Digest challenge included, because httpx
    reads that body whole before it sends the answer. A reply in any encoding but identity is refused as if it were
    over the ceiling: a compressed body is small on the wire and unbounded once decoded. Pair it with ``IDENTITY_ONLY``.
    """

    def hold(response: httpx.Response) -> Awaitable[None]:
        request = response.request
        stream = response.stream
        if response.headers.get("content-encoding", "identity").lower() != "identity":
            raise HttpReplyTooLargeError(request=request)
        if isinstance(stream, httpx.AsyncByteStream):
            response.stream = _Capped(stream, limit_of(request.url.path), request)
        # httpx awaits a hook; this one has nothing to wait for, so what it hands back is already done.
        done = asyncio.get_running_loop().create_future()
        done.set_result(None)
        return done

    return {"response": [hold]}
