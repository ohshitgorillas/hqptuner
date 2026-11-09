"""What the 8088 lane does when hqplayerd will not accept who we say we are.

A refused credential is answered identically by every route on that lane, and
the one sentence the whole app reports it with lives here.

``raise_for_status`` is the lane's single choke point — ``HttpConfigClient``'s
own ``_get`` and ``_post`` both end in it, so no route can answer a refusal by
parsing an error page as if it were a form.

It also decides what counts as the address of an hqplayerd host (``check_host``) and how a host is written into an
8088 URL (``url_host``). A host is a DNS hostname, an IPv4 literal or a bare IPv6 literal, and nothing else: no port,
path, query, userinfo, whitespace, IPv6 zone ID or bracketed form. It is stored bare (``::1``) and kept bare for the
4321 socket; only an 8088 URL brackets an IPv6 literal. The check is positive, not a deny-list: a hostname is
dot-separated labels of 1 to 63 ASCII letters, digits and hyphens, none starting or ending with a hyphen, at most 253
characters in all, and the two literal forms are decided by the standard library's ``ipaddress``.
"""

import asyncio
import contextlib
import enum
import ipaddress
import re
import ssl
from typing import TYPE_CHECKING

import httpx

from hqptuner.conf.noanswer import IDENTITY_ONLY, PAGE_CEILING, WaitFor, reply_ceiling, under_total
from hqptuner.errors import HQPTunerError

if TYPE_CHECKING:  # avoid a circular import at runtime — conf is the lowest layer
    from hqptuner.core.manager import ConnectionManager

# The one sentence every surface reports a refused credential with — the alert
# row, the apply caption and the log line all carry exactly this. Owner-approved
# copy, verbatim (CLAUDE.md): reworded only with its own approval.
AUTH_REFUSED_MESSAGE = (
    "Authentication rejected: username and password are bad. "
    "Open the Connection panel from the status pill and try again."
)

# The one sentence a caller gets when the app was never given HTTP credentials
# at all — distinct from a credential the daemon refused (AUTH_REFUSED_MESSAGE).
# Shared by the config-lane error and the API's no-credentials refusal.
NO_HTTP_CLIENT_MESSAGE = (
    "HQPTuner has no HQPlayer username and password. Open the Connection panel from the status pill and enter them."
)

# What the daemon answers when it will not accept who we say we are. 401 is the
# challenge, which httpx.DigestAuth consumes and answers internally, so a 401
# that survives to the caller is already a failed exchange; 403 is what a wrong
# password actually produces (verified on 6.0.4: body "Authentication is
# required for this page"). Both mean the same thing to every caller.
_REFUSED = (401, 403)

# One DNS label: 1 to 63 ASCII letters, digits and hyphens, neither first nor last a hyphen.
_LABEL = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")

# The longest hostname DNS allows, dots included.
_MAX_HOSTNAME = 253

# A port to render a probe URL with; the value is irrelevant, the URL only has to parse.
_PROBE_PORT = 8088


class InvalidHostError(ValueError):
    """A string offered as an hqplayerd host is not a hostname, an IPv4 literal or a bare IPv6 literal."""


def url_host(host: str) -> str:
    """Return ``host`` as it is written inside an 8088 URL: an IPv6 literal bracketed, anything else unchanged."""
    return f"[{host}]" if ":" in host else host


def _is_literal(host: str) -> bool:
    """Whether ``host`` is an IPv4 literal or a bare IPv6 literal without a zone ID."""
    parsed = False
    with contextlib.suppress(ValueError):
        ipaddress.ip_address(host)
        parsed = "%" not in host
    return parsed


def _is_hostname(host: str) -> bool:
    """Whether ``host`` is a DNS hostname by the label rule."""
    if len(host) > _MAX_HOSTNAME:
        return False
    return all(_LABEL.fullmatch(label) for label in host.split("."))


def check_host(host: str) -> str:
    """Return ``host`` unchanged when it is a valid daemon host; raise ``InvalidHostError`` when it is not.

    A host the label rule or the literal parser accepts is still refused if the HTTP client cannot build the 8088 URL
    from it, so a host that passes here never fails later inside a request.
    """
    if not (_is_literal(host) or _is_hostname(host)):
        raise InvalidHostError(host)
    try:
        httpx.URL(f"http://{url_host(host)}:{_PROBE_PORT}/")
    except httpx.InvalidURL as exc:
        raise InvalidHostError(host) from exc
    return host


class AuthRefused(httpx.HTTPStatusError):
    """The daemon refused the configured management credentials.

    Subclasses ``httpx.HTTPStatusError`` on purpose. Every lane, route and
    settle loop on this side already catches ``httpx.HTTPError``, and an auth
    refusal is still a wire fault to all of them — so control flow at those
    sites is unchanged and none of them had to learn a new type. What changes
    is that the sites which CAN act on it catch this first, and that the
    message is a sentence rather than httpx's generated one with its link to
    MDN.
    """


class HttpRefusedError(httpx.HTTPStatusError):
    """HQPlayer answered an 8088 request with an error status.

    Subclasses ``httpx.HTTPStatusError`` so every site that catches ``httpx.HTTPError`` handles it unchanged.
    """

    def __init__(self, *, response: httpx.Response) -> None:
        """Render the wording naming the status HQPlayer answered with."""
        super().__init__(
            f"HQPlayer refused the request (HTTP {response.status_code}).",
            request=response.request,
            response=response,
        )


class HttpLaneDeclinedError(HQPTunerError):
    """The 8088 config lane cannot be used for this request.

    Two causes, one type: the app was never given HTTP credentials at all, or a
    credential it does have was already recorded as refused by the daemon (the
    same fault ``AuthRefused`` reports on the wire, established here for a
    caller that has to decide before it writes rather than one meeting the
    refusal live).
    """


class NoHttpClientError(HttpLaneDeclinedError):
    """The app was never given HTTP management credentials for the 8088 config lane at all."""

    code = "no_http_client"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__(NO_HTTP_CLIENT_MESSAGE)


class CredentialsRefusedError(HttpLaneDeclinedError):
    """A credential the app holds was already recorded as refused by the daemon."""

    code = "no_credentials"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__(AUTH_REFUSED_MESSAGE)


def decline_error(mgr: "ConnectionManager") -> HttpLaneDeclinedError | None:
    """Return the refusal a use of the 8088 lane would meet, or None when the lane is usable.

    The one owner of the cause-to-sentence mapping. A plain value, not a raise: a compound
    action reads it to build its outcome as data before it ever calls the lane; a standalone
    caller that wants the lane or nothing raises the returned error itself.
    """
    if mgr.http_client is None:
        return NoHttpClientError()
    if mgr.readings.credentials_ok is False:
        return CredentialsRefusedError()
    return None


# Built once: the daemon's lane is plain HTTP and never uses it, but each client otherwise loads the CA bundle.
_UNUSED_TLS = ssl.create_default_context()

# A read-only page: /config/refresh would rescan devices and stop the engine, /restore and /backup move state.
_PAIR_PAGE = "/config"


class PairVerdict(enum.Enum):
    """What hqplayerd said about a username and password."""

    ACCEPTED = "accepted"
    REFUSED = "refused"
    NOT_ANSWERED = "not_answered"


async def check_pair(
    host: str,
    port: int,
    username: str,
    password: str,
    wait: float,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    deadline: WaitFor = asyncio,
) -> PairVerdict:
    """Ask the daemon at ``host:port`` whether ``username`` and ``password`` are accepted.

    One Digest-authenticated read of a page the daemon guards, judged by its status alone: the body is never
    parsed and nothing the daemon says is kept. Anything but the daemon's own 2xx or its credential refusal is
    ``NOT_ANSWERED``: no connection, no answer within ``wait`` seconds, a body still arriving at the total deadline
    or past ``PAGE_CEILING``, a 5xx (the 503 of a restarting daemon among them), an address that is not a URL host.

    ``transport`` is what the request goes over, None for httpx's own. ``deadline`` is what the exchange waits under.
    """
    accepted = refused = False
    try:
        async with httpx.AsyncClient(
            base_url=f"http://{url_host(host)}:{port}",
            auth=httpx.DigestAuth(username, password),
            timeout=wait,
            verify=_UNUSED_TLS,
            transport=transport,
            headers=IDENTITY_ONLY,
            event_hooks=reply_ceiling(lambda _path: PAGE_CEILING),
        ) as client:
            resp = await under_total(deadline, wait, client.get(_PAIR_PAGE))
        raise_for_status(resp)
        accepted = True
    except AuthRefused:
        refused = True
    except (httpx.HTTPError, httpx.InvalidURL):
        pass
    if refused:
        return PairVerdict.REFUSED
    return PairVerdict.ACCEPTED if accepted else PairVerdict.NOT_ANSWERED


def raise_for_status(resp: httpx.Response) -> None:
    """Raise ``AuthRefused`` on a refused credential, else ``HttpRefusedError`` on any other non-2xx."""
    if resp.status_code in _REFUSED:
        raise AuthRefused(AUTH_REFUSED_MESSAGE, request=resp.request, response=resp)
    if not resp.is_success:
        raise HttpRefusedError(response=resp)
