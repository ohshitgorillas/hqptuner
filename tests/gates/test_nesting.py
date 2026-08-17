"""The gate that refuses deeply nested functions.

``scripts/gates/check_nesting.py`` takes Python file paths on argv and refuses a
tree where any function nests blocks deeper than ``MAX_DEPTH`` (4). Python's own
complexity tools are cyclomatic — a long, deeply nested but branch-cheap
function scores fine under xenon and under ruff ``C901`` alike — so this gate is
the Python peer of ``eslint.config.js``'s ``max-depth: 4``.

Depth is counted the way eslint counts it: the function body is not itself a
level, so a function whose body opens one ``if`` nests one deep, and five
statements nested one inside the next is the first violation. A function over
the limit says so in one line, ``path:line: name() nests 5 deep (max 4)``, where
the line is the line of the ``def``. Sites that are there on purpose say why in
``EXEMPT``, keyed ``relative/path.py::qualified.name``, audited against the
filesystem rather than against the paths handed over so a partial commit is not
told every other entry is stale and a stale entry cannot hide by staying out of
the run.

Each case writes real source into ``tmp_path``, changes into it so the paths
handed to the gate are repo-relative the way the Makefile passes them, and
injects its own exemption mapping. Observable contract is what the script offers
a caller: the tuples out of ``depths``, the int exit code out of ``check``, and
what lands on stdout. Nothing here reads the gate's internals.

The seams are ``depths(source) -> list[tuple[str, int, int]]`` and
``check(names, exempt=None) -> int``.
"""

import importlib.util
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

#: The checkout this test file sits in, which is the tree the shipped exemption
#: mapping describes.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_nesting.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_nesting_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check
DEPTHS: Callable[[str], list[tuple[str, int, int]]] = GATE.depths
SHIPPED_EXEMPT: dict[str, str] = GATE.EXEMPT

#: Each block-opening construct as (opening lines, how far its body is indented
#: past the opener, lines that close it off). ``match`` opens with a ``case``
#: arm, which puts its body two indents in; ``try`` needs a handler after it.
BLOCKS: dict[str, tuple[list[str], int, list[str]]] = {
    "if": (["if cond:"], 1, []),
    "for": (["for _item in items:"], 1, []),
    "while": (["while cond:"], 1, []),
    "with": (["with ctx:"], 1, []),
    "try": (["try:"], 1, ["except Exception:", "    pass"]),
    "match": (["match value:", "    case _:"], 2, []),
    "async for": (["async for _item in items:"], 1, []),
    "async with": (["async with ctx:"], 1, []),
}

#: The constructs that only make sense inside an ``async def``.
ASYNC_BLOCKS = ["async for", "async with"]


def nest(kind: str, depth: int, indent: int = 1) -> list[str]:
    """Lines for ``depth`` copies of ``kind`` nested one inside the next."""
    opener, step, trailer = BLOCKS[kind]
    pad = "    " * indent
    lines = [pad + line for line in opener]
    if depth > 1:
        lines += nest(kind, depth - 1, indent + step)
    else:
        lines.append("    " * (indent + step) + "pass")
    return lines + [pad + line for line in trailer]


def function(kind: str, depth: int, name: str = "f") -> str:
    """A module whose one function nests ``depth`` copies of ``kind``, ``def`` on line 1."""
    header = f"async def {name}():" if kind in ASYNC_BLOCKS else f"def {name}():"
    return "\n".join([header, *nest(kind, depth)]) + "\n"


def write_source(tmp_path: Path, relpath: str, source: str) -> str:
    """Write ``source`` at ``relpath`` under ``tmp_path``; return the relative path."""
    path = tmp_path / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return relpath


def line_naming(out: str, needle: str) -> str:
    """The first stdout line that names ``needle``, or ``""`` when no line does."""
    for line in out.splitlines():
        if needle in line:
            return line
    return ""


def problem_lines(out: str) -> list[str]:
    """The per-problem report lines a failing run prints, ahead of the summary.

    A failing gate prints one line per problem, then a blank line, then a summary
    line naming how many problems there were. A case about the per-problem lines
    reads the block ahead of that blank line; the summary has cases of its own.
    """
    lines = out.splitlines()
    body: list[str] = []
    for line in lines:
        if not line.strip():
            break
        body.append(line)
    return body


def summary_line(out: str) -> str:
    """The trailing summary line of a failing run, or ``""`` when there is none."""
    tail = out.splitlines()[len(problem_lines(out)) :]
    written = [line for line in tail if line.strip()]
    return written[0] if written else ""


def names(source: str) -> list[str]:
    """Every qualified function name ``depths`` finds, in the order it reports them."""
    return [name for name, _line, _depth in DEPTHS(source)]


def depth_of(source: str, name: str) -> int:
    """The deepest nesting ``depths`` reports for the function called ``name``."""
    return next(deep for found, _line, deep in DEPTHS(source) if found == name)


def def_line_of(source: str, name: str) -> int:
    """The ``def`` line ``depths`` reports for the function called ``name``."""
    return next(line for found, line, _deep in DEPTHS(source) if found == name)


def install_gate(root: Path) -> None:
    """Copy the gate script into ``root`` so a subprocess run of it sees ``root`` as the repo."""
    gate_dir = root / "scripts" / "gates"
    gate_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(GATE_PATH, gate_dir / GATE_PATH.name)


def run_gate(root: Path, *args: str) -> int:
    """Run the gate script the way the Makefile does and return its exit status."""
    # S603: the argv is this module's own literals plus paths the case just wrote.
    completed = subprocess.run(  # noqa: S603
        [sys.executable, str(Path("scripts") / "gates" / GATE_PATH.name), *args],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    return completed.returncode


def satisfy_shipped_exemptions(root: Path) -> None:
    """Copy into ``root`` the real file behind every shipped exemption entry.

    A subprocess run of the script carries ``EXEMPT`` with it and audits it against
    whatever tree it is pointed at, so a throwaway tree has to honour it before any
    other verdict the run reaches is about the case under test.
    """
    for key in SHIPPED_EXEMPT:
        relpath = key.split("::")[0]
        target = root / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO_ROOT / relpath, target)


#: A module whose only function is over the limit and whose ``def`` sits well
#: down the file, so the reported line has to be computed rather than assumed.
LATE_DEF_LINE = 13
LATE_DEF = "".join(f"# padding line {n}\n" for n in range(1, LATE_DEF_LINE)) + function("if", 5)


#: A method over the limit, so the name it is reported under carries its class.
DEEP_METHOD = """
class Tuner:
    def set_volume(self, level):
        if cond:
            for _item in items:
                while cond:
                    with ctx:
                        if level:
                            pass
"""

#: An outer function three deep whose innermost block defines a function that is
#: itself three deep. Summed naively that is six; counted per function it is
#: three and three, so neither is a violation.
NESTED_DEF_WITHIN_LIMIT = """
def outer():
    if cond:
        for _item in items:
            while cond:
                def inner():
                    if cond:
                        for _other in items:
                            while cond:
                                pass
"""

#: The same shape with the inner function five deep, so the inner one alone is
#: the violation and it is reported under its dotted name.
NESTED_DEF_OVER_LIMIT = """
def outer():
    if cond:

        def inner():
            if cond:
                for _item in items:
                    while cond:
                        with ctx:
                            if cond:
                                pass
"""

#: An if/elif chain three levels in. Every arm sits at the same level as the
#: ``if`` it belongs to, so the chain is one level however many arms it has.
ELIF_CHAIN_THREE_DEEP = """
def f():
    if cond:
        for _item in items:
            if a:
                pass
            elif b:
                pass
            elif c:
                pass
            elif d:
                pass
            else:
                pass
"""

#: The same nesting with a plain ``else:`` whose body is an ``if``, which is a
#: block inside a block and so does add a level.
ELSE_HOLDING_AN_IF = """
def f():
    if cond:
        for _item in items:
            if a:
                pass
            else:
                if b:
                    if c:
                        pass
"""

#: Three functions over the limit in one file.
THREE_VIOLATIONS = """
def one():
    if cond:
        for _item in items:
            while cond:
                with ctx:
                    if cond:
                        pass


def two():
    for _item in items:
        for _other in items:
            for _third in items:
                for _fourth in items:
                    for _fifth in items:
                        pass


def three():
    while cond:
        while cond:
            while cond:
                while cond:
                    while cond:
                        pass
"""

#: A module with nothing in it that nests at all.
FLAT = """
def f(level):
    total = level + 1
    return total
"""


# --- depth counting ------------------------------------------------------------


def test_a_function_at_the_limit_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 4))
    assert CHECK([path], {}) == 0


def test_a_function_at_the_limit_prints_nothing(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 4))
    CHECK([path], {})
    assert capsys.readouterr().out == ""


def test_a_flat_module_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/flat.py", FLAT)
    assert CHECK([path], {}) == 0


def test_a_function_one_past_the_limit_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 5))
    assert CHECK([path], {}) == 1


def test_a_function_over_the_limit_is_reported_with_its_name_line_and_depth(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    """One line, and the line of the ``def`` rather than of the deepest block."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", LATE_DEF)
    CHECK([path], {})
    assert problem_lines(capsys.readouterr().out) == [
        f"hqptuner/core/deep.py:{LATE_DEF_LINE}: f() nests 5 deep (max 4)"
    ]


def test_a_failing_run_summarises_how_many_problems_it_found(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    """The trailing line tells the reader how much there is to fix."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", THREE_VIOLATIONS)
    CHECK([path], {})
    assert "3" in summary_line(capsys.readouterr().out)


def test_the_summary_of_a_two_problem_run_differs_from_a_one_problem_run(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    """The count is read off the problems rather than being fixed text."""
    monkeypatch.chdir(tmp_path)
    one = write_source(tmp_path, "hqptuner/core/one.py", function("if", 5, name="f"))
    two = write_source(
        tmp_path, "hqptuner/core/two.py", function("if", 5, name="f") + "\n" + function("while", 5, name="g")
    )
    CHECK([one], {})
    first = summary_line(capsys.readouterr().out)
    CHECK([two], {})
    assert summary_line(capsys.readouterr().out) != first


# --- what counts as a level ----------------------------------------------------


@pytest.mark.parametrize("kind", ["if", "for", "while", "with", "try", "match"])
def test_each_block_construct_counts_as_one_level_at_the_limit(tmp_path: Path, monkeypatch: Any, kind: str) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function(kind, 4))
    assert CHECK([path], {}) == 0


@pytest.mark.parametrize("kind", ["if", "for", "while", "with", "try", "match"])
def test_each_block_construct_counts_as_one_level_past_the_limit(tmp_path: Path, monkeypatch: Any, kind: str) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function(kind, 5))
    assert CHECK([path], {}) == 1


@pytest.mark.parametrize("kind", ASYNC_BLOCKS)
def test_an_async_construct_at_the_limit_passes_like_its_sync_form(tmp_path: Path, monkeypatch: Any, kind: str) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function(kind, 4))
    assert CHECK([path], {}) == 0


@pytest.mark.parametrize("kind", ASYNC_BLOCKS)
def test_an_async_construct_past_the_limit_fails_like_its_sync_form(
    tmp_path: Path, monkeypatch: Any, kind: str
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function(kind, 5))
    assert CHECK([path], {}) == 1


def test_an_async_function_over_the_limit_is_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    """``async def`` is a function like any other, so the report reaches inside one."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("async for", 5))
    CHECK([path], {})
    assert "f()" in line_naming(capsys.readouterr().out, "hqptuner/core/deep.py")


def test_an_elif_chain_shares_a_level_with_its_if(tmp_path: Path, monkeypatch: Any) -> None:
    """However many arms it has, the chain is one level, so three deep is within the limit."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/chain.py", ELIF_CHAIN_THREE_DEEP)
    assert CHECK([path], {}) == 0


def test_a_plain_else_holding_an_if_adds_a_level(tmp_path: Path, monkeypatch: Any) -> None:
    """The same nesting written with ``else:`` then ``if`` is a block inside a block."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/chain.py", ELSE_HOLDING_AN_IF)
    assert CHECK([path], {}) == 1


def test_a_nested_def_starts_its_own_count(tmp_path: Path, monkeypatch: Any) -> None:
    """Three deep enclosing three deep is two functions at three, not one at six."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/inner.py", NESTED_DEF_WITHIN_LIMIT)
    assert CHECK([path], {}) == 0


def test_a_nested_def_over_the_limit_is_reported_under_its_dotted_name(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/inner.py", NESTED_DEF_OVER_LIMIT)
    CHECK([path], {})
    assert "outer.inner()" in line_naming(capsys.readouterr().out, "hqptuner/core/inner.py")


def test_a_method_over_the_limit_is_reported_under_its_dotted_name(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", DEEP_METHOD)
    CHECK([path], {})
    assert "Tuner.set_volume()" in line_naming(capsys.readouterr().out, "hqptuner/core/tuner.py")


# --- depths() ------------------------------------------------------------------


def test_depths_reports_the_deepest_nesting_a_function_reaches() -> None:
    assert depth_of(function("if", 5), "f") == 5


def test_depths_reports_the_line_of_the_def_rather_than_of_the_deepest_block() -> None:
    assert def_line_of(LATE_DEF, "f") == LATE_DEF_LINE


def test_depths_reports_a_method_under_its_dotted_name() -> None:
    assert "Tuner.set_volume" in names(DEEP_METHOD)


def test_depths_reports_a_nested_function_under_its_dotted_name() -> None:
    assert "outer.inner" in names(NESTED_DEF_OVER_LIMIT)


def test_depths_reports_the_enclosing_function_before_the_one_nested_in_it() -> None:
    """Outermost first, so a reader walks the file the way it is written."""
    assert names(NESTED_DEF_OVER_LIMIT) == ["outer", "outer.inner"]


def test_depths_counts_a_nested_def_separately_from_its_enclosing_function() -> None:
    assert depth_of(NESTED_DEF_WITHIN_LIMIT, "outer.inner") == 3


def test_depths_finds_nothing_in_a_module_with_no_functions() -> None:
    assert DEPTHS("VALUE = 1\n") == []


# --- EXEMPT --------------------------------------------------------------------


def test_an_exempt_function_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 5))
    assert CHECK([path], {f"{path}::f": "the parser walks a nested document"}) == 0


def test_an_exempt_function_is_not_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    """An exemption is silent — it excuses the site rather than warning about it."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 5))
    CHECK([path], {f"{path}::f": "the parser walks a nested document"})
    assert capsys.readouterr().out == ""


def test_an_exemption_excuses_only_the_function_it_names(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    source = function("if", 5, name="f") + "\n" + function("while", 5, name="g")
    path = write_source(tmp_path, "hqptuner/core/deep.py", source)
    assert CHECK([path], {f"{path}::f": "the parser walks a nested document"}) == 1


def test_an_exemption_naming_a_dotted_method_excuses_it(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", DEEP_METHOD)
    assert CHECK([path], {f"{path}::Tuner.set_volume": "the wire frame nests this far"}) == 0


def test_an_exemption_whose_file_is_not_on_disk_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/flat.py", FLAT)
    assert CHECK([path], {"hqptuner/core/deleted.py::f": "excused for a forgotten reason"}) == 1


def test_an_exemption_whose_file_is_not_on_disk_names_the_key_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/flat.py", FLAT)
    CHECK([path], {"hqptuner/core/deleted.py::f": "excused for a forgotten reason"})
    assert "hqptuner/core/deleted.py::f" in capsys.readouterr().out


def test_an_exemption_whose_file_is_not_on_disk_reports_on_one_line(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/flat.py", FLAT)
    CHECK([path], {"hqptuner/core/deleted.py::f": "excused for a forgotten reason"})
    assert len(problem_lines(capsys.readouterr().out)) == 1


def test_an_exemption_naming_a_function_now_within_the_limit_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    """The function is still there and shallow now, so the excuse has nothing left to excuse."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 4))
    assert CHECK([path], {f"{path}::f": "the parser walks a nested document"}) == 1


def test_an_exemption_naming_a_function_now_within_the_limit_names_the_key_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 4))
    CHECK([path], {f"{path}::f": "the parser walks a nested document"})
    assert f"{path}::f" in capsys.readouterr().out


def test_an_exemption_naming_a_function_now_within_the_limit_says_to_drop_the_entry(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    """The line tells the reader what to do about it, not only that it is stale."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 4))
    CHECK([path], {f"{path}::f": "the parser walks a nested document"})
    assert "drop" in line_naming(capsys.readouterr().out, f"{path}::f").lower()


def test_a_stale_exemption_reports_on_one_line(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 4))
    CHECK([path], {f"{path}::f": "the parser walks a nested document"})
    assert len(problem_lines(capsys.readouterr().out)) == 1


def test_a_stale_exemption_for_a_file_not_passed_on_argv_still_fails(tmp_path: Path, monkeypatch: Any) -> None:
    """Staleness is judged against the filesystem, so which subset was handed over does not hide it."""
    monkeypatch.chdir(tmp_path)
    untouched = write_source(tmp_path, "hqptuner/core/untouched.py", function("if", 4))
    committed = write_source(tmp_path, "hqptuner/core/committed.py", FLAT)
    assert CHECK([committed], {f"{untouched}::f": "excused long ago"}) == 1


def test_a_live_exemption_for_a_file_not_passed_on_argv_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """A partial commit reads the untouched file from disk and finds its entry still true."""
    monkeypatch.chdir(tmp_path)
    untouched = write_source(tmp_path, "hqptuner/core/untouched.py", function("if", 5))
    committed = write_source(tmp_path, "hqptuner/core/committed.py", FLAT)
    assert CHECK([committed], {f"{untouched}::f": "the parser walks a nested document"}) == 0


def test_omitting_the_exemption_mapping_falls_back_to_the_shipped_one(tmp_path: Path, monkeypatch: Any) -> None:
    """A caller who passes no mapping gets the module's own, so a shipped excuse is honoured."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 5))
    monkeypatch.setattr(GATE, "EXEMPT", {f"{path}::f": "the parser walks a nested document"})
    assert CHECK([path]) == 0


def test_the_shipped_mapping_is_only_the_fallback(tmp_path: Path, monkeypatch: Any) -> None:
    """An explicit mapping replaces the shipped one rather than adding to it."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 5))
    monkeypatch.setattr(GATE, "EXEMPT", {f"{path}::f": "the parser walks a nested document"})
    assert CHECK([path], {}) == 1


# --- whole-tree ----------------------------------------------------------------


def test_several_violations_all_fail_the_run(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", THREE_VIOLATIONS)
    assert CHECK([path], {}) == 1


def test_several_violations_are_printed_one_line_each(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", THREE_VIOLATIONS)
    CHECK([path], {})
    assert len(problem_lines(capsys.readouterr().out)) == 3


def test_several_violations_each_name_their_own_function(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    """Three lines about the same function would be three lines and one violation."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", THREE_VIOLATIONS)
    CHECK([path], {})
    lines = problem_lines(capsys.readouterr().out)
    assert [named for named in ("one()", "two()", "three()") if any(named in line for line in lines)] == [
        "one()",
        "two()",
        "three()",
    ]


def test_a_violation_in_a_later_file_fails_the_run(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    paths = [
        write_source(tmp_path, "hqptuner/core/flat.py", FLAT),
        write_source(tmp_path, "hqptuner/core/chain.py", ELIF_CHAIN_THREE_DEEP),
        write_source(tmp_path, "hqptuner/core/deep.py", function("if", 5)),
    ]
    assert CHECK(paths, {}) == 1


def test_a_tree_of_shallow_files_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    paths = [
        write_source(tmp_path, "hqptuner/core/flat.py", FLAT),
        write_source(tmp_path, "hqptuner/core/chain.py", ELIF_CHAIN_THREE_DEEP),
        write_source(tmp_path, "hqptuner/core/inner.py", NESTED_DEF_WITHIN_LIMIT),
        write_source(tmp_path, "hqptuner/core/limit.py", function("if", 4)),
    ]
    assert CHECK(paths, {}) == 0


# --- the script itself ---------------------------------------------------------


def test_running_the_script_over_a_deeply_nested_function_exits_nonzero(tmp_path: Path) -> None:
    """The Makefile runs the script, so argv and the exit status have to carry the same answer."""
    install_gate(tmp_path)
    satisfy_shipped_exemptions(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/deep.py", function("if", 5))
    assert run_gate(tmp_path, path) == 1


def test_running_the_script_over_a_shallow_function_exits_zero(tmp_path: Path) -> None:
    """The other half of the exit status: a clean run says so rather than failing on its own feet."""
    install_gate(tmp_path)
    satisfy_shipped_exemptions(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/flat.py", FLAT)
    assert run_gate(tmp_path, path) == 0
