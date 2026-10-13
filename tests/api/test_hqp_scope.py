"""Which hqplayerd configuration HQPTuner's settings writes land in.

hqplayerd keeps a system configuration (``/etc/hqplayer``) and a user one
(``~/.hqplayer``), and ``POST /restore`` takes a ``scope`` form field, ``system``
or ``user``, choosing which one a write goes to (docs/protocol.md §3.6).
``HQPTUNER_HQP_SCOPE`` chooses it for HQPTuner: ``user`` aims every settings
write at the user configuration, unset keeps every one on the system
configuration, and any other value refuses the configuration at construction.

The writes are driven through the REST surface, built from a ``Config`` that
reads the variable itself, and the fake 8088 daemon records the ``scope`` field
of every ``POST /restore`` that reaches it. Each case clears that record just
before the write under test, so setup traffic is not counted.
"""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from fixtures_clients import app

from hqptuner.config import Config

#: The environment variable under test.
SCOPE_ENV = "HQPTUNER_HQP_SCOPE"

#: hqplayerd's own values for the ``scope`` field of ``POST /restore``.
SYSTEM = "system"
USER = "user"

#: A preset this test saves, and the http form field it edits; ``title`` is the
#: daemon's own form field name and the values are this test's.
PRESET = "Kept"
TITLE = "title"
RENAMED = "Renamed"

#: An engine attribute and a value inside its domain that differs from the fake's.
ENGINE_OVERRIDE = {"cuda": "convolution"}

#: Values that are neither ``system`` nor ``user``.
BAD_SCOPES = ["global", "users"]


def _persistent_apply(client: TestClient, daemon: dict[str, Any]) -> None:
    client.post("/api/config/stage", json={"http": {TITLE: RENAMED}})
    daemon["_restore_scopes"] = []
    client.post("/api/config/apply")


def _engine_write(client: TestClient, daemon: dict[str, Any]) -> None:
    daemon["_restore_scopes"] = []
    client.post("/api/engine", json={"overrides": ENGINE_OVERRIDE})


def _preset_load(client: TestClient, daemon: dict[str, Any]) -> None:
    client.post("/api/profile/save", json={"name": PRESET})
    client.post("/api/config/stage", json={"http": {TITLE: RENAMED}})
    client.post("/api/config/apply")
    daemon["_restore_scopes"] = []
    client.post("/api/profile/load", json={"name": PRESET})


def _preset_mirror(client: TestClient, daemon: dict[str, Any]) -> None:
    daemon["_restore_scopes"] = []
    client.post("/api/profile/save", json={"name": PRESET})


#: Every kind of settings write HQPTuner sends to hqplayerd.
WRITES = [
    pytest.param(_persistent_apply, id="persistent apply"),
    pytest.param(_engine_write, id="engine attribute"),
    pytest.param(_preset_load, id="preset load"),
    pytest.param(_preset_mirror, id="preset mirror"),
]

Write = Callable[[TestClient, dict[str, Any]], None]


@pytest.fixture
def scoped_scopes(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Callable[[str | None, Write], set[str | None]]]:
    """Run one write on an app started with the variable set to the given value,
    or unset for ``None``, and hand back the scopes its restores carried."""
    served: list[Iterator[TestClient]] = []

    def run(value: str | None, write: Write) -> set[str | None]:
        if value is None:
            monkeypatch.delenv(SCOPE_ENV, raising=False)
        else:
            monkeypatch.setenv(SCOPE_ENV, value)
        started = app(http_daemon, tmp_path, closed_port, None)
        served.append(started)
        write(next(started), http_daemon)
        return set(http_daemon["_restore_scopes"])

    yield run
    for started in served:
        next(started, None)


@pytest.mark.parametrize("write", WRITES)
def test_a_user_scope_aims_every_settings_write_at_the_user_configuration(
    scoped_scopes: Callable[[str | None, Write], set[str | None]], write: Write
) -> None:
    assert scoped_scopes(USER, write) == {USER}


@pytest.mark.parametrize("write", WRITES)
def test_an_unset_scope_keeps_every_settings_write_on_the_system_configuration(
    scoped_scopes: Callable[[str | None, Write], set[str | None]], write: Write
) -> None:
    assert scoped_scopes(None, write) == {SYSTEM}


def test_a_system_scope_set_explicitly_aims_a_write_at_the_system_configuration(
    scoped_scopes: Callable[[str | None, Write], set[str | None]],
) -> None:
    assert scoped_scopes(SYSTEM, _persistent_apply) == {SYSTEM}


@pytest.mark.parametrize("value", BAD_SCOPES)
def test_a_scope_other_than_system_or_user_is_refused_at_construction(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv(SCOPE_ENV, value)
    with pytest.raises(ValueError):
        Config()
