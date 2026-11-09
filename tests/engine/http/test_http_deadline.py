"""An 8088 exchange has a total deadline on the app's clock, however slowly HQPlayer's body arrives.

httpx's timeout restarts at every read, so a daemon that sends a byte just inside it keeps an exchange open for as
long as it likes. The fake here is that daemon: Digest challenge first, then a body that arrives a chunk every
``GAP`` virtual seconds. The deadline is the suite's ``TotalDeadline`` on a ``VirtualClock``, handed in through the
options, so no real second passes.

The sentence is owner copy and is not asserted (docs/testing.md rule 9); the error's type is, and the seconds it
carries, which are numbers derived from the timeout the client was built with.
"""

import re

import httpx
import pytest
from fake_network import ChallengingDaemon, Drip, TotalDeadline
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.conf.noanswer import TOTAL_TIMEOUTS, HttpNoAnswerError

HOST = "hqplayer.invalid"

#: Two production-sized timeouts, so a deadline that names one fixed number of seconds is wrong on the other.
TIMEOUTS = [10.0, 25.0]

#: Virtual seconds between chunks. It divides no total here, so a chunk never falls due at the instant a deadline does.
GAP = 7.0

#: A body with this many chunks outlasts every total above (30 * 7 = 210 s against at most 150 s).
ENDLESS = 30

PAGE = b'<form method="post"><input name="speed" type="text" value="1"></form>'


def _numbers(text: str) -> list[float]:
    return [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)]


def _client(clock: VirtualClock, body: list[bytes], timeout: float) -> HttpConfigClient:
    daemon = ChallengingDaemon(lambda: httpx.Response(200, stream=Drip(body, lambda: clock.sleep(GAP))))
    options = HttpOptions(timeout=timeout, transport=daemon.transport, deadline=TotalDeadline(clock.sleep))
    return HttpConfigClient(HOST, 8088, "u", "p", options)


async def _dripped_past_the_deadline(wait: float) -> None:
    client = _client(VirtualClock(), [b"x"] * ENDLESS, wait)
    try:
        await client.get_config()
    finally:
        await client.aclose()


async def _report_of_the_give_up(wait: float) -> str:
    try:
        await _dripped_past_the_deadline(wait)
    except HttpNoAnswerError as exc:
        return str(exc)
    return ""


@pytest.mark.parametrize("wait", TIMEOUTS)
async def test_a_config_read_still_dripping_past_the_total_deadline_is_given_up_on(wait: float) -> None:
    with pytest.raises(HttpNoAnswerError):
        await _dripped_past_the_deadline(wait)


@pytest.mark.parametrize("wait", TIMEOUTS)
async def test_the_give_up_reports_the_total_deadline_in_seconds(wait: float) -> None:
    assert _numbers(await _report_of_the_give_up(wait)) == [wait * TOTAL_TIMEOUTS]


async def test_a_config_read_that_completes_inside_the_total_deadline_returns_the_form() -> None:
    client = _client(VirtualClock(), [PAGE[:20], PAGE[20:40], PAGE[40:]], TIMEOUTS[0])
    try:
        form = await client.get_config()
    finally:
        await client.aclose()
    assert [field.get("name") for field in form["fields"]] == ["speed"]
