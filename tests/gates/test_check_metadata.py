"""The gate that proves the shipped metadata covers what the engine enumerates.

``scripts/gates/check_metadata.py`` loads a data directory the way the app does
and lists every problem it finds: an engine-enumerated modulator or filter with
no row behind it, or a data file the loader cannot read. The observable contract
is the list of lines ``check`` hands back (empty means pass, each line names one
problem) and the exit status ``main`` derives from it.

Every case runs against a copy of the invented fixture under
``tests/support/fixtures/metadata_min`` (never the shipped ``data/``, never the
fixture in place), mutated in ``tmp_path``. Assertions pin only names the test
itself wrote into that copy and the exit codes; the gate's wording is never
asserted (docs/testing.md rule 9).

The seams are ``check`` and ``main``.
"""

import importlib.util
import json
import shutil
from pathlib import Path
from types import ModuleType

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_metadata.py"

#: The invented metadata directory every case copies before touching.
FIXTURE_DIR = REPO_ROOT / "tests" / "support" / "fixtures" / "metadata_min"

#: The one filter key the fixture's filters.json carries.
BASE_FILTER = "fixture-base-lp"

#: Its two-stage variant, which the join resolves by stripping ``-2s``.
TWO_STAGE_FILTER = f"{BASE_FILTER}-2s"

#: A filter name nothing in the fixture covers.
ABSENT_FILTER = "fixture-ghost-filter"

#: A modulator name nothing in the fixture's shapers.json covers.
ABSENT_MODULATOR = "fixture-ghost-modulator"

#: The data file the third case breaks.
PLAIN_NAMES_FILE = "filter-plain-names.json"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_metadata_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def copy_fixture(tmp_path: Path) -> Path:
    """A private copy of ``metadata_min`` the case may mutate freely."""
    copy = tmp_path / "metadata_min"
    shutil.copytree(FIXTURE_DIR, copy)
    return copy


def add_enum_names(data_dir: Path, key: str, names: list[str]) -> None:
    """Append ``names`` to one list in the copy's ``engine-enums.json``."""
    path = data_dir / "engine-enums.json"
    enums = json.loads(path.read_text(encoding="utf-8"))
    enums[key] = enums[key] + [{"name": name} for name in names]
    path.write_text(json.dumps(enums), encoding="utf-8")


def uncovered_modulator_copy(tmp_path: Path) -> Path:
    """The line-1 copy: one enumerated SDM modulator with no shapers.json row."""
    copy = copy_fixture(tmp_path)
    add_enum_names(copy, "shapers_sdm", [ABSENT_MODULATOR])
    return copy


# --- check ---------------------------------------------------------------------


def test_an_enumerated_modulator_missing_from_shapers_is_the_only_thing_reported(tmp_path: Path) -> None:
    """Every line names the uncovered modulator, so covered names produce no line."""
    lines = GATE.check(uncovered_modulator_copy(tmp_path))
    assert lines and all(ABSENT_MODULATOR in line for line in lines)


def test_a_2s_filter_name_counts_as_covered_while_an_unknown_filter_is_reported(tmp_path: Path) -> None:
    """Coverage goes through the filter join, so the ``-2s`` variant of a known base is not a problem."""
    copy = copy_fixture(tmp_path)
    add_enum_names(copy, "filters_sdm", [TWO_STAGE_FILTER, ABSENT_FILTER])
    lines = GATE.check(copy)
    assert [line for line in lines if ABSENT_FILTER in line] and not [
        line for line in lines if TWO_STAGE_FILTER in line
    ]


def test_a_plain_names_file_without_its_key_is_reported_by_filename_not_raised(tmp_path: Path) -> None:
    copy = copy_fixture(tmp_path)
    (copy / PLAIN_NAMES_FILE).write_text("{}", encoding="utf-8")
    assert [line for line in GATE.check(copy) if PLAIN_NAMES_FILE in line]


# --- main ----------------------------------------------------------------------


def test_main_exits_nonzero_on_a_problem_and_zero_on_the_clean_fixture(tmp_path: Path) -> None:
    assert (GATE.main([str(uncovered_modulator_copy(tmp_path))]), GATE.main([str(FIXTURE_DIR)])) == (1, 0)
