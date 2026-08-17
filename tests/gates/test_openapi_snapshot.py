"""The gate that pins the REST surface to a committed OpenAPI snapshot.

``scripts/gates/check_openapi.py`` renders the live app's OpenAPI document as
stable JSON text and compares it with ``docs/openapi.json``. A route added,
removed, or reshaped without regenerating the snapshot is what the gate is for,
so the observable contract is four things a caller can see: the text ``render``
produces, the diff lines ``compare`` hands back, the int ``check`` returns
alongside what it puts on stdout, and what ``main`` does with the committed
snapshot path.

Everything up to and including the write path is pure text and disk work, so
those cases use synthetic mappings and ``tmp_path`` and never build the app.
Only the three cases that are *about* the live surface pay for a real
``current_spec()``. Nothing here reads the gate's internals.

The seams are ``render``, ``compare``, ``check``, ``main``, ``current_spec``
and the module-level ``SNAPSHOT`` path.
"""

import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_openapi.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_openapi_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()

#: A mapping whose keys are out of order at both levels, so the rendered text
#: says whether ordering is imposed all the way down.
UNSORTED = {"b": 1, "a": {"z": 1, "y": 2}}

#: The same mapping built in a different insertion order.
UNSORTED_OTHER_ORDER = {"a": {"y": 2, "z": 1}, "b": 1}

#: Two texts that differ in one line, for the diff cases.
COMMITTED = '{\n  "a": 1\n}\n'
CURRENT = '{\n  "a": 2\n}\n'

#: The instruction a failing run has to carry, so a reader knows how to accept
#: the new surface without going looking for the command.
ACCEPT_INSTRUCTION = "scripts/gates/check_openapi.py --write"

#: The route that mounts only when the audit log is enabled (architecture §
#: "No UI, deliberately": ``GET /api/audit`` exists only while the var is set).
AUDIT_ROUTE = "/api/audit"


def key_order(text: str) -> list[str]:
    """Every JSON object key in the order the rendered text lists them."""
    keys = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('"') and '":' in stripped:
            keys.append(stripped.split('"')[1])
    return keys


def indent_of(text: str, key: str) -> list[int]:
    """The leading-space count of every line that carries ``key``."""
    needle = f'"{key}":'
    return [len(line) - len(line.lstrip(" ")) for line in text.splitlines() if line.strip().startswith(needle)]


def added_lines(diff: list[str]) -> list[str]:
    """The ``+`` body lines of a unified diff, without the ``+++`` header."""
    return [line for line in diff if line.startswith("+") and not line.startswith("+++")]


def header_lines(diff: list[str], marker: str) -> list[str]:
    """The unified-diff header lines that open with ``marker``."""
    return [line for line in diff if line.startswith(marker)]


# --- render --------------------------------------------------------------------


def test_render_sorts_keys_at_every_nesting_level() -> None:
    assert key_order(GATE.render(UNSORTED)) == ["a", "y", "z", "b"]


def test_render_indents_each_nesting_level_by_two_spaces() -> None:
    """A key one level down sits four spaces in, so the step is two."""
    assert (indent_of(GATE.render(UNSORTED), "a"), indent_of(GATE.render(UNSORTED), "y")) == ([2], [4])


def test_render_ends_with_exactly_one_trailing_newline() -> None:
    """A second newline would leave the last chunk bare, so this pins both halves."""
    assert GATE.render(UNSORTED).splitlines(keepends=True)[-1] == "}\n"


def test_render_called_twice_returns_identical_text() -> None:
    assert GATE.render(UNSORTED) == GATE.render(UNSORTED)


def test_render_ignores_the_insertion_order_of_the_mapping_it_is_handed() -> None:
    """Two equal mappings built in different orders are one snapshot, not two."""
    assert GATE.render(UNSORTED) == GATE.render(UNSORTED_OTHER_ORDER)


# --- compare -------------------------------------------------------------------


def test_compare_returns_no_lines_when_the_two_texts_are_equal() -> None:
    assert GATE.compare(COMMITTED, COMMITTED) == []


def test_compare_labels_the_committed_side_with_the_snapshot_path() -> None:
    assert [line for line in header_lines(GATE.compare(COMMITTED, CURRENT), "---") if "docs/openapi.json" in line] != []


def test_compare_labels_the_other_side_current() -> None:
    assert [line for line in header_lines(GATE.compare(COMMITTED, CURRENT), "+++") if "current" in line] != []


def test_compare_shows_the_line_the_current_surface_added() -> None:
    assert [line for line in added_lines(GATE.compare(COMMITTED, CURRENT)) if '"a": 2' in line] != []


# --- check: the comparing half -------------------------------------------------


def test_a_snapshot_matching_the_current_text_passes(tmp_path: Path) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(CURRENT, encoding="utf-8")
    assert GATE.check(snapshot, CURRENT) == 0


def test_a_matching_snapshot_says_so_on_stdout(tmp_path: Path, capsys: Any) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(CURRENT, encoding="utf-8")
    GATE.check(snapshot, CURRENT)
    assert capsys.readouterr().out.strip() != ""


def test_a_passing_run_does_not_tell_anyone_to_regenerate(tmp_path: Path, capsys: Any) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(CURRENT, encoding="utf-8")
    GATE.check(snapshot, CURRENT)
    assert ACCEPT_INSTRUCTION not in capsys.readouterr().out


def test_a_snapshot_differing_from_the_current_text_fails(tmp_path: Path) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(COMMITTED, encoding="utf-8")
    assert GATE.check(snapshot, CURRENT) == 1


def test_a_differing_snapshot_prints_the_diff(tmp_path: Path, capsys: Any) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(COMMITTED, encoding="utf-8")
    GATE.check(snapshot, CURRENT)
    assert added_lines(capsys.readouterr().out.splitlines()) != []


def test_a_differing_snapshot_tells_the_reader_how_to_accept_the_new_surface(tmp_path: Path, capsys: Any) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(COMMITTED, encoding="utf-8")
    GATE.check(snapshot, CURRENT)
    assert ACCEPT_INSTRUCTION in capsys.readouterr().out


def test_a_missing_snapshot_fails(tmp_path: Path) -> None:
    assert GATE.check(tmp_path / "openapi.json", CURRENT) == 1


def test_a_missing_snapshot_tells_the_reader_how_to_accept_the_new_surface(tmp_path: Path, capsys: Any) -> None:
    GATE.check(tmp_path / "openapi.json", CURRENT)
    assert ACCEPT_INSTRUCTION in capsys.readouterr().out


# --- check: the writing half ---------------------------------------------------


def test_writing_a_snapshot_that_does_not_exist_yet_passes(tmp_path: Path) -> None:
    assert GATE.check(tmp_path / "openapi.json", CURRENT, write=True) == 0


def test_writing_a_snapshot_that_does_not_exist_yet_leaves_the_current_text_on_disk(tmp_path: Path) -> None:
    snapshot = tmp_path / "openapi.json"
    GATE.check(snapshot, CURRENT, write=True)
    assert snapshot.read_text(encoding="utf-8") == CURRENT


def test_writing_over_a_differing_snapshot_passes(tmp_path: Path) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(COMMITTED, encoding="utf-8")
    assert GATE.check(snapshot, CURRENT, write=True) == 0


def test_writing_over_a_differing_snapshot_leaves_exactly_the_current_text(tmp_path: Path) -> None:
    """Accepting a new surface replaces the old one whole, with nothing appended."""
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(COMMITTED, encoding="utf-8")
    GATE.check(snapshot, CURRENT, write=True)
    assert snapshot.read_text(encoding="utf-8") == CURRENT


def test_writing_over_a_matching_snapshot_passes(tmp_path: Path) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(CURRENT, encoding="utf-8")
    assert GATE.check(snapshot, CURRENT, write=True) == 0


# --- main ----------------------------------------------------------------------


def test_the_write_flag_regenerates_the_committed_snapshot_from_the_live_surface(
    tmp_path: Path, monkeypatch: Any
) -> None:
    snapshot = tmp_path / "openapi.json"
    monkeypatch.setattr(GATE, "SNAPSHOT", snapshot)
    GATE.main(["--write"])
    assert snapshot.read_text(encoding="utf-8") == GATE.current_spec()


def test_a_freshly_regenerated_snapshot_then_compares_clean(tmp_path: Path, monkeypatch: Any) -> None:
    snapshot = tmp_path / "openapi.json"
    monkeypatch.setattr(GATE, "SNAPSHOT", snapshot)
    GATE.main(["--write"])
    assert GATE.main([]) == 0


def test_a_committed_snapshot_that_no_longer_matches_the_surface_fails(tmp_path: Path, monkeypatch: Any) -> None:
    snapshot = tmp_path / "openapi.json"
    snapshot.write_text(COMMITTED, encoding="utf-8")
    monkeypatch.setattr(GATE, "SNAPSHOT", snapshot)
    assert GATE.main([]) == 1


# --- the live surface ----------------------------------------------------------


def test_the_rendered_surface_carries_the_audit_route_with_the_audit_log_disabled(monkeypatch: Any) -> None:
    """The audit router mounts on ``debug_log``; the snapshot must not care."""
    monkeypatch.delenv("HQPTUNER_DEBUG_LOG", raising=False)
    assert AUDIT_ROUTE in json.loads(GATE.current_spec())["paths"]


def test_the_surface_renders_with_no_hqplayerd_credentials_in_the_environment(monkeypatch: Any) -> None:
    monkeypatch.delenv("HQPTUNER_HQP_USERNAME", raising=False)
    monkeypatch.delenv("HQPTUNER_HQP_PASSWORD", raising=False)
    assert json.loads(GATE.current_spec())["paths"] != {}


def test_the_rendered_surface_is_already_in_the_stable_rendering(monkeypatch: Any) -> None:
    """Re-rendering the parsed document changes nothing, so the file on disk is canonical."""
    monkeypatch.delenv("HQPTUNER_DEBUG_LOG", raising=False)
    current = GATE.current_spec()
    assert GATE.render(json.loads(current)) == current


def test_the_snapshot_path_is_the_committed_docs_file() -> None:
    assert Path(GATE.SNAPSHOT).as_posix().endswith("docs/openapi.json")
