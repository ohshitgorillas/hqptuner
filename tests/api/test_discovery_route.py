"""Asking the route what is on the network when the search window is zero.

A deployment that shortens `DISCOVERY_TIMEOUT` to nothing still has one daemon
it can reach without waiting for a datagram: the host the container-host alias
names, asked directly over its control port. So both cases here set the search
window to zero and point the search at a UDP port nothing is bound to, and the
only thing that differs between them is whether a control daemon is listening
at the alias: one answers with that daemon's record, the other with an empty
list. A route that spends the search window on the control exchange as well
answers empty in both.

The alias is `127.0.0.1` and the fake control daemon the record comes from is
the suite's own (tests/support/fake_control.py), so the four identity values
asserted are what this test's fixture answered `GetInfo` with, not the app's
copy, and the address is the one this test configured.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import _closed_port, spawn_threaded_daemon
from fastapi.testclient import TestClient
from httpx import Response

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The container-host alias these cases use: the loopback address the control
#: fake is spawned on, so the alias resolves to a daemon this test controls.
ALIAS = "127.0.0.1"

#: The identity `tests/support/fake_control.py` answers `GetInfo` with: name,
#: version, product, platform, in the order the record declares them.
FAKE_IDENTITY = ("Fake", "6", "Signalyst HQPlayer Embedded", "Linux")


@pytest.fixture
def control_port() -> Iterator[int]:
    """A control daemon listening at the alias, on an ephemeral port."""
    served = spawn_threaded_daemon(host=ALIAS)
    yield next(served)
    next(served, None)


def served(resp: Response) -> list[tuple[str, ...]] | str:
    """The address and the four identity values of every daemon served, or the
    status where the route did not answer with a list."""
    if resp.status_code != 200:
        return f"HTTP {resp.status_code}"
    body: list[dict[str, Any]] = resp.json()
    fields = ("address", "name", "version", "product", "platform")
    return [tuple(entry[field] for field in fields) for entry in body]


@pytest.mark.parametrize(
    ("alias_is_listening", "expected"),
    [
        (True, [(ALIAS, *FAKE_IDENTITY)]),
        (False, []),
    ],
)
def test_a_zero_search_window_still_serves_the_daemon_the_host_alias_names(
    tmp_path: Path,
    control_port: int,
    closed_port: int,
    *,
    alias_is_listening: bool,
    expected: list[tuple[str, ...]],
) -> None:
    cfg = Config(
        discovery_timeout=0.0,
        discovery_target=f"{ALIAS}:{_closed_port()}",
        container_host_alias=ALIAS,
        hqp_control_port=control_port if alias_is_listening else closed_port,
        metering_enabled=False,
        connection_file=tmp_path / "connection.json",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
    )
    with TestClient(create_app(cfg)) as client:
        answered = served(client.get("/api/discover"))
    assert answered == expected
