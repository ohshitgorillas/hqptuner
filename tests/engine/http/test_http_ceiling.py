"""An 8088 reply is read up to a ceiling set for its path, the Digest challenge's body included.

httpx reads a 401 challenge body whole before it sends the credentials, so a ceiling on the final read alone would
leave that read unbounded. The fake daemon here challenges first and then answers with a body of the size the case
names. The ceilings are the module's own, used to size a body one byte over and exactly at them; the sizes of the
bodies HQPlayer really sends are wire facts: a form page of 29.5 KB and a settings backup of 8.7 MB.

The sentence is owner copy and is not asserted (docs/testing.md rule 9); the error's type is.
"""

import contextlib
import gzip

import httpx
import pytest
from fake_network import ChallengingDaemon

from hqptuner.conf.httpconf import BACKUP_CEILING, PAGE_CEILING, HttpConfigClient, HttpOptions
from hqptuner.conf.noanswer import HttpReplyTooLargeError

HOST = "hqplayer.invalid"

PAGE = b'<form method="post"><input name="speed" type="text" value="1"></form>'

#: The largest form page and the largest settings backup HQPlayer has sent.
LARGEST_FORM = 29_500
LARGEST_BACKUP = 8_700_000


def _padded(size: int) -> bytes:
    """A valid form page ``size`` bytes long."""
    return PAGE + b" " * (size - len(PAGE))


def _daemon(body: bytes, challenge: bytes = b"") -> ChallengingDaemon:
    return ChallengingDaemon(
        lambda: httpx.Response(200, stream=httpx.ByteStream(body)), lambda: httpx.ByteStream(challenge)
    )


def _client(daemon: ChallengingDaemon) -> HttpConfigClient:
    return HttpConfigClient(HOST, 8088, "u", "p", HttpOptions(transport=daemon.transport))


async def _field_names(daemon: ChallengingDaemon) -> list[str | None]:
    client = _client(daemon)
    try:
        return [field.get("name") for field in (await client.get_config())["fields"]]
    finally:
        await client.aclose()


async def _backup(daemon: ChallengingDaemon) -> bytes:
    client = _client(daemon)
    try:
        return await client.backup()
    finally:
        await client.aclose()


async def test_a_config_body_one_byte_over_its_ceiling_is_refused() -> None:
    with pytest.raises(HttpReplyTooLargeError):
        await _field_names(_daemon(_padded(PAGE_CEILING + 1)))


@pytest.mark.parametrize("size", [LARGEST_FORM, PAGE_CEILING])
async def test_a_config_body_up_to_its_ceiling_is_read(size: int) -> None:
    assert await _field_names(_daemon(_padded(size))) == ["speed"]


async def test_a_settings_backup_over_its_ceiling_is_refused() -> None:
    with pytest.raises(HttpReplyTooLargeError):
        await _backup(_daemon(b"z" * (BACKUP_CEILING + 1)))


async def test_a_settings_backup_larger_than_any_form_page_is_read_whole() -> None:
    assert len(await _backup(_daemon(b"z" * LARGEST_BACKUP))) == LARGEST_BACKUP


async def test_a_challenge_body_over_the_ceiling_is_refused() -> None:
    with pytest.raises(HttpReplyTooLargeError):
        await _field_names(_daemon(PAGE, challenge=b"c" * (PAGE_CEILING + 1)))


async def _requests_before_a_refused_challenge() -> int:
    daemon = _daemon(PAGE, challenge=b"c" * (PAGE_CEILING + 1))
    with contextlib.suppress(HttpReplyTooLargeError):
        await _field_names(daemon)
    return len(daemon.requests)


async def test_a_refused_challenge_body_is_not_answered_with_credentials() -> None:
    assert await _requests_before_a_refused_challenge() == 1


async def test_a_reply_in_an_encoding_that_hides_its_size_is_refused() -> None:
    squeezed = ChallengingDaemon(
        lambda: httpx.Response(
            200, headers={"Content-Encoding": "gzip"}, stream=httpx.ByteStream(gzip.compress(b"\0" * 10_000_000))
        )
    )
    with pytest.raises(HttpReplyTooLargeError):
        await _field_names(squeezed)
