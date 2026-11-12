"""A PCM-source filter staged in SDM output mode applies as one `SetFilter` and nothing else.

The Resampling drawer stages a pick in the form buffer under the register field name,
`oversampling1x` or `oversampling`, and Apply routes it live on the loaded chain. The
app runs against both fakes: the 4321 command log shows what reached the engine, and
the 8088 fake counts restores and config form posts, either of which restarts or
rewrites the daemon under the listener.

Enum ID 23 is `sinc-M` on the fake's SDM filter list, and 38 is `poly-sinc-gauss-long`.
"""

import contextlib
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from apps import phase_is_ready, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog
from fixtures_clients import app

#: The fake's State mode index for SDM.
SDM_MODE = "2"
#: The two PCM-source filter fields of the SDM chain, each with an enum ID on the fake's SDM list.
ONE_X_EDIT = {"oversampling1x": "23"}
NX_EDIT = {"oversampling": "38"}
BOTH_EDITS = {**ONE_X_EDIT, **NX_EDIT}
EDITS = {"1x": ONE_X_EDIT, "nx": NX_EDIT}


class Applied(NamedTuple):
    """What staging and applying a batch did: the stage call's status, the commands the
    engine received after it, and the config lane's counters before and after."""

    staged: int
    commands: list[str]
    before: dict[str, int]
    after: dict[str, int]


@pytest.fixture
def applied(http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[Callable[[dict[str, str]], Applied]]:
    stack = contextlib.ExitStack()

    def counters() -> dict[str, int]:
        return {key: http_daemon[key] for key in ("_restore_attempts", "_form_posts")}

    def run(edits: dict[str, str]) -> Applied:
        log: CommandLog = []
        ports = spawn_threaded_daemon(state={**DEFAULTS, "mode": SDM_MODE}, log=log)
        port = next(ports)
        stack.callback(next, ports, None)
        clients = app(http_daemon, tmp_path, port, None)
        client = next(clients)
        stack.callback(next, clients, None)
        wait_for_api(client, phase_is_ready)
        before, sent = counters(), len(log)
        staged = client.post("/api/config/stage", json={"http": edits}).status_code
        client.post("/api/config/apply")
        return Applied(staged, [name for name, _attrs in log[sent:]], before, counters())

    yield run
    stack.close()


@pytest.mark.parametrize("edit", EDITS.values(), ids=EDITS.keys())
def test_an_sdm_filter_pick_is_accepted_by_the_stage_call(
    applied: Callable[..., Applied], edit: dict[str, str]
) -> None:
    assert applied(edit).staged == 200


@pytest.mark.parametrize("edit", EDITS.values(), ids=EDITS.keys())
def test_applying_an_sdm_filter_pick_sends_one_set_filter(
    applied: Callable[..., Applied], edit: dict[str, str]
) -> None:
    assert applied(edit).commands.count("SetFilter") == 1


@pytest.mark.parametrize("edit", EDITS.values(), ids=EDITS.keys())
def test_applying_an_sdm_filter_pick_does_not_set_the_mode(
    applied: Callable[..., Applied], edit: dict[str, str]
) -> None:
    assert "SetMode" not in applied(edit).commands


@pytest.mark.parametrize("edit", EDITS.values(), ids=EDITS.keys())
def test_applying_an_sdm_filter_pick_posts_no_restore(applied: Callable[..., Applied], edit: dict[str, str]) -> None:
    run = applied(edit)
    assert run.after["_restore_attempts"] == run.before["_restore_attempts"]


@pytest.mark.parametrize("edit", EDITS.values(), ids=EDITS.keys())
def test_applying_an_sdm_filter_pick_posts_no_config_form(
    applied: Callable[..., Applied], edit: dict[str, str]
) -> None:
    run = applied(edit)
    assert run.after["_form_posts"] == run.before["_form_posts"]


def test_both_sdm_filter_picks_staged_before_one_apply_send_a_single_set_filter(
    applied: Callable[..., Applied],
) -> None:
    assert applied(BOTH_EDITS).commands.count("SetFilter") == 1
