"""The login: a browser proves it knows the HQPlayer management pair, and gets a cookie that says so.

The typed pair is checked against hqplayerd itself, at the host the login names or the host in force. Nothing is
filled from the pair HQPTuner holds: a blank password is checked as blank. ``remember`` decides only the cookie this
browser gets and never the stored connection record.
"""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from hqptuner.api.deps import Mgr, config_of
from hqptuner.api.errors import ErrorBody, refuse
from hqptuner.api.gate import set_login_cookie
from hqptuner.api.routes.connection import (
    ConnectionReport,
    apply_connection,
    connection_report,
    remembered,
    store_of,
)
from hqptuner.conf.httpauth import PairVerdict, check_pair
from hqptuner.config import Config
from hqptuner.core.connection import ConnectionRecord
from hqptuner.core.login import LoginKind, LoginSecret, mint

router = APIRouter(prefix="/api")


class LoginBody(BaseModel):
    """One login for ``POST /api/login``.

    ``remember`` true is the "save password" choice: the cookie outlasts the browser session. An omitted username or
    password is blank, never the one HQPTuner holds. ``host`` names the daemon to check against; omitted, the host in
    force.
    """

    username: str = ""
    password: str = ""
    remember: bool = False
    host: str | None = None


class LoginRefusedError(ErrorBody):
    """hqplayerd refused the typed username and password."""

    code = "login_refused"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPlayer refused that username and password.")


class LoginNotAnsweredError(ErrorBody):
    """hqplayerd did not answer the check, so the pair is neither accepted nor refused."""

    code = "login_not_answered"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPlayer did not answer.")


def secret_of(request: Request) -> LoginSecret:
    """Return the app's login secret."""
    secret: LoginSecret = request.app.state.login_secret
    return secret


def _differs(cfg: Config, host: str, username: str, password: str) -> bool:
    """Whether the typed pair and host are not the ones in force."""
    return (host, username, password) != (cfg.hqp_host, cfg.hqp_username, cfg.hqp_password)


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response, manager: Mgr) -> ConnectionReport:
    """Check the typed pair against hqplayerd and answer with a login cookie, or refuse with no cookie.

    An accepted pair or host that is not the one in force is applied as a Connection-panel save applies it, carrying
    the stored ``remember`` choice, never this login's.
    """
    cfg = config_of(request)
    store = store_of(request)
    host = (body.host or "").strip() or cfg.hqp_host
    verdict = await check_pair(host, cfg.hqp_http_port, body.username, body.password, cfg.request_timeout)
    if verdict is PairVerdict.REFUSED:
        raise refuse(LoginRefusedError())
    if verdict is PairVerdict.NOT_ANSWERED:
        raise refuse(LoginNotAnsweredError())
    if _differs(cfg, host, body.username, body.password):
        record = ConnectionRecord(host, body.username, body.password, remembered(store))
        await apply_connection(cfg, store, manager, record)
    kind = LoginKind.SAVED if body.remember else LoginKind.SESSION
    secret = secret_of(request)
    if kind is LoginKind.SAVED:
        secret.persist()
    issued = manager.clock.now()
    set_login_cookie(response, mint(secret, cfg.hqp_username, cfg.hqp_password, kind, issued), kind)
    return connection_report(cfg, remembered=remembered(store))
