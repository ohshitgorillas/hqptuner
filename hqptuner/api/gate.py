"""The login cookie: its name and how a response sets it.

One place for the cookie's attributes, so the login and a Connection panel save that re-issues it for a new pair set
the same cookie.
"""

from fastapi import Response

from hqptuner.core.login import SAVED_LIFETIME, LoginKind

LOGIN_COOKIE = "hqptuner_login"


def set_login_cookie(response: Response, token: str, kind: LoginKind) -> None:
    """Set the login cookie on ``response``.

    ``HttpOnly`` keeps page script from reading it. ``SameSite=Strict`` keeps the browser from sending it on any
    cross-site request, a top-level navigation included. No ``Secure``: every package serves plain HTTP, and a
    ``Secure`` cookie would never be sent back. A "save password" login lives as long as the server accepts it; a "log
    in every time" login carries no expiry and ends with the browser session.
    """
    response.set_cookie(
        LOGIN_COOKIE,
        token,
        max_age=int(SAVED_LIFETIME.total_seconds()) if kind is LoginKind.SAVED else None,
        path="/",
        httponly=True,
        samesite="strict",
        secure=False,
    )
