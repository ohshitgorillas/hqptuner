"""The login gate: every `/api` route but the health check and the login itself needs a login cookie.

One pure ASGI wrapper installed in `create_app`, so it covers every route registered on the app, a conditional
router, an unknown `/api` path and any route added later. It passes a streaming response through unchanged, which
the meter feed's server-sent events need. The decision is one function; the wrapper only executes it.

The cookie carries a token HQPTuner minted at login (`hqptuner/core/login.py`), bound to the username and password in
force, so a change of either ends every login made under the old pair.
"""

import enum

from fastapi import Response
from fastapi.responses import JSONResponse
from starlette.requests import HTTPConnection
from starlette.types import ASGIApp, Receive, Scope, Send

from hqptuner.api.errors import STATUS, ErrorBody
from hqptuner.conf.httpauth import NO_HTTP_CLIENT_MESSAGE
from hqptuner.core.login import SAVED_LIFETIME, Login, LoginKind, check

LOGIN_COOKIE = "hqptuner_login"

#: The two `/api` paths that answer without a login: the health check and the login that earns one.
OPEN_PATHS = frozenset({"/api/health", "/api/login"})


class LoginRequiredError(ErrorBody):
    """A request to a gated route that carries no valid login."""

    code = "login_required"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__(NO_HTTP_CLIENT_MESSAGE)


class Access(enum.Enum):
    """What the gate does with a request."""

    ALLOW = "allow"
    DENY = "deny"


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


def login_of(connection: HTTPConnection) -> Login | None:
    """Return the login the request's cookie proves for the pair in force now, or None when it proves none."""
    token = connection.cookies.get(LOGIN_COOKIE)
    if token is None:
        return None
    app = connection.scope["app"]
    cfg = app.state.config
    now = app.state.manager.clock.now()
    return check(app.state.login_secret, token, cfg.hqp_username, cfg.hqp_password, now)


def decide(path: str, connection: HTTPConnection) -> Access:
    """Decide whether the request to ``path`` goes through.

    Anything outside `/api` goes through (the page's own files); so do the open paths. Every other `/api` path,
    registered or not, goes through only with a valid login. A path is matched exactly: `/api/health/` is not
    `/api/health`.
    """
    if path != "/api" and not path.startswith("/api/"):
        return Access.ALLOW
    if path in OPEN_PATHS:
        return Access.ALLOW
    return Access.ALLOW if login_of(connection) is not None else Access.DENY


class LoginGate:
    """ASGI wrapper that refuses a gated request with no valid login, in the API's shared error shape."""

    def __init__(self, app: ASGIApp) -> None:
        """Wrap ``app``."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Pass the request on unchanged, or answer 401 `login_required` instead."""
        if scope["type"] == "http" and decide(scope["path"], HTTPConnection(scope)) is Access.DENY:
            refusal = LoginRequiredError()
            response = JSONResponse({"detail": refusal.detail, "code": refusal.code}, status_code=STATUS[refusal.code])
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
