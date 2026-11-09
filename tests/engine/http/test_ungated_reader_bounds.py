"""The ungated 8088 readers, the log tail and the release page, read up to a ceiling and give up at a total deadline.

Neither page asks for credentials, so the fake here is a bare transport: it answers every request with the body the
case builds, whole or a chunk every ``GAP`` virtual seconds under the suite's ``TotalDeadline``. The ceilings are the
modules' own, used to size a body one byte over and exactly at them.

The sentence is owner copy and is not asserted (docs/testing.md rule 9); the error's type is.
"""

import httpx
import pytest
from fake_network import Drip, TotalDeadline
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpOptions
from hqptuner.conf.noanswer import HttpNoAnswerError, HttpReplyTooLargeError
from hqptuner.engine.logtail import LOG_CEILING, fetch_log, tail_text
from hqptuner.engine.release import ABOUT_CEILING, fetch_about, parse_release

HOST = "hqplayer.invalid"

#: Virtual seconds between chunks. It divides no total here, so a chunk never falls due at the instant a deadline does.
GAP = 7.0

#: A body with this many chunks outlasts the total deadline at the default timeout (30 * 7 = 210 s against 60 s).
ENDLESS = 30

ABOUT = b"<h3>Version</h3>\n6.2.0\n"

#: The last line of the log the case puts on the wire.
LAST_LINE = "the last line"


def _whole(body: bytes) -> HttpOptions:
    return HttpOptions(transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=httpx.ByteStream(body))))


def _dripping(clock: VirtualClock) -> HttpOptions:
    def answer(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=Drip([b"x"] * ENDLESS, lambda: clock.sleep(GAP)))

    return HttpOptions(transport=httpx.MockTransport(answer), deadline=TotalDeadline(clock.sleep))


async def _log(options: HttpOptions) -> str:
    return await fetch_log(HOST, 8088, options)


async def _about(options: HttpOptions) -> str:
    return await fetch_about(f"http://{HOST}:8088", options)


async def test_a_log_over_its_ceiling_is_refused() -> None:
    with pytest.raises(HttpReplyTooLargeError):
        await _log(_whole(b"l" * (LOG_CEILING + 1)))


async def test_an_about_page_over_its_ceiling_is_refused() -> None:
    with pytest.raises(HttpReplyTooLargeError):
        await _about(_whole(b"a" * (ABOUT_CEILING + 1)))


async def test_a_log_still_dripping_past_the_total_deadline_is_given_up_on() -> None:
    with pytest.raises(HttpNoAnswerError):
        await _log(_dripping(VirtualClock()))


async def test_an_about_page_still_dripping_past_the_total_deadline_is_given_up_on() -> None:
    with pytest.raises(HttpNoAnswerError):
        await _about(_dripping(VirtualClock()))


async def test_a_log_up_to_its_ceiling_still_tails() -> None:
    last = (LAST_LINE + "\n").encode()
    line = b"a log line of some length, repeated\n"
    whole_lines = (LOG_CEILING - len(last)) // len(line)
    padding = b"\n" * (LOG_CEILING - len(last) - whole_lines * len(line))
    body = line * whole_lines + padding + last
    assert tail_text(await _log(_whole(body)), 1) == [LAST_LINE]


async def test_an_about_page_up_to_its_ceiling_still_names_its_release() -> None:
    body = ABOUT + b" " * (ABOUT_CEILING - len(ABOUT))
    assert parse_release(await _about(_whole(body))) == "6.2.0"
