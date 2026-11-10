"""Which daemon an install ends up talking to when nothing local names one.

A container gets its host's address through an alias the deployment provides
(`host.docker.internal`, `compose.yaml`'s `host-gateway`), which is a name that
exists inside a container only. So the alias here is a settable address and the
cases point it at a loopback stand-in: the whole of 127/8 is loopback, so three
full hqplayerd pairs (4321 control beside the 8088 config lane) sit at
127.0.0.2, 127.0.0.3 and 127.0.0.4 on one pair of port numbers, and which one
answers `GET /api/config` is which address the app resolved.

Each pair's config fake carries its OWN marker in the `title` form field, put
there by this test and read back off the wire (docs/testing.md rule 9), so the
three cases are told apart by the daemon that answered rather than by a status
code. Nothing answers at the `config.py` default 127.0.0.1: an install that
never resolves an address reaches no daemon at all.

The alias is asked only where the process says it runs in the HQPTuner image
(`Config.in_image`), so every case here is a start inside the image.
"""

from collections.abc import Iterator
from pathlib import Path

import fake_http
import pytest
from apps import closed_port, log_in, ready_app
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient

from hqptuner.config import Config
from hqptuner.core.connection import ConnectionRecord, ConnectionStore

#: The address the container-host alias is set to, the address a saved
#: connection record names, and the address the environment variable names.
ALIAS_ADDRESS = "127.0.0.2"
RECORD_ADDRESS = "127.0.0.3"
ENV_ADDRESS = "127.0.0.4"

#: What each pair's own 8088 fake puts in its `title` form field. `title` is the
#: daemon's form field name (wire) and the values are this test's own.
MARKERS = {
    ALIAS_ADDRESS: "PAIR-A-ALIAS",
    RECORD_ADDRESS: "PAIR-B-RECORD",
    ENV_ADDRESS: "PAIR-C-ENV",
}


@pytest.fixture
def daemon_pairs() -> Iterator[tuple[int, int]]:
    """One hqplayerd pair per address, every pair on the same two port numbers
    so a single `Config` reaches whichever address the app resolves."""
    control_port, http_port = closed_port(), closed_port()
    running: list[Iterator[object]] = []
    for address, marker in MARKERS.items():
        control = spawn_threaded_daemon(host=address, bind_port=control_port)
        next(control)
        running.append(control)
        http = fake_http.spawn(fake_http.state(title=marker), host=address, bind_port=http_port, in_process=True)
        next(http)
        running.append(http)
    yield control_port, http_port
    for served in reversed(running):
        next(served, None)


def served_title(client: TestClient) -> str:
    """The `title` the daemon behind this app serves, or the status `/api/config` answered."""
    resp = client.get("/api/config")
    if resp.status_code != 200:
        return f"HTTP {resp.status_code}"
    fields = {field["name"]: field for field in resp.json()["data"]["fields"]}
    return str(fields["title"]["value"])


@pytest.mark.parametrize(
    ("record_host", "env_host", "expected"),
    [
        (None, None, MARKERS[ALIAS_ADDRESS]),
        (RECORD_ADDRESS, None, MARKERS[RECORD_ADDRESS]),
        (None, ENV_ADDRESS, MARKERS[ENV_ADDRESS]),
    ],
)
def test_a_start_dials_the_record_then_the_variable_and_falls_back_to_the_host_alias(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    daemon_pairs: tuple[int, int],
    *,
    record_host: str | None,
    env_host: str | None,
    expected: str,
) -> None:
    control_port, http_port = daemon_pairs
    store_path = tmp_path / "connection.json"
    if record_host is not None:
        ConnectionStore(store_path).write(ConnectionRecord(host=record_host, username="u", password="p", remember=True))
    monkeypatch.delenv("HQPTUNER_HQP_HOST", raising=False)
    if env_host is not None:
        monkeypatch.setenv("HQPTUNER_HQP_HOST", env_host)
    # hqp_host is deliberately NOT passed: the variable and the record are the
    # only things that may name one, which is the state a fresh install starts in
    cfg = Config(
        hqp_control_port=control_port,
        hqp_http_port=http_port,
        hqp_username="u",
        hqp_password="p",
        container_host_alias=ALIAS_ADDRESS,
        in_image=True,
        connection_file=store_path,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
    )
    with ready_app(cfg) as client:
        # Logged in once the start has resolved the host and read ready: the pair is checked at the address in force.
        log_in(client)
        answered = served_title(client)
    assert answered == expected
