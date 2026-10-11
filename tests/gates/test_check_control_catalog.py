"""The gate that proves every catalog control has somewhere to write.

``scripts/gates/check_control_catalog.py`` joins the control catalog against
the ``/config`` form fields the restore lane can locate. Its write-path check
hands back one problem line per catalog entry that has nowhere to persist; an
empty list means every entry has its write path.

A control on the ``speakers`` lane is written by the speakers form's own POST,
not by a ``/config`` field, so it has its write path without a ``/config``
target. A control on the ``http`` lane still needs one.

The seam is ``check_write_path(schema, targets) -> list[str]``. Every catalog
entry and every target is invented here; assertions pin only keys this file
wrote.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_control_catalog.py"

#: The one ``/config`` form field the invented restore lane can locate.
CONFIG_TARGET = "fixture_located_field"

#: The write targets every case hands the gate.
TARGETS = {CONFIG_TARGET}

#: A speakers-form control's catalog key.
SPEAKERS_KEY = "fixture_speakers_engage"

#: The speakers form's own field name, which no ``/config`` target carries.
SPEAKERS_FORM_FIELD = "fixture_speakers_form_field"

#: An http-lane control whose key and field name a form field no target carries.
UNTARGETED_HTTP_KEY = "fixture_unlocated_field"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_control_catalog_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def _entry(lane: str, **extra: str) -> dict[str, Any]:
    return {"group": "output", "widget": "dropdown", "lane": lane, **extra}


@pytest.mark.parametrize(
    "entry",
    [
        pytest.param(_entry("speakers", field=SPEAKERS_FORM_FIELD), id="form-field-not-a-config-target"),
        pytest.param(_entry("speakers"), id="no-field"),
    ],
)
def test_a_speakers_lane_entry_without_a_config_target_is_not_refused(entry: dict[str, Any]) -> None:
    """Beside a refused http-lane entry, the speakers entry adds no problem line of its own."""
    schema = {SPEAKERS_KEY: entry, UNTARGETED_HTTP_KEY: _entry("http", field=UNTARGETED_HTTP_KEY)}
    problems = GATE.check_write_path(schema, TARGETS)
    assert [UNTARGETED_HTTP_KEY in line for line in problems] == [True]


def test_an_http_lane_entry_without_a_config_target_is_still_refused() -> None:
    """An http-lane field the restore lane cannot locate is one problem line naming it."""
    schema = {UNTARGETED_HTTP_KEY: _entry("http", field=UNTARGETED_HTTP_KEY)}
    problems = GATE.check_write_path(schema, TARGETS)
    assert [UNTARGETED_HTTP_KEY in line for line in problems] == [True]
