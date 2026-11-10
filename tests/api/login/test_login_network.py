"""The login pair check reaches the daemon over the transport its network hands it.

Policy: docs/testing.md. The 8088 fake is served only in process, at an address no socket answers on.
"""

import functools
from pathlib import Path

import fake_http
import fake_network
import pytest
from apps import METADATA_MIN, ready_app
from fake_control import DEFAULTS, serve_shared

from hqptuner.conf.httpauth import PairVerdict, check_pair
from hqptuner.config import Config

#: A ceiling on a request the fake answers at once, never a duration anything is expected to take.
CEILING = 5.0


@pytest.mark.parametrize(("refuses", "verdict"), [(False, PairVerdict.ACCEPTED), (True, PairVerdict.REFUSED)])
async def test_the_pair_check_reaches_the_in_process_daemon_over_the_transport_it_is_handed(
    *, refuses: bool, verdict: PairVerdict
) -> None:
    daemon = fake_http.spawn(fake_http.state(_refuse_auth=refuses), in_process=True)
    port = next(daemon)["_port"]
    transport = fake_network.http_transport("127.0.0.1", port)
    assert await check_pair("127.0.0.1", port, "admin", "pw", CEILING, transport=transport) is verdict
    next(daemon, None)


def test_a_login_on_an_app_handed_the_network_is_accepted(tmp_path: Path) -> None:
    with fake_network.serving(functools.partial(serve_shared, state=dict(DEFAULTS))) as control_port:
        daemon = fake_http.spawn(fake_http.state(), in_process=True)
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=control_port,
            hqp_http_port=next(daemon)["_port"],
            hqp_username="admin",
            hqp_password="pw",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
            connection_file=tmp_path / "connection.json",
        )
        with ready_app(cfg) as client:
            login = client.post("/api/login", json={"username": "admin", "password": "pw", "remember": False})
            assert login.status_code == 200
        next(daemon, None)
