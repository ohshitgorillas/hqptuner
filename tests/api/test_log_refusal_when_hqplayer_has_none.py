"""How the log tail refuses when HQPlayer answers that it has no log to serve.

HQPlayer's web interface serves its log on `GET /log`; a daemon with no log
answers that page 404. The System tab reads the log through `GET /api/log`, and
the page shows its own sentence for that one case, so the refusal's `code` (the
identifier a client acts on, docs/architecture.md §8.1) has to tell it apart from
every other way the read fails: HQPlayer erroring on the page, and HQPlayer not
reachable at all. Which identifier each case gets is HQPTuner's to choose; what
is pinned is that the no-log case does not share one with the others.

The app runs on both lanes, the threaded 4321 fake plus an in-process 8088 fake, and is ready before the case reads the
log. The 8088 fake answers `/log` with the status the case sets; the unreachable case takes the 8088 lane away after the
app is ready.
"""

from pathlib import Path

import fake_http
import pytest
from apps import log_in, ready_app
from fastapi.testclient import TestClient

from hqptuner.config import Config

#: HQPlayer's own answer when it has no log to serve.
NO_LOG = 404

#: HQPlayer answering the log page with a failure of its own.
ERRORING = (500, 503)


def _log_refusal_code(control_port: int, tmp_path: Path, *, log_status: int | None) -> str:
    """The `code` `GET /api/log` refuses with, from a ready app whose 8088 daemon answers the log page ``log_status``,
    or (None) whose 8088 lane is taken away after the app is ready."""
    daemon = fake_http.spawn(fake_http.state(_log_status=log_status or 200), in_process=True)
    st = next(daemon)
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=st["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with ready_app(cfg) as client:
        log_in(client)
        if log_status is None:
            st["_take_lane_down"]()
        code = _refusal_code(client)
    next(daemon, None)
    return code


def _refusal_code(client: TestClient) -> str:
    code: str = client.get("/api/log").json().get("code", "")
    return code


@pytest.mark.parametrize("status", ERRORING)
def test_hqplayer_having_no_log_is_refused_apart_from_hqplayer_erroring(
    status: int, threaded_daemon_port: int, tmp_path: Path
) -> None:
    no_log = _log_refusal_code(threaded_daemon_port, tmp_path / "no-log", log_status=NO_LOG)
    erroring = _log_refusal_code(threaded_daemon_port, tmp_path / str(status), log_status=status)
    assert no_log != erroring


def test_hqplayer_having_no_log_is_refused_apart_from_hqplayer_unreachable(
    threaded_daemon_port: int, tmp_path: Path
) -> None:
    no_log = _log_refusal_code(threaded_daemon_port, tmp_path / "no-log", log_status=NO_LOG)
    unreachable = _log_refusal_code(threaded_daemon_port, tmp_path / "unreachable", log_status=None)
    assert no_log != unreachable
