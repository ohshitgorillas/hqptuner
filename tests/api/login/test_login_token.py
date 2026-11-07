"""The login token: who it proves, how long it lasts and what survives a restart (docs/testing.md).

Stated at the store lane, with the instants passed in: no test waits on a clock.
"""

import os
import stat
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from hqptuner.config import LOGIN_KEY_FILE
from hqptuner.core.login import (
    SAVED_LIFETIME,
    SESSION_LIFETIME,
    Login,
    LoginKind,
    LoginSecret,
    check,
    mint,
)
from hqptuner.presets.store.jsonfile import StoreCorruptError

ISSUED = datetime(2030, 1, 1, 12, 0, 0, tzinfo=UTC)
ONE_SECOND = timedelta(seconds=1)
PAIR = ("admin", "pw")


@pytest.fixture
def secret(tmp_path: Path) -> LoginSecret:
    return LoginSecret(tmp_path / LOGIN_KEY_FILE)


def saved(secret: LoginSecret) -> str:
    return mint(secret, *PAIR, LoginKind.SAVED, ISSUED)


GOOD = Login(LoginKind.SAVED, ISSUED)


@pytest.mark.parametrize("kind", list(LoginKind))
def test_a_token_proves_its_kind_and_issue_time_for_its_pair(secret: LoginSecret, kind: LoginKind) -> None:
    token = mint(secret, *PAIR, kind, ISSUED)
    assert check(secret, token, *PAIR, ISSUED) == Login(kind, ISSUED)


@pytest.mark.parametrize(
    "pair", [("root", "pw"), ("admin", "other"), ("admi", "npw")], ids=["user", "password", "join"]
)
def test_a_token_proves_nothing_for_another_pair(secret: LoginSecret, pair: tuple[str, str]) -> None:
    token = saved(secret)
    assert [check(secret, token, *pair, ISSUED), check(secret, token, *PAIR, ISSUED)] == [None, GOOD]


def test_a_token_proves_nothing_under_another_installs_secret(secret: LoginSecret, tmp_path: Path) -> None:
    other = LoginSecret(tmp_path / "other" / LOGIN_KEY_FILE)
    token = saved(secret)
    assert [check(other, token, *PAIR, ISSUED), check(secret, token, *PAIR, ISSUED)] == [None, GOOD]


def _kind_swapped(parts: list[str]) -> None:
    parts[0] = LoginKind.SESSION.value


def _issue_moved(parts: list[str]) -> None:
    parts[1] = str(int(parts[1]) + 1)


def _nonce_changed(parts: list[str]) -> None:
    parts[2] = "0" * len(parts[2])


def _signature_changed(parts: list[str]) -> None:
    parts[3] = ("0" if parts[3][0] != "0" else "1") + parts[3][1:]


def _truncated(parts: list[str]) -> None:
    del parts[3]


@pytest.mark.parametrize("tamper", [_kind_swapped, _issue_moved, _nonce_changed, _signature_changed, _truncated])
def test_a_changed_token_proves_nothing(secret: LoginSecret, tamper: Callable[[list[str]], None]) -> None:
    token = saved(secret)
    parts = token.split(".")
    tamper(parts)
    assert [check(secret, ".".join(parts), *PAIR, ISSUED), check(secret, token, *PAIR, ISSUED)] == [None, GOOD]


@pytest.mark.parametrize("token", ["", "garbage", "saved.x.y.z", "other.1.2.3"])
def test_a_token_that_is_not_one_proves_nothing(secret: LoginSecret, token: str) -> None:
    assert [check(secret, token, *PAIR, ISSUED), check(secret, saved(secret), *PAIR, ISSUED)] == [None, GOOD]


@pytest.mark.parametrize(
    ("kind", "age", "holds"),
    [
        (LoginKind.SAVED, SAVED_LIFETIME - ONE_SECOND, True),
        (LoginKind.SAVED, SAVED_LIFETIME + ONE_SECOND, False),
        (LoginKind.SESSION, SESSION_LIFETIME - ONE_SECOND, True),
        (LoginKind.SESSION, SESSION_LIFETIME + ONE_SECOND, False),
        (LoginKind.SAVED, SESSION_LIFETIME + ONE_SECOND, True),
        (LoginKind.SESSION, SESSION_LIFETIME + ONE_SECOND, False),
    ],
    ids=[
        "saved-inside",
        "saved-past",
        "session-inside",
        "session-past",
        "saved-outlives-session",
        "session-ends-first",
    ],
)
def test_each_kind_lasts_its_own_lifetime(secret: LoginSecret, kind: LoginKind, age: timedelta, *, holds: bool) -> None:
    token = mint(secret, *PAIR, kind, ISSUED)
    assert (check(secret, token, *PAIR, ISSUED + age) is not None) is holds


def test_a_persisted_secret_is_the_one_a_restart_reads(secret: LoginSecret, tmp_path: Path) -> None:
    token = saved(secret)
    secret.persist()
    restarted = LoginSecret(tmp_path / LOGIN_KEY_FILE)
    assert check(restarted, token, *PAIR, ISSUED) == GOOD


def test_a_token_minted_before_the_secret_was_persisted_still_verifies(secret: LoginSecret) -> None:
    token = saved(secret)
    secret.persist()
    assert check(secret, token, *PAIR, ISSUED) == GOOD


def test_only_a_login_that_stays_writes_a_file(secret: LoginSecret, tmp_path: Path) -> None:
    check(secret, mint(secret, *PAIR, LoginKind.SESSION, ISSUED), *PAIR, ISSUED)
    before = sorted(entry.name for entry in tmp_path.iterdir())
    secret.persist()
    assert [before, sorted(entry.name for entry in tmp_path.iterdir())] == [[], [LOGIN_KEY_FILE]]


def test_a_persisted_secret_is_as_private_as_a_file_made_owner_only(secret: LoginSecret, tmp_path: Path) -> None:
    secret.persist()
    control = tmp_path / "control"
    os.close(os.open(control, os.O_WRONLY | os.O_CREAT, 0o600))
    assert stat.S_IMODE((tmp_path / LOGIN_KEY_FILE).stat().st_mode) == stat.S_IMODE(control.stat().st_mode)


def test_a_second_first_writer_adopts_the_secret_already_on_disk(secret: LoginSecret, tmp_path: Path) -> None:
    rival = LoginSecret(tmp_path / LOGIN_KEY_FILE)
    rival.value()
    secret.persist()
    rival.persist()
    assert rival.value() == secret.value()


@pytest.mark.parametrize("content", ["not hex\n", "abcd\n", ""], ids=["not-hex", "short", "empty"])
def test_an_unreadable_secret_file_is_refused_at_first_use_not_at_construction(tmp_path: Path, content: str) -> None:
    path = tmp_path / LOGIN_KEY_FILE
    path.write_text(content)
    broken = LoginSecret(path)
    with pytest.raises(StoreCorruptError):
        broken.value()
