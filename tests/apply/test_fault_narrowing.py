"""Which faults the connect/poll path is allowed to swallow.

An expected wire or state fault — a route refusing, a stored preset the store
will not read — keeps the quiet-retry behavior: it is recorded where it
happened and costs nothing else. Every fault here is injected at the wire (a 503
on a named 8088 route) or through constructor inputs (a preset directory another
HQPTuner version stamped), never by patching the manager.
"""

from typing import Any

import pytest
from conftest import ManagerFactory, StartManager
from narrow import present

from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import forms

#: The three pages the 8088 web UI is read from in one pass, each with the field
#: of its parsed form that is non-empty on any real daemon — so "this form was
#: fetched" is answered from the form's own content, not from it merely existing.
FORMS = {
    "config": lambda form: form["fields"] != [],
    "matrix": lambda form: form["rows"] != [],
    "speakers": lambda form: form["channels"] != [],
}


# --- the polled forms: one refusing route must not cost the others ------------
# A 503 on one page is an expected wire fault — readme §1.9's /speakers is a
# whole subsystem a daemon can be without, and the matrix and config pages can
# refuse alone just as readily. Such a fault belongs to its own form and stops
# there.


async def test_a_refusing_form_route_leaves_the_last_good_snapshot_in_place(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    # a good pass first, then the route refuses while the daemon's own state
    # moves: the stale-but-real snapshot must survive, not be cleared
    await forms.refresh(http_manager)
    http_daemon["matrix_active"] = "Mch-to-Stereo mixdown"
    http_daemon["_fail_paths"] = ["/matrix"]
    await forms.refresh(http_manager)
    assert present(http_manager.readings.matrix_form)["active"] == "[Default]"


# --- connect-time faults on the best-effort lanes -----------------------------
# The 8088 lane and the preset migration both ride alongside the 4321 connect.
# Neither may undo it: what these pin is that a fault on either leaves no
# fabricated truth and imports nothing.


@pytest.mark.parametrize(
    ("fail_paths", "expected"),
    [([], True), (["/backup/settings.zip"], False)],
    ids=["healthy", "refusing"],
)
async def test_a_refusing_backup_route_leaves_file_config_unset_but_a_healthy_one_sets_it(
    start_manager: StartManager, http_daemon: dict[str, Any], fail_paths: list[str], *, expected: bool
) -> None:
    http_daemon["_fail_paths"] = fail_paths
    manager = await start_manager(http_daemon["_port"])
    assert (manager.readings.file_config is not None) is expected


# --- baseline: a healthy pass records nothing ---------------------------------


#: Whether a form's error slot holds an error: nothing recorded, or something recorded.
NO_ERROR, ERROR_RECORDED = "no error", "error recorded"


def _recorded_error(manager: ConnectionManager, form: str) -> str:
    """``NO_ERROR`` when ``form``'s error slot is empty, else ``ERROR_RECORDED``."""
    return NO_ERROR if getattr(manager.readings, f"{form}_error") is None else ERROR_RECORDED


@pytest.mark.parametrize("form", sorted(FORMS))
@pytest.mark.parametrize(
    ("refusing", "expected"), [(False, NO_ERROR), (True, ERROR_RECORDED)], ids=["healthy", "refusing"]
)
async def test_a_healthy_pass_records_no_error_but_a_refusing_route_does(
    http_manager_factory: ManagerFactory,
    http_daemon: dict[str, Any],
    form: str,
    *,
    refusing: bool,
    expected: str,
) -> None:
    manager = http_manager_factory(http_daemon)
    http_daemon["_fail_paths"] = [f"/{form}"] if refusing else []
    await forms.refresh(manager)
    assert _recorded_error(manager, form) == expected
