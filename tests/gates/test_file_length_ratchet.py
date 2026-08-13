"""The ratchet the file-length gate gained on top of its hard caps.

``scripts/gates/check_file_length.py`` already refused a source file over 500
lines and a file under ``tests/`` over 800. The ratchet sits underneath those
caps: a source file past ``WATCH_LINE`` is only tolerated by name, through an
entry in the module's ``ALLOWANCE`` mapping, and the entry has to state the
file's length exactly. Growing past the allowance fails; shrinking under it
fails too, so the number only ever comes down. An allowance nobody needs any
more — the file is gone from disk, or has dropped back to the watch line — is
drift, the same way a stale exemption is in the other gates. Staleness is
judged against the filesystem rather than against the paths handed over, so a
partial commit that touches one file is not told every other entry is stale.

Test suites sit outside the ratchet entirely. They keep the 800-line cap and
never carry an allowance, because the one-assertion-per-test policy inflates a
flat list of cases without adding coupling for a split to surface.

Each case writes real files of a known length into ``tmp_path``, changes into
it so the paths handed to the gate are repo-relative the way the Makefile
passes them, and injects its own allowance mapping. Observable contract is the
pair the script offers a caller: the int exit code, and what lands on stdout.
Nothing here reads the gate's internals.

The seam is ``check(paths, allowance=None) -> int``.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_file_length.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_file_length_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check


def write_source(tmp_path: Path, relpath: str, lines: int) -> str:
    """Write a file of exactly ``lines`` newline-terminated lines; return its relative path."""
    path = tmp_path / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"x = {n}\n" for n in range(lines)), encoding="utf-8")
    return relpath


def line_naming(out: str, path: str) -> str:
    """The single stdout line that names ``path``."""
    lines = [line for line in out.splitlines() if path in line]
    assert len(lines) == 1, f"expected exactly one line naming {path}, got {lines!r}"
    return lines[0]


def test_a_short_source_file_with_no_allowance_entry_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/small.py", 120)
    assert CHECK([path], {}) == 0


def test_a_source_file_exactly_at_the_watch_line_passes_with_no_allowance_entry(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """The watch line is a threshold to exceed, not to reach: 400 is still quiet."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/borderline.py", 400)
    assert CHECK([path], {}) == 0


def test_a_source_file_over_the_watch_line_with_no_allowance_entry_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/creeping.py", 401)
    assert CHECK([path], {}) == 1


def test_a_source_file_over_the_watch_line_with_no_allowance_entry_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/creeping.py", 401)
    CHECK([path], {})
    assert "hqptuner/creeping.py" in capsys.readouterr().out


def test_a_source_file_matching_its_allowance_exactly_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/known_long.py", 437)
    assert CHECK([path], {path: 437}) == 0


def test_a_source_file_matching_its_allowance_exactly_is_not_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    """An allowance is silent — it permits the length rather than warning about it."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/known_long.py", 437)
    CHECK([path], {path: 437})
    assert "hqptuner/known_long.py" not in capsys.readouterr().out


def test_a_source_file_longer_than_its_allowance_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/grown.py", 452)
    assert CHECK([path], {path: 437}) == 1


def test_a_source_file_longer_than_its_allowance_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/grown.py", 452)
    CHECK([path], {path: 437})
    assert "hqptuner/grown.py" in capsys.readouterr().out


def test_a_source_file_shorter_than_its_allowance_fails(tmp_path: Path, monkeypatch: Any) -> None:
    """The ratchet only turns one way: an allowance the file has outgrown downwards is owed a rewrite."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/shrunk.py", 421)
    assert CHECK([path], {path: 437}) == 1


def test_a_source_file_shorter_than_its_allowance_is_told_the_lower_number(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/shrunk.py", 421)
    CHECK([path], {path: 437})
    assert "421" in line_naming(capsys.readouterr().out, "hqptuner/shrunk.py")


def test_an_allowance_whose_path_is_not_on_disk_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/present.py", 120)
    assert CHECK([path], {"hqptuner/deleted_last_year.py": 437}) == 1


def test_an_allowance_whose_path_is_not_on_disk_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/present.py", 120)
    CHECK([path], {"hqptuner/deleted_last_year.py": 437})
    assert "hqptuner/deleted_last_year.py" in capsys.readouterr().out


def test_a_stale_allowance_for_a_file_not_passed_on_argv_still_fails(tmp_path: Path, monkeypatch: Any) -> None:
    """Staleness is judged against the filesystem, so which subset was handed over does not hide it."""
    monkeypatch.chdir(tmp_path)
    write_source(tmp_path, "hqptuner/untouched.py", 180)
    committed = write_source(tmp_path, "hqptuner/committed.py", 90)
    assert CHECK([committed], {"hqptuner/untouched.py": 437}) == 1


def test_a_live_allowance_for_a_file_not_passed_on_argv_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """A partial commit reads the untouched file from disk and finds its entry still true."""
    monkeypatch.chdir(tmp_path)
    write_source(tmp_path, "hqptuner/untouched.py", 437)
    committed = write_source(tmp_path, "hqptuner/committed.py", 90)
    assert CHECK([committed], {"hqptuner/untouched.py": 437}) == 0


def test_an_allowance_for_a_file_back_under_the_watch_line_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    """Once a file is quiet again its entry is dead weight, not a lower number to write down."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/reformed.py", 180)
    assert CHECK([path], {path: 437}) == 1


def test_an_allowance_for_a_file_exactly_at_the_watch_line_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    """At the watch line the ratchet has nothing left to hold, so the entry has to go."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/reformed.py", 400)
    assert CHECK([path], {path: 400}) == 1


def test_an_allowance_for_a_file_back_under_the_watch_line_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/reformed.py", 180)
    CHECK([path], {path: 437})
    assert "hqptuner/reformed.py" in capsys.readouterr().out


def test_a_source_file_over_the_hard_cap_fails_even_with_an_allowance_permitting_it(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """The allowance table buys time under the cap; it cannot sell permission past it."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/enormous.py", 501)
    assert CHECK([path], {path: 501}) == 1


def test_a_source_file_over_the_hard_cap_fails_with_no_allowance_entry(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/enormous.py", 501)
    assert CHECK([path], {}) == 1


def test_one_offending_file_among_compliant_ones_fails_the_gate(tmp_path: Path, monkeypatch: Any) -> None:
    """The question is asked of every path given, not only the first."""
    monkeypatch.chdir(tmp_path)
    paths = [
        write_source(tmp_path, "hqptuner/one.py", 90),
        write_source(tmp_path, "hqptuner/two.py", 120),
        write_source(tmp_path, "hqptuner/creeping.py", 460),
        write_source(tmp_path, "hqptuner/three.py", 44),
    ]
    assert CHECK(paths, {}) == 1


def test_a_test_file_over_the_watch_line_passes_with_no_allowance_entry(tmp_path: Path, monkeypatch: Any) -> None:
    """Suites sit outside the ratchet: a flat list of cases has no missing abstraction to surface."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "tests/test_many_cases.py", 640)
    assert CHECK([path], {}) == 0


def test_a_test_file_under_the_eight_hundred_line_cap_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "tests/test_many_cases.py", 799)
    assert CHECK([path], {}) == 0


def test_a_test_file_over_the_eight_hundred_line_cap_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "tests/test_sprawling.py", 801)
    assert CHECK([path], {}) == 1


def test_an_allowance_naming_a_test_file_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    """The table must not carry entries the ratchet will never enforce."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "tests/test_many_cases.py", 640)
    assert CHECK([path], {path: 640}) == 1


def test_an_allowance_naming_a_test_file_is_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "tests/test_many_cases.py", 640)
    CHECK([path], {path: 640})
    assert "tests/test_many_cases.py" in capsys.readouterr().out


@pytest.mark.parametrize("expected", ["hqptuner/first.py", "hqptuner/second.py"])
def test_every_offending_file_is_reported_not_only_the_first(
    tmp_path: Path, monkeypatch: Any, capsys: Any, expected: str
) -> None:
    monkeypatch.chdir(tmp_path)
    paths = [
        write_source(tmp_path, "hqptuner/first.py", 455),
        write_source(tmp_path, "hqptuner/second.py", 470),
        write_source(tmp_path, "hqptuner/fine.py", 30),
    ]
    CHECK(paths, {})
    assert expected in capsys.readouterr().out


def test_a_compliant_file_beside_an_offender_is_not_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    paths = [
        write_source(tmp_path, "hqptuner/creeping.py", 455),
        write_source(tmp_path, "hqptuner/fine.py", 30),
    ]
    CHECK(paths, {})
    assert "hqptuner/fine.py" not in capsys.readouterr().out
