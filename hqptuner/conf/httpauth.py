"""What the 8088 lane does when hqplayerd will not accept who we say we are.

A refused credential is answered identically by every route on that lane, and
the one sentence the whole app reports it with lives here.

``raise_for_status`` is the lane's single choke point — ``HttpConfigClient``'s
own ``_get`` and ``_post`` both end in it, so no route can answer a refusal by
parsing an error page as if it were a form.
"""

import httpx

# The one sentence every surface reports a refused credential with — the alert
# row, the apply caption and the log line all carry exactly this. Owner-approved
# copy, verbatim (CLAUDE.md): reworded only with its own approval.
AUTH_REFUSED_MESSAGE = (
    "Authentication rejected: username and password are bad. Fix and restart HQPTuner with the correct credentials."
)

# What the daemon answers when it will not accept who we say we are. 401 is the
# challenge, which httpx.DigestAuth consumes and answers internally, so a 401
# that survives to the caller is already a failed exchange; 403 is what a wrong
# password actually produces (verified on 6.0.4: body "Authentication is
# required for this page"). Both mean the same thing to every caller.
_REFUSED = (401, 403)


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


def raise_for_status(resp: httpx.Response) -> None:
    """Raise ``AuthRefused`` on a refused credential, else httpx's own error on any non-2xx."""
    if resp.status_code in _REFUSED:
        raise AuthRefused(AUTH_REFUSED_MESSAGE, request=resp.request, response=resp)
    resp.raise_for_status()
