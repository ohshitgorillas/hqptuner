"""Which faults the connect/poll path is allowed to swallow (docs/testing.md).

An expected wire or state fault — a route refusing, a stored preset the store
will not read — keeps the quiet-retry behaviour: it is recorded where it
happened and costs nothing else. Every fault here is injected at the wire (a 503
on a named 8088 route) or through constructor inputs (a preset directory another
HQPTuner version stamped), never by patching the manager.

**Uncovered by design.** The other half of the contract — an UNEXPECTED fault,
one that is neither an HTTP/transport error nor the control protocol's own error
type, the kind our own parsing bug would raise — has no test here, because no
body either fake can serve produces such a fault. ``parse_config_form``,
``parse_matrix_form`` and ``parse_speakers_form`` all return normally on an empty
body, on a non-form page, and on non-numeric values and constraints in a
``type="number"`` input; the control lane likewise polls clean against a State
carrying a non-numeric volume, mode or filter index, and against a non-numeric
``RatesItem``. Manufacturing the fault by patching the parser or the manager
would be testing our own mock (docs/testing.md rules 3 and 4), so the gap is
recorded rather than faked.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from conftest import ManagerFactory, StartManager
from narrow import present

from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes import httpforms

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


@pytest.mark.parametrize("form", sorted(FORMS))
async def test_a_refusing_form_route_records_that_forms_error(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], form: str
) -> None:
    http_daemon["_fail_paths"] = [f"/{form}"]
    await httpforms.refresh(http_manager)
    assert getattr(http_manager, f"{form}_error") is not None


@pytest.mark.parametrize(("broken", "intact"), SURVIVORS)
async def test_a_refusing_form_route_still_refreshes_the_other_forms(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], broken: str, intact: str
) -> None:
    http_daemon["_fail_paths"] = [f"/{broken}"]
    await httpforms.refresh(http_manager)
    assert FORMS[intact](present(getattr(http_manager, f"{intact}_form")))


async def test_a_refusing_form_route_leaves_the_last_good_snapshot_in_place(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    # a good pass first, then the route refuses while the daemon's own state
    # moves: the stale-but-real snapshot must survive, not be cleared
    await httpforms.refresh(http_manager)
    http_daemon["matrix_active"] = "Mch-to-Stereo mixdown"
    http_daemon["_fail_paths"] = ["/matrix"]
    await httpforms.refresh(http_manager)
    assert present(http_manager.matrix_form)["active"] == "[Default]"


# --- connect-time faults on the best-effort lanes -----------------------------
# The 8088 lane and the preset migration both ride alongside the 4321 connect.
# Neither may undo it, and `start_manager` has already waited for the manager to
# settle — so what these pin is the absence of a recorded outage, which settling
# does not itself require.


async def test_a_refusing_backup_route_records_no_outage(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    # the 8088 file-config read fails; the 4321 connect it rode alongside stands
    http_daemon["_fail_paths"] = ["/backup/settings.zip"]
    manager = await start_manager(http_daemon["_port"])
    assert manager.unreachable_since is None


async def test_a_refusing_backup_route_leaves_file_config_unset(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_fail_paths"] = ["/backup/settings.zip"]
    manager = await start_manager(http_daemon["_port"])
    assert manager.file_config is None


def _newer_store(tmp_path: Path) -> Path:
    """A preset directory stamped by a schema no this-version store will read —
    every access raises, so the connect-time migration into it cannot succeed.
    Written by hand for the same reason a wire test writes a frame by hand: the
    situation under test is one a DIFFERENT HQPTuner version created."""
    presets = tmp_path / "newer-presets"
    presets.mkdir()
    (presets / "store.json").write_text(json.dumps({"schema": 99}))
    return presets


async def test_a_store_stamped_by_a_newer_hqptuner_records_no_outage(
    start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager = await start_manager(http_daemon["_port"], preset_dir=_newer_store(tmp_path))
    assert manager.unreachable_since is None


async def test_a_store_stamped_by_a_newer_hqptuner_imports_nothing(
    start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the inverse of the healthy migration (test_manager_connect_load.py): the
    # daemon's own snapshots must NOT land in a store that refused. store.json is
    # the store's on-disk layout contract (tests/presets/test_presetstore.py);
    # anything beside it would be an imported payload.
    presets = _newer_store(tmp_path)
    await start_manager(http_daemon["_port"], preset_dir=presets)
    assert [p.name for p in presets.rglob("*") if p.name != "store.json"] == []


# --- baseline: a healthy pass records nothing ---------------------------------


@pytest.mark.parametrize("form", sorted(FORMS))
async def test_a_healthy_pass_records_no_error_for_any_form(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], form: str
) -> None:
    manager = http_manager_factory(http_daemon)
    await httpforms.refresh(manager)
    assert getattr(manager, f"{form}_error") is None
