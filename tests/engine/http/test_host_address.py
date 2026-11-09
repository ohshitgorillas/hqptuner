"""Which strings are an hqplayerd host, and how a host is written into an 8088 URL.

Every refused string here is a class of input a host used to reach ``http://{host}:{port}`` with: a port, a path
and query, userinfo, whitespace, a zone ID, brackets, nothing at all, a control character, a non-ASCII name, a
hyphen at the edge of a label, a label or a name past DNS's length, and a dotted number the HTTP client cannot
build a URL from.
"""

import pytest

from hqptuner.conf.httpauth import InvalidHostError, check_host, url_host

ACCEPTED = ["hqplayer.local", "192.168.1.5", "::1", "2001:db8::5", "a" * 63 + ".local"]

REFUSED = [
    "a:b",
    "target:9000/path?x=",
    "fe80::1%eth0",
    "user@host",
    "host name",
    " 10.0.0.5",
    "10.0.0.5\n",
    "[::1]",
    "",
    "a\x7fb",
    "\U0001f4a5.local",
    "-a.local",
    "a-.local",
    "a" * 64 + ".local",
    ".".join(["a" * 60] * 5),
    "999.1.1.1",
]


@pytest.mark.parametrize("host", ACCEPTED)
def test_a_hostname_or_ip_literal_is_accepted_as_it_was_written(host: str) -> None:
    assert check_host(host) == host


@pytest.mark.parametrize("host", REFUSED)
def test_a_string_that_is_no_host_is_refused(host: str) -> None:
    with pytest.raises(InvalidHostError):
        check_host(host)


def test_an_ipv6_literal_is_bracketed_in_a_url() -> None:
    assert url_host("::1") == "[::1]"


@pytest.mark.parametrize("host", ["10.0.0.5", "hqplayer.local"])
def test_a_host_that_is_not_ipv6_is_left_alone_in_a_url(host: str) -> None:
    assert url_host(host) == host
