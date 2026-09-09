"""Where the daemon is and who we are to it, settable at runtime and kept for the install.

Until this store existed, ``hqp_host``, ``hqp_username`` and ``hqp_password`` were read from ``HQPTUNER_*`` at
construction and never moved again (``config.py``). That is fine on the container, where an operator writes a compose
file, and useless on a Windows install, where nobody sets an environment variable and there is no place to type a
credential.

The store holds one record — host, username, password, ``remember`` — written whole on every save. ``remember`` false
still writes a record: the host and the username belong to the install either way, and the password is written as the
empty string, which is how "log in every time" survives a restart without leaving the password on disk.

Layering, in order, per start:

1. a non-empty ``HQPTUNER_HQP_HOST`` / ``_USERNAME`` / ``_PASSWORD`` wins, so a container's pins keep their meaning
2. otherwise a stored record is the whole answer for all three fields, never field by field: an omitted password
   falling back to the stock pair at ``config.py`` would hand a configured install a credential it never chose
3. otherwise the defaults in ``config.py`` stand, which is a fresh install with nothing configured

An empty variable counts as absent, on the reading ``_optional_path`` already takes in ``config.py``: an empty value
is not a value, it is the absence of one.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from hqptuner.conf.httpconf import HttpConfigClient

if TYPE_CHECKING:
    from pathlib import Path

    from hqptuner.config import Config

log = logging.getLogger(__name__)

# The record's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. Stamped on every write so a
# later layout can tell the shapes apart.
SCHEMA = 1

# The three fields this store layers under, each named by the variable that outranks it.
_ENV_HOST = "HQPTUNER_HQP_HOST"
_ENV_USERNAME = "HQPTUNER_HQP_USERNAME"
_ENV_CREDENTIAL = "HQPTUNER_HQP_PASSWORD"


@dataclass(frozen=True)
class ConnectionRecord:
    """One install's daemon address and management credentials, as they were last saved.

    ``password`` is the empty string whenever ``remember`` is false — the record is written whole, so there is no
    state in which a stale password survives the user turning remembering off.
    """

    host: str
    username: str
    password: str
    remember: bool


class ConnectionStore:
    """The connection record in one JSON file, created lazily on the first save."""

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def read(self) -> ConnectionRecord | None:
        """Return the stored record, or None when nothing has been saved.

        A file that is absent, unreadable or malformed reads as nothing saved, which puts HQPTuner in the state a
        fresh install is in: the defaults, and a surface the user can save a working connection over. Refusing to
        start over a damaged record would leave them nowhere to type one.
        """
        if not self._path.is_file():
            return None
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            return ConnectionRecord(
                host=str(data["host"]),
                username=str(data["username"]),
                password=str(data.get("password", "")),
                remember=bool(data.get("remember")),
            )
        except (ValueError, OSError, TypeError, KeyError):
            log.warning("connection store at %s is unreadable — starting on the defaults", self._path)
            return None

    def write(self, record: ConnectionRecord) -> None:
        """Replace the record with ``record``, whole.

        ``remember`` false writes the password as the empty string rather than leaving the field out: a reader that
        found no password would have to fall back somewhere, and the only honest fallback is "no password".
        """
        payload: dict[str, Any] = {
            "schema": SCHEMA,
            "host": record.host,
            "username": record.username,
            "password": record.password if record.remember else "",
            "remember": record.remember,
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self._path)


def _pinned(name: str) -> bool:
    """Report whether the environment pins this field, an empty value counting as absent."""
    return bool(os.environ.get(name, "").strip())


def host_is_unchosen(record: ConnectionRecord | None) -> bool:
    """Report whether nothing has named the daemon's host: no saved record, and no variable pinning it.

    The one state in which HQPTuner is free to look for a daemon itself. Anything the user or the deployment
    named outranks what a search would find, which is the same order ``layer_onto_config`` keeps.
    """
    return record is None and not _pinned(_ENV_HOST)


def layer_onto_config(cfg: Config, record: ConnectionRecord | None) -> None:
    """Move the stored host and credentials into ``cfg``, leaving every field the environment pins alone.

    Mutates the config in place because it is the object every lane already holds: the control lane re-reads
    ``cfg.hqp_host`` on each reconnect (``core/loader``), so a new address needs no wiring beyond this.
    """
    if record is None:
        return
    if not _pinned(_ENV_HOST):
        cfg.hqp_host = record.host
    if not _pinned(_ENV_USERNAME):
        cfg.hqp_username = record.username
    if not _pinned(_ENV_CREDENTIAL):
        cfg.hqp_password = record.password


def build_http_client(cfg: Config) -> HttpConfigClient | None:
    """Build the 8088 configuration client for ``cfg``, or None when either credential is missing.

    One builder for both paths — app construction and a runtime save — so the rule "no credentials, no 8088 lane"
    (architecture section 3) is stated once.
    """
    if not cfg.hqp_username or not cfg.hqp_password:
        return None
    return HttpConfigClient(cfg.hqp_host, cfg.hqp_http_port, cfg.hqp_username, cfg.hqp_password)
