"""The gate that proves every drawer control names a declared home.

``scripts/gates/check_control_catalog.py`` also reads the stage drawers under
``components/faceplate/drawers/`` and the settings drawers under
``components/faceplate/settings/`` (paths under ``hqptuner/static/``). A row
(by its ``key``), a field (by its ``id``) or a choice (by its own ``id``) whose
id is neither a key of the engine catalog nor a key of ``local`` in
``store/schema/local.js`` is one problem line naming that id. A drawer's own
id, a tab's id and a choice line's value are not control ids.

The seam is ``check_drawer_homes(modules, catalog, local) -> list[str]``:
``modules`` maps each drawer module's path under ``hqptuner/static/`` to its
exports as JSON-shaped data, ``catalog`` and ``local`` are the two homes' keys.
Every module, drawer and id is invented here; assertions pin only ids this
file wrote.
"""

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_control_catalog.py"

#: A stage drawer module's path under ``hqptuner/static/``.
STAGE_MODULE = "components/faceplate/drawers/fixture-stage.js"

#: A settings drawer module's path under ``hqptuner/static/``.
SETTINGS_MODULE = "components/faceplate/settings/fixture-settings.js"

#: The keys of the invented engine catalog.
CATALOG_KEY = "fixture_catalog_control"
CATALOG = {CATALOG_KEY}

#: The keys of the invented ``local`` declaration.
LOCAL_KEY = "fixture_local_pref"
LOCAL = {LOCAL_KEY}

#: A builder of one drawer body item naming the id it is given.
Item = Callable[[str], dict[str, Any]]

#: An id declared in neither home.
STRAY_ID = "fixture_undeclared_control"

#: Option values of a choice's lines, which are not control ids.
LINE_VALUES = ("fixture_line_a", "fixture_line_b")


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_control_catalog_drawers_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def _row(key: str) -> dict[str, Any]:
    return {"row": {"key": key}}


def _field(control_id: str) -> dict[str, Any]:
    return {"field": {"id": control_id, "label": control_id}}


def _choice(control_id: str) -> dict[str, Any]:
    lines = [{"v": value, "label": value} for value in LINE_VALUES]
    return {"choice": {"id": control_id, "label": control_id, "lines": lines}}


def _modules(path: str, *body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """One drawer module at ``path`` exporting one drawer of one tab holding ``body``."""
    drawer = {
        "id": "fixture_drawer",
        "title": "fixture_drawer",
        "aria": "fixture_drawer",
        "tabs": [{"id": "fixture_tab", "label": "fixture_tab", "body": list(body)}],
    }
    return {path: {"FIXTURE_DRAWER": drawer}}


@pytest.mark.parametrize("path", [STAGE_MODULE, SETTINGS_MODULE], ids=["stage-drawer", "settings-drawer"])
@pytest.mark.parametrize("item", [_row, _field, _choice], ids=["row", "field", "choice"])
def test_an_item_whose_id_names_neither_home_is_the_one_problem_reported(path: str, item: Item) -> None:
    """A row, field or choice id outside the catalog and ``local`` is one problem line naming it."""
    problems = GATE.check_drawer_homes(_modules(path, item(STRAY_ID)), CATALOG, LOCAL)
    assert [STRAY_ID in line for line in problems] == [True]


@pytest.mark.parametrize("item", [_row, _field, _choice], ids=["row", "field", "choice"])
@pytest.mark.parametrize("home_key", [CATALOG_KEY, LOCAL_KEY], ids=["catalog-key", "declared-local"])
def test_an_item_whose_id_names_a_home_is_not_reported(home_key: str, item: Item) -> None:
    """Beside one stray row, an item naming a catalog key or a declared local adds no problem line."""
    modules = _modules(STAGE_MODULE, _row(STRAY_ID), item(home_key))
    problems = GATE.check_drawer_homes(modules, CATALOG, LOCAL)
    assert [STRAY_ID in line for line in problems] == [True]
