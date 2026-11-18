"""The 8088 wire with a response held back until a case lets it through."""

import asyncio

import httpx


class PausedTransport(httpx.AsyncBaseTransport):
    """The 8088 wire: the fake's own answers, except that one response is held until ``release`` is set.

    ``arrived`` is set when the response is held. The held response is every one when no ``path`` is given, and
    otherwise the ``response_number``-th ``GET`` answer for ``path`` counted from the first ``POST`` to ``after_post``
    (from the start when none is given). ``read_body`` reads the held response in full before ``arrived`` is set.
    """

    def __init__(
        self,
        path: str | None = None,
        after_post: str | None = None,
        response_number: int = 1,
        *,
        read_body: bool = False,
    ) -> None:
        self.inner = httpx.AsyncHTTPTransport()
        self.arrived = asyncio.Event()
        self.release = asyncio.Event()
        self._path = path
        self._after_post = after_post
        self._posted = after_post is None
        self._response_number = response_number
        self._responses = 0
        self._read_body = read_body

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.inner.handle_async_request(request)
        if request.method == "POST" and request.url.path == self._after_post:
            self._posted = True
        if self._holds(request):
            if self._read_body:
                await response.aread()
            self.arrived.set()
            await self.release.wait()
        return response

    def _holds(self, request: httpx.Request) -> bool:
        """Whether this answer is the one to hold, counting it when it is a candidate."""
        if self._path is None:
            return True
        if request.method != "GET" or request.url.path != self._path or not self._posted:
            return False
        self._responses += 1
        return self._responses == self._response_number

    async def aclose(self) -> None:
        await self.inner.aclose()
