"""What the 8088 web-interface lane hands a caller when HQPlayer does not answer a request in time.

The timeout on this lane is httpx's own, so no clock of ours reaches it. The fake is the transport instead, handed
in through the constructor: it keeps every request it is sent and raises the timeout httpx raises when the reply
never comes, at once.

What is asserted is what the test put there: the request the transport was sent, handed back to a caller that
catches the no-answer report and to one that catches any httpx timeout. Nothing about the report's wording is.
"""

from collections.abc import Awaitable, Callable

import httpx
import pytest

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.conf.noanswer import HttpNoAnswerError

#: What a caller is handed when the error it catches never came.
NOT_CAUGHT = None

#: The text httpx gives a read that timed out.
HTTPX_TEXT = "timed out"

Operation = Callable[[HttpConfigClient], Awaitable[object]]


class _Silent:
    """A transport on which HQPlayer answers nothing: every request is kept, then times out reading."""

    def __init__(self) -> None:
        self.sent: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.sent.append(request)
        raise httpx.ReadTimeout(HTTPX_TEXT, request=request)


async def _read(client: HttpConfigClient) -> object:
    return await client.get_config()


async def _write(client: HttpConfigClient) -> None:
    await client.post_profile("save", name="silent")


async def _unanswered(
    operation: Operation, caught: type[httpx.HTTPError]
) -> tuple[list[httpx.Request], httpx.Request | None]:
    """The requests the silent transport was sent, and the request on the ``caught`` error, or ``NOT_CAUGHT``."""
    silent = _Silent()
    client = HttpConfigClient(
        "hqplayer.invalid", 8088, "u", "p", HttpOptions(transport=httpx.MockTransport(silent.handler))
    )
    try:
        await operation(client)
    except caught as exc:
        return silent.sent, exc.request
    except httpx.HTTPError:
        return silent.sent, NOT_CAUGHT
    finally:
        await client.aclose()
    return silent.sent, NOT_CAUGHT


@pytest.mark.parametrize("caught", [HttpNoAnswerError, httpx.TimeoutException], ids=["no-answer", "httpx-timeout"])
@pytest.mark.parametrize("operation", [_read, _write], ids=["read", "write"])
async def test_a_caller_catching_the_no_answer_report_or_an_httpx_timeout_gets_the_request_hqplayer_left_unanswered(
    operation: Operation, caught: type[httpx.HTTPError]
) -> None:
    sent, unanswered = await _unanswered(operation, caught)
    assert unanswered is sent[-1]
