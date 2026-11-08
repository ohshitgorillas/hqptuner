"""Log a dev script in to a running HQPTuner, with the pair ``hqpcreds`` exports.

  set -a; source hqpcreds; set +a

``login_cookie(url)`` posts the pair to ``POST /api/login`` as a session login (it never asks to stay logged in, so
nothing is written to the app's store) and returns the login cookie's value. The caller hands that to its own client:
``client.cookies.set(LOGIN_COOKIE, value)`` for httpx, ``context.add_cookies`` for Playwright. A login that is
refused, unanswered or unreachable raises ``LoginFailedError``, which the caller reports and stops on, so a script
never carries on into a stream of 401s.

Standard library only, so a script that has no httpx (``authority.py find``) can still import it.
"""

import http.client
import json
import os
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

#: The cookie ``hqptuner/api/gate.py`` sets.
LOGIN_COOKIE = "hqptuner_login"
TIMEOUT = 10.0
#: The two variables ``hqpcreds`` exports: the username, then the password.
ENV_PAIR = ("HQPTUNER_HQP_USERNAME", "HQPTUNER_HQP_PASSWORD")


class LoginFailedError(Exception):
    """The login at ``url`` did not earn a cookie; ``why`` says whether it was refused, unanswered or unreachable."""

    def __init__(self, *, url: str, why: str) -> None:
        """Name the login's URL and the reason."""
        super().__init__(f"login at {url}/api/login failed: {why}")


def credentials(url: str) -> tuple[str, str]:
    """Return the username and password from the environment, or raise naming the variable that is not set."""
    for name in ENV_PAIR:
        if name not in os.environ:
            raise LoginFailedError(url=url, why=f"{name} is not set; source hqpcreds first")
    username, password = (os.environ[name] for name in ENV_PAIR)
    return username, password


def refusal(status: int, raw: bytes) -> str:
    """Render a non-200 answer as its status and the sentence the app sent, or the status alone."""
    detail = ""
    body: object = {}
    try:
        body = json.loads(raw)
    except ValueError:
        body = {}
    if isinstance(body, dict):
        detail = str(body.get("detail", ""))
    return f"answered {status}: {detail}" if detail else f"answered {status}"


def login_cookie(url: str) -> str:
    """Log in to the HQPTuner at ``url`` and return the login cookie's value, or raise ``LoginFailedError``."""
    username, password = credentials(url)
    parts = urlsplit(url)
    connect = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    body = json.dumps({"username": username, "password": password, "remember": False})
    try:
        connection = connect(parts.netloc, timeout=TIMEOUT)
        try:
            connection.request("POST", "/api/login", body=body, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            raw = response.read()
            cookie_header = response.getheader("Set-Cookie", "")
        finally:
            connection.close()
    except (OSError, http.client.HTTPException) as exc:
        raise LoginFailedError(url=url, why=f"no answer ({exc})") from exc
    if response.status != http.HTTPStatus.OK:
        raise LoginFailedError(url=url, why=refusal(response.status, raw))
    jar: SimpleCookie = SimpleCookie(cookie_header)
    if LOGIN_COOKIE not in jar:
        raise LoginFailedError(url=url, why=f"answered 200 with no {LOGIN_COOKIE} cookie")
    return jar[LOGIN_COOKIE].value
