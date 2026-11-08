"""The cross-site check: a state-changing `/api` request sent from another website is refused.

One pure ASGI wrapper installed in `create_app` outside the login gate, so a cross-site request is refused whatever
cookie it carries, and with no cookie at all it is still 403, never 401. The decision is one function; the wrapper
only executes it.

The check compares a request with itself. `Sec-Fetch-Site`, when present, must say `same-origin` (the page's own
script) or `none` (the user typed it). `Origin`, when present, must name the host and port the request was addressed
to, so no list of configured hosts is needed. A request that carries neither header (curl, the dev scripts, the
packaged smokes) is not a browser's cross-site request and meets the login gate unchanged. GET and HEAD change nothing
and are not checked.
"""

from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from hqptuner.api.errors import STATUS, ErrorBody
from hqptuner.api.gate import Access

#: The methods that change state. The rest are not checked.
STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: The `Sec-Fetch-Site` values that are not another site: the page's own script, and a request the user typed.
OWN_FETCH_SITES = frozenset({"same-origin", "none"})


class CrossSiteRefusedError(ErrorBody):
    """A state-changing request that another website sent."""

    code = "cross_site_refused"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPTuner refused a change sent from another website.")


def decide(path: str, method: str, headers: Headers) -> Access:
    """Decide whether the request goes through.

    Only a state-changing request to `/api` or under it is checked. It is refused when `Sec-Fetch-Site` is present and
    names another site, or when `Origin` is present and is `null` or not the request's own `Host`.
    """
    if method not in STATE_CHANGING or (path != "/api" and not path.startswith("/api/")):
        return Access.ALLOW
    site = headers.get("sec-fetch-site")
    if site is not None and site.lower() not in OWN_FETCH_SITES:
        return Access.DENY
    origin = headers.get("origin")
    if origin is None:
        return Access.ALLOW
    named = urlsplit(origin).netloc.lower()
    return Access.ALLOW if named and named == headers.get("host", "").lower() else Access.DENY


class CrossSiteGuard:
    """ASGI wrapper that refuses a cross-site state-changing request, in the API's shared error shape."""

    def __init__(self, app: ASGIApp) -> None:
        """Wrap ``app``."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Pass the request on unchanged, or answer 403 `cross_site_refused` instead."""
        if scope["type"] == "http" and decide(scope["path"], scope["method"], Headers(scope=scope)) is Access.DENY:
            refusal = CrossSiteRefusedError()
            response = JSONResponse({"detail": refusal.detail, "code": refusal.code}, status_code=STATUS[refusal.code])
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
