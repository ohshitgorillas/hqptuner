"""Connection REST surface — where the daemon is and who HQPTuner is to it, set while HQPTuner runs.

Two routes over the install-owned record in ``core/connection``. The write route is the only path that moves a
credential without a restart: it saves the record, moves the three fields into the live config, installs the 8088
client the new pair earns, and takes the control lane down so it comes back on the new address.

The password goes in and never comes back out. The read route answers whether one is held, not what it is: this
surface is reachable by any browser that reaches HQPTuner's own port, and a credential that is written once has no
reason to be readable afterwards (architecture section 3 keeps credentials server-side).
"""

import contextlib
from typing import Any

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from hqptuner.api.deps import Mgr
from hqptuner.api.errors import refuse
from hqptuner.config import Config
from hqptuner.core.connection import (
    ConnectionRecord,
    ConnectionSchemaError,
    ConnectionStore,
    build_http_client,
    layer_onto_config,
)

router = APIRouter(prefix="/api")


class ConnectionBody(BaseModel):
    """One saved connection for ``POST /api/connection``.

    Every field is optional and defaults to what HQPTuner is using now, so a client changing the host alone need not
    send the credentials back. ``remember`` false saves the host and the username and stores no password, which is the
    "log in every time" the user asked for: the pair lives in this process until it stops.
    """

    host: str | None = None
    username: str | None = None
    password: str | None = None
    remember: bool = True


def _store(request: Request) -> ConnectionStore:
    store: ConnectionStore = request.app.state.connections
    return store


def _config(request: Request) -> Config:
    cfg: Config = request.app.state.config
    return cfg


def _answer(cfg: Config, *, remembered: bool) -> dict[str, Any]:
    """Return the connection as a client may see it: where we dial, who we are, and whether a password is held."""
    return {
        "host": cfg.hqp_host,
        "username": cfg.hqp_username,
        "remember": remembered,
        "has_password": bool(cfg.hqp_password),
    }


def _remembered(store: ConnectionStore) -> bool:
    """Whether the stored record asks for the password to be kept; nothing saved yet reads as yes.

    Yes is the default because it is the setting a first save arrives with unless the user says otherwise.
    """
    record = store.read()
    return True if record is None else record.remember


@router.get("/connection")
def read_connection(request: Request) -> dict[str, Any]:
    """Answer with the daemon address and username in force, and whether a password is held.

    409 when the stored record is stamped newer than this HQPTuner reads — answering with the running values would
    hide a file that is there and full.
    """
    try:
        return _answer(_config(request), remembered=_remembered(_store(request)))
    except ConnectionSchemaError as exc:
        raise refuse(exc) from exc


@router.post("/connection")
async def write_connection(body: ConnectionBody, request: Request, manager: Mgr) -> dict[str, Any]:
    """Save the connection, then move HQPTuner onto it without a restart.

    The record is saved whatever the daemon says: verifying first would mean refusing to record a host the user is
    about to switch on, and a credential that cannot be saved while the daemon is down is a credential the user
    cannot fix an outage with.
    """
    cfg = _config(request)
    store = _store(request)
    record = ConnectionRecord(
        host=body.host if body.host is not None else cfg.hqp_host,
        username=body.username if body.username is not None else cfg.hqp_username,
        password=body.password if body.password is not None else cfg.hqp_password,
        remember=body.remember,
    )
    try:
        store.write(record)
    except OSError as exc:
        raise refuse("store_unwritable", f"cannot save the connection: {exc}") from exc
    # The request's record, not the stored one: `remember` false stores no password, and the pair is meant to work
    # for the rest of this run — "log in every time" is every HQPTuner restart, not every request.
    layer_onto_config(cfg, record)
    manager.http_client = build_http_client(cfg)
    await manager.retarget()
    if manager.http_client is not None:
        # Fill the 8088 snapshots the new pair just unlocked, here rather than at the next poll: the user typed a
        # credential to make the configuration surface work, and a route that keeps answering 503 for a poll interval
        # afterwards reads as the credential having been refused.
        with contextlib.suppress(httpx.HTTPError, OSError, TimeoutError):
            await manager.refresh_http_forms()
    manager.audit.connection_set(cfg.hqp_host, cfg.hqp_username, remember=record.remember)
    return _answer(cfg, remembered=record.remember)
