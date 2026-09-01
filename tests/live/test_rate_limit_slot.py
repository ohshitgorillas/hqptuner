"""A rate the user picks goes to the LIMIT slot, never to the exact-rate pin.

hqplayerd keeps two rate settings per family and they mean different things
(docs/settings-classification.md §Rate slots, docs/protocol.md §SetRate): the
exact-rate slot — `samplerate`/`bitrate`, the one `SetRate` writes — pins a
rate outright and ignores the source's base family, while the limit slot —
`defaults_samplerate`/`defaults_bitrate` — caps the family the engine is
already following and lets it pick the member of the tier that matches the
track. HQPTuner puts every rate choice in the limit slot and leaves the exact
slot on auto, so a 44.1k track still leaves at a 44.1k-base rate.

Both fakes run: the Control API fake on 4321 answers `State`, so what the
engine has pinned is read off the engine itself rather than off a report, and
the 8088 config fake adopts the restore, so what stands in the limit slot is
read out of the config the daemon accepted. The 8088 fake's config file starts
at `defaults_samplerate="192000"` and `defaults_bitrate="24576000"`, so every
value asserted below is a real change to it; the control fake's PCM rates list
carries 352800 at index 2 and 384000 at index 4, so a rate sent to `SetRate`
instead would be perfectly resolvable and would show up on `State.rate`.

44.1k and 48k members of one tier: 352800 is 8x on a 44.1k base and 384000 is
8x on a 48k base, so they are the same tier and 384000 is the member the limit
slot carries.
"""

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import spawn_threaded_daemon, wait_for_api
from fake_control import DEFAULTS, restart_into
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: (client over both lanes, the 8088 fake's state dict) for the given Control
#: API State overrides.
LimitApi = Callable[..., tuple[TestClient, dict[str, Any]]]


def _config_loaded(client: TestClient) -> bool:
    """Connect-and-load finished: the /config file view is grounded."""
    resp = client.get("/api/config")
    return resp.status_code == 200 and "title" in resp.json()["data"]["file"]


@pytest.fixture
def limit_api(tmp_path: Path) -> Iterator[LimitApi]:
    """Both lanes live: control on the threaded 4321 fake, config on the 8088
    fake, whose config file agrees with the loaded PCM chain.

    Keyword arguments are the control fake's State overrides — ``rate="2"``
    starts the engine with an exact rate already pinned. An adopted restore
    self-restarts the daemon (docs/architecture.md §1 lane 2), so the
    ``_on_restore`` hook moves the control fake's State to the config the 8088
    fake just took, the way one real daemon would."""
    ports: list[Iterator[int]] = []
    servers: list[Iterator[dict[str, Any]]] = []
    clients: list[TestClient] = []

    def build(**overrides: str) -> tuple[TestClient, dict[str, Any]]:
        control_state = {**DEFAULTS, "_cfg_dither": "0", "_cfg_modulator": "0", **overrides}
        port = spawn_threaded_daemon(state=control_state)
        ports.append(port)
        server = fake_http.spawn(fake_http.state(mode="pcm", dither="0", modulator="0"))
        servers.append(server)
        daemon = next(server)
        daemon["_on_restore"] = lambda: restart_into(
            control_state, daemon["mode"], daemon["dither"], daemon["modulator"]
        )
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(port),
            hqp_http_port=daemon["_port"],
            hqp_username="u",
            hqp_password="p",
            alarm_threshold=1.0,
            # the restore's self-restart reaches the manager only on its next
            # State poll (the fake cannot sever the 4321 socket), so the poll
            # runs at test pace rather than production's
            poll_interval=0.02,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
        client = TestClient(create_app(cfg))
        client.__enter__()
        clients.append(client)
        wait_for_api(client, _config_loaded)
        return client, daemon

    yield build
    for client in clients:
        client.__exit__(None, None, None)
    for server in servers:
        next(server, None)
    for port in ports:
        next(port, None)


def _pinned_rate(client: TestClient) -> str:
    """What the engine itself says it has pinned — `State.rate`, a `RatesItem`
    index, 0 being the engine's auto (protocol.md §6)."""
    rate: str = client.get("/api/state").json()["data"]["rate"]
    return rate


def test_a_live_rate_write_lands_in_the_limit_slot_and_pins_nothing(limit_api: LimitApi) -> None:
    # The whole point of the limit slot: the tier is capped and the engine still
    # picks the member matching the track's own base family. A lane that sent
    # `SetRate` instead leaves the limit at the file's 192000 and reads back
    # index 2 here.
    client, daemon = limit_api()
    client.post("/api/config/live", json={"fields": {"rate": "352800"}})
    assert (daemon["defaults_samplerate"], _pinned_rate(client)) == ("384000", "0")


def test_applying_a_live_preset_lands_its_rate_in_the_limit_slot(limit_api: LimitApi, tmp_path: Path) -> None:
    # A stored preset takes the same road as a direct write. 384000 sits at index
    # 4 of the fake's PCM rates list, so a lane that routed the stored rate to
    # `SetRate` would resolve it happily and leave the limit at 192000.
    (tmp_path / "live-presets.json").write_text(
        json.dumps({"schema": 1, "presets": {"Warm": {"chain": "pcm", "fields": {"rate": "384000"}, "names": {}}}})
    )
    client, daemon = limit_api()
    client.post("/api/livepresets/Warm/apply")
    assert daemon["defaults_samplerate"] == "384000"


def test_a_rate_pin_already_standing_on_the_engine_is_cleared(limit_api: LimitApi) -> None:
    # Index 2 (352800) is pinned before HQPTuner writes anything — an external
    # controller, or a build that used to pin. The exact slot outranks the limit,
    # so a write that left it standing would leave the user's choice with no
    # effect at all.
    client, _ = limit_api(rate="2")
    client.post("/api/config/live", json={"fields": {"rate": "384000"}})
    assert _pinned_rate(client) == "0"
