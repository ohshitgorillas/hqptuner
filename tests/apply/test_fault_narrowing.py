"""Which faults the connect/poll path is allowed to swallow.

An expected wire or state fault — a route refusing, a stored preset the store
will not read — keeps the quiet-retry behavior: it is recorded where it
happened and costs nothing else. Every fault here is injected at the wire (a 503
on a named 8088 route) or through constructor inputs (a preset directory another
HQPTuner version stamped), never by patching the manager.

The other half of the contract — an UNEXPECTED fault, one that is neither an
HTTP/transport error nor the control protocol's own error type, the kind our own
parsing bug would raise — has no wire injection available: no body we could
construct for either fake produces such a fault. Empty bodies, non-form pages,
non-numeric values in a ``type="number"`` input and a State carrying a non-numeric
volume, mode, filter index or ``RatesItem`` were all tried and all parse clean.
That is a statement about what we could build, not a pinned property of the
parsers. Those cases are injected through the manager's public constructor seam
instead — see ``FaultingMatrixClient`` at the foot of this file, and the reading
recorded above it.
"""

import contextlib
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import pytest
from conftest import ManagerFactory, StartManager
from narrow import present
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.conf.httpforms import MatrixForm
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import forms
from hqptuner.lanes.http.forms import FormsOutcome

#: The three pages the 8088 web UI is read from in one pass, each with the field
#: of its parsed form that is non-empty on any real daemon — so "this form was
#: fetched" is answered from the form's own content, not from it merely existing.
FORMS = {
    "config": lambda form: form["fields"] != [],
    "matrix": lambda form: form["rows"] != [],
    "speakers": lambda form: form["channels"] != [],
}

#: Every (route that refuses, form that must survive it) pair. Covering all six
#: is what makes the continuation claim independent of the order the pass reads
#: the pages in: a lane that aborts at its first failure fails some pair here
#: whichever page it happens to read first.
SURVIVORS = [(broken, intact) for broken in FORMS for intact in FORMS if broken != intact]


# --- the polled forms: one refusing route must not cost the others ------------
# A 503 on one page is an expected wire fault — readme §1.9's /speakers is a
# whole subsystem a daemon can be without, and the matrix and config pages can
# refuse alone just as readily. Such a fault belongs to its own form and stops
# there.


@pytest.mark.parametrize(("broken", "intact"), SURVIVORS)
async def test_a_refusing_form_route_still_refreshes_the_other_forms(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], broken: str, intact: str
) -> None:
    http_daemon["_fail_paths"] = [f"/{broken}"]
    await forms.refresh(http_manager)
    assert FORMS[intact](present(getattr(http_manager.readings, f"{intact}_form")))


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


def _newer_store(tmp_path: Path) -> Path:
    """A preset directory stamped by a schema no this-version store will read —
    every access raises, so the connect-time migration into it cannot succeed.
    Written by hand for the same reason a wire test writes a frame by hand: the
    situation under test is one a DIFFERENT HQPTuner version created."""
    presets = tmp_path / "newer-presets"
    presets.mkdir()
    (presets / "store.json").write_text(json.dumps({"schema": 99}))
    return presets


def _ordinary_store(tmp_path: Path) -> Path:
    """A preset directory this version's store creates and reads as its own."""
    return tmp_path / "presets"


def _imported(store: Path) -> list[str]:
    """Every entry the connect wrote beside the store's own layout file."""
    return sorted(p.name for p in store.rglob("*") if p.name != "store.json")


@pytest.mark.parametrize(
    ("make_store", "expected"),
    [(_ordinary_store, ["Test.xml"]), (_newer_store, [])],
    ids=["ordinary", "newer"],
)
async def test_a_store_stamped_by_a_newer_hqptuner_imports_nothing_but_an_ordinary_store_gets_the_daemons_preset(
    start_manager: StartManager,
    http_daemon: dict[str, Any],
    tmp_path: Path,
    make_store: Callable[[Path], Path],
    expected: list[str],
) -> None:
    # the daemon's own snapshots must NOT land in a store that refused. store.json
    # is the store's on-disk layout contract; anything beside it would be an
    # imported payload — and an ordinary store gets exactly that payload, the
    # daemon's own `Test.xml`.
    store = make_store(tmp_path)
    await start_manager(http_daemon["_port"], preset_dir=store)
    assert _imported(store) == expected


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


# --- the other half: an UNEXPECTED fault must not be swallowed ----------------
# Neither fake can serve a body that makes a parser raise (see the module
# docstring), so the fault is injected where a caller could inject it: the 8088
# client is a public constructor argument of ConnectionManager, and this subclass
# is passed as that argument. Here the client is a collaborator handed in
# through a documented public seam and the subject under test is the manager's
# own fault classification. Nothing else is patched: no manager method, no
# parser, no monkeypatching.


class FaultingMatrixClient(HttpConfigClient):
    """An 8088 client whose /matrix read raises the way one of our own parsing
    bugs would — a TypeError, which is neither an ``httpx.HTTPError`` nor the
    control protocol's error type."""

    @staticmethod
    async def get_matrix() -> MatrixForm:
        message = "unexpected fault: our bug, not the daemon's"
        raise TypeError(message)


@pytest.fixture
async def faulting_matrix(
    live_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> AsyncIterator[tuple[ConnectionManager, FaultingMatrixClient]]:
    """A manager on a HEALTHY 4321 fake whose 8088 lane raises an unexpected
    fault. Built by hand rather than from ``start_manager``: that fixture builds
    its own client and waits for a completed poll, which a client that always
    raises never delivers."""
    client = FaultingMatrixClient("127.0.0.1", http_daemon["_port"], "u", "p")
    manager = ConnectionManager(
        Config(
            hqp_host="127.0.0.1",
            hqp_control_port=live_daemon_port,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        ),
        client,
        VirtualClock(),
    )
    yield manager, client
    await manager.aclose()
    await client.aclose()


async def test_an_unexpected_fault_propagates_out_of_the_form_refresh(
    faulting_matrix: tuple[ConnectionManager, FaultingMatrixClient],
) -> None:
    manager, _client = faulting_matrix
    with pytest.raises(TypeError):
        await forms.refresh(manager)


@pytest.mark.parametrize(("form", "expected"), [("matrix", NO_ERROR), ("config", ERROR_RECORDED)])
async def test_an_unexpected_matrix_fault_is_not_recorded_but_a_refused_configs_error_is(
    faulting_matrix: tuple[ConnectionManager, FaultingMatrixClient],
    http_daemon: dict[str, Any],
    form: str,
    expected: str,
) -> None:
    # recording our own bug as the matrix form's error would hide it behind a
    # message that reads like the daemon refusing — unlike an ordinary refused
    # route, which the SAME refresh call records plainly. /config is read
    # before /matrix (the table above), so its refusal is already recorded by
    # the time the matrix client's own TypeError aborts the pass.
    manager, _client = faulting_matrix
    http_daemon["_fail_paths"] = ["/config"]
    with contextlib.suppress(TypeError):
        await forms.refresh(manager)
    assert _recorded_error(manager, form) == expected


async def test_a_refresh_reports_refused_when_the_daemon_answers_401(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_refuse_auth"] = True
    report = await forms.refresh(http_manager)
    assert report.outcome is FormsOutcome.REFUSED
