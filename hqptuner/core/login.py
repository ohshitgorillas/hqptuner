"""The login token: what HQPTuner mints when a browser logs in and checks on every gated request.

A token is an HMAC over this install's secret and a fingerprint of the username and password in force, plus the
login's kind, its issue time and a random nonce. Changing the pair ends every login made under the old one, because
the fingerprint no longer matches. The kind and the issue time ride inside the signed value, so neither can be
changed without failing the check, and each kind has its own age limit.

This module reads no clock: minting takes the issue instant and checking takes the current instant from the caller.

The secret is random bytes held in memory from first use. It is written beside the connection record only when a
login asks to stay logged in across restarts, and once that file exists it is the secret at every start.
"""

import contextlib
import enum
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from hqptuner.presets.store.jsonfile import StoreCorruptError
from hqptuner.unwritable import reading, saving

#: How long a "save password" login lasts; the cookie's ``Max-Age`` is this, so cookie and server agree.
SAVED_LIFETIME = timedelta(days=30)
#: How long a "log in every time" login lasts, which bounds a browser session the user never closes.
SESSION_LIFETIME = timedelta(hours=24)

_SECRET_BYTES = 32
_WHAT = "the login secret"
_VERSION = "v1"
_TOKEN_PARTS = 4


class LoginKind(enum.Enum):
    """Which choice the browser made at login, which decides how long the login lasts."""

    SAVED = "saved"
    SESSION = "session"


_LIFETIME = {LoginKind.SAVED: SAVED_LIFETIME, LoginKind.SESSION: SESSION_LIFETIME}


@dataclass(frozen=True)
class Login:
    """A token that checked out: its kind and the instant it was issued."""

    kind: LoginKind
    issued: datetime


class LoginSecret:
    """This install's token secret, read from its file on first use and written only when a login stays."""

    def __init__(self, path: Path) -> None:
        """Bind to the secret file at ``path``, which is not touched until the first use."""
        self._path = path
        self._value: bytes | None = None

    def value(self) -> bytes:
        """Return the secret: the file's when it exists, else fresh random bytes held in memory.

        Raises ``StoreCorruptError`` when the file exists but is not a secret, ``StoreUnwritableError`` when the
        filesystem refuses the read. A failure leaves nothing cached, so the next use tries again.
        """
        if self._value is None:
            self._value = self._read() or secrets.token_bytes(_SECRET_BYTES)
        return self._value

    def persist(self) -> None:
        """Write the secret in memory to the file unless one exists, so earlier tokens keep verifying.

        The file appears whole or not at all and is created exclusively, so two first writers leave one secret:
        the loser adopts the file's. Owner-only permissions where the OS has them.
        """
        mine = self.value()
        tmp = self._path.with_name(self._path.name + ".tmp")
        with saving(_WHAT, self._path):
            self._path.parent.mkdir(parents=True, exist_ok=True)
            try:
                descriptor = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(descriptor, "w", encoding="ascii") as handle:
                    handle.write(mine.hex() + "\n")
                os.link(tmp, self._path)
            except FileExistsError:
                self._value = self._read()
            finally:
                tmp.unlink(missing_ok=True)

    def _read(self) -> bytes | None:
        """Return the file's secret, None when there is no file."""
        if not self._path.is_file():
            return None
        with reading(_WHAT, self._path):
            text = self._path.read_text(encoding="ascii", errors="replace")
        try:
            found = bytes.fromhex(text.strip())
        except ValueError as exc:
            raise StoreCorruptError(_WHAT, self._path) from exc
        if len(found) != _SECRET_BYTES:
            raise StoreCorruptError(_WHAT, self._path)
        return found


def _fingerprint(username: str, password: str) -> bytes:
    """Reduce a pair to bytes that differ for every different pair, joined so no two pairs share a spelling."""
    return hashlib.sha256(f"{len(username)}:{username}:{password}".encode()).digest()


def _signature(secret: LoginSecret, kind: LoginKind, issued: int, nonce: str, pair: tuple[str, str]) -> str:
    """Return the HMAC hex of one token's fields under the install secret and the pair's fingerprint."""
    body = "\0".join((_VERSION, kind.value, str(issued), nonce)).encode() + b"\0" + _fingerprint(*pair)
    return hmac.new(secret.value(), body, hashlib.sha256).hexdigest()


def mint(secret: LoginSecret, username: str, password: str, kind: LoginKind, issued: datetime) -> str:
    """Return a token for this pair and kind, issued at ``issued``."""
    stamp = int(issued.timestamp())
    nonce = secrets.token_hex(8)
    sig = _signature(secret, kind, stamp, nonce, (username, password))
    return ".".join((kind.value, str(stamp), nonce, sig))


def check(secret: LoginSecret, token: str, username: str, password: str, now: datetime) -> Login | None:
    """Return the login a token proves for this pair at ``now``, or None when it proves none.

    None for a token that is malformed, signed under another secret or pair, changed in any byte, or older than its
    kind allows.
    """
    parts = token.split(".")
    if len(parts) != _TOKEN_PARTS:
        return None
    kind: LoginKind | None = None
    stamp: int | None = None
    with contextlib.suppress(ValueError):
        kind = LoginKind(parts[0])
        stamp = int(parts[1])
    if kind is None or stamp is None:
        return None
    expected = _signature(secret, kind, stamp, parts[2], (username, password))
    if not hmac.compare_digest(expected.encode(), parts[3].encode()):
        return None
    issued = datetime.fromtimestamp(stamp, UTC)
    if now - issued > _LIFETIME[kind]:
        return None
    return Login(kind, issued)
