"""How the log tail refuses when HQPlayer answers that it has no log to serve.

HQPlayer's web interface serves its log on `GET /log`; a daemon with no log
answers that page 404. The System tab reads the log through `GET /api/log`, and
the page shows its own sentence for that one case, so the refusal's `code` (the
identifier a client acts on) has to tell it apart from every other way the read
fails: HQPlayer erroring on the page, and HQPlayer not reachable at all.
Which identifier each case gets is HQPTuner's to choose; what
is pinned is that the no-log case does not share one with the others.

The 8088 daemon here is a table: one status for `/log`, 404 for every other
page, served through `fake_http.spawn` so its teardown is the suite's own.
"""

from http.server import BaseHTTPRequestHandler
from pathlib import Path

import fake_http
import pytest
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: HQPlayer's own answer when it has no log to serve.
NO_LOG = 404

#: HQPlayer answering the log page with a failure of its own.
ERRORING = (500, 503)


def _log_page_answering(status: int) -> type[BaseHTTPRequestHandler]:
    """An 8088 daemon that answers `/log` with ``status`` and every other page 404."""
    table = {"/log": status}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(table.get(self.path.split("?", 1)[0], NO_LOG))
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def _log_refusal_code(http_port: int, control_port: int, tmp_path: Path) -> str:
    """The `code` `GET /api/log` refuses with, from an app whose 8088 lane is at
    ``http_port``; the control lane is at a port nothing listens on."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=http_port,
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with TestClient(create_app(cfg, VirtualClock())) as client:
        code: str = client.get("/api/log").json().get("code", "")
    return code


def _code_when_log_page_answers(status: int, closed_port: int, tmp_path: Path) -> str:
    daemon = fake_http.spawn({}, handler=_log_page_answering(status))
    st = next(daemon)
    code = _log_refusal_code(int(st["_port"]), closed_port, tmp_path / str(status))
    next(daemon, None)
    return code


@pytest.mark.parametrize("status", ERRORING)
def test_hqplayer_having_no_log_is_refused_apart_from_hqplayer_erroring(
    status: int, closed_port: int, tmp_path: Path
) -> None:
    no_log = _code_when_log_page_answers(NO_LOG, closed_port, tmp_path)
    erroring = _code_when_log_page_answers(status, closed_port, tmp_path)
    assert no_log != erroring


def test_hqplayer_having_no_log_is_refused_apart_from_hqplayer_unreachable(closed_port: int, tmp_path: Path) -> None:
    no_log = _code_when_log_page_answers(NO_LOG, closed_port, tmp_path)
    unreachable = _log_refusal_code(closed_port, closed_port, tmp_path / "unreachable")
    assert no_log != unreachable
