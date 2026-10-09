"""What HQPTuner reports when HQPlayer does not answer a request in time, on either lane it talks to HQPlayer over.

The 8088 web interface and the 4321 Control API give up on a silent HQPlayer in the same words, so the one
sentence lives here, below both.
"""

import contextlib
from collections.abc import Iterator

import httpx


def no_answer_message(timeout: float) -> str:
    """Render the sentence for a request HQPlayer left unanswered for ``timeout`` seconds."""
    return f"HQPlayer did not answer within {timeout:g} seconds."


class HttpNoAnswerError(httpx.TimeoutException):
    """An 8088 request HQPlayer did not answer within the timeout it was sent with.

    Subclasses ``httpx.TimeoutException`` so every site that catches ``httpx.HTTPError`` handles it unchanged.
    """

    def __init__(self, *, timeout: float, request: httpx.Request) -> None:
        """Render the no-answer sentence for ``timeout``, keeping the request that went unanswered."""
        super().__init__(no_answer_message(timeout), request=request)


@contextlib.contextmanager
def http_deadline(timeout: float) -> Iterator[None]:
    """Report an 8088 request httpx gave up on after ``timeout`` seconds as one HQPlayer did not answer."""
    try:
        yield
    except httpx.TimeoutException as exc:
        raise HttpNoAnswerError(timeout=timeout, request=exc.request) from exc
