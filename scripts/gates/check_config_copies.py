#!/usr/bin/env python3
"""Gate: a config value that more than one tool needs is written once, or held equal.

A tool that can read the source reads it. A copy a tool cannot read from the
source is held equal to it here: eslint's ``complexity`` against ruff's
``max-complexity``, the xenon grade against that same limit, the ``[tool.mutmut]``
marker expression against the Makefile's offline one, and pytest's ``pythonpath``
against mypy's ``mypy_path``.

A xenon grade is radon's name for a band of cyclomatic complexity, so it stands
for the band's ceiling, as radon's ``cc_rank`` docstring tabulates the bands. The Makefile's
offline expression is the ``-m`` of the pytest command a recipe of ``test``, or
of a target ``test`` reaches, runs, with the Makefile's variables expanded.

Usage: ``python scripts/gates/check_config_copies.py``
"""

from __future__ import annotations

import re
import shlex
import sys
import tomllib
from pathlib import Path
from typing import Any

from check_gates_wired import makefile_rules, precommit_commands, reached

ROOT = Path(__file__).resolve().parent.parent.parent

#: Eslint's complexity rule as ``eslint.config.js`` writes it, ceiling captured.
ESLINT_COMPLEXITY = re.compile(r'\bcomplexity:\s*\[\s*"error",\s*(?P<limit>\d+)')

#: Xenon's per-block grade flag in either spelling, grade captured.
XENON_GRADE = re.compile(r"\bxenon\b.*?(?:--max-absolute|-b)(?:=|\s+)(?P<grade>\w+)")

#: A Makefile variable assignment in any flavour, name and value captured.
MAKE_ASSIGNMENT = re.compile(r"^(?P<name>[A-Za-z_]\w*)\s*(?P<op>::?=|\?=|\+=|=)\s*(?P<value>.*)$")

#: A Makefile reference: an escaped ``$$``, or ``$(NAME)`` / ``${NAME}``.
MAKE_REFERENCE = re.compile(r"\$\$|\$\((?P<paren>\w+)\)|\$\{(?P<brace>\w+)\}")

#: The Makefile target whose recipes, and those of the targets it reaches, run the offline suite.
OFFLINE_GOAL = "test"

#: The pytest flag that takes the marker expression.
MARKER_FLAG = "-m"


#: Each radon grade's band ceiling, from the table in radon's ``cc_rank`` docstring
#: (A 1-5, B 6-10, C 11-20, D 21-30, E 31-40, F 41+). F is unbounded, so it has none.
BAND_CEILINGS = {5: "A", 10: "B", 20: "C", 30: "D", 40: "E"}


def ceiling_grade(limit: int) -> str | None:
    """Return the grade whose band tops out at ``limit``; none when ``limit`` is no band's ceiling."""
    return BAND_CEILINGS.get(limit)


def eslint_complexity(text: str) -> int | None:
    """Return the ceiling of eslint's ``complexity`` rule in a flat config; none when it sets no such rule."""
    match = ESLINT_COMPLEXITY.search(text)
    return int(match["limit"]) if match else None


def xenon_grades(commands: list[str]) -> list[str]:
    """Return the ``--max-absolute`` grade of every xenon invocation among ``commands``."""
    return [match["grade"] for command in commands if (match := XENON_GRADE.search(command))]


def make_variables(text: str) -> dict[str, str]:
    """Return every variable a Makefile assigns outside a recipe, unexpanded, ``+=`` appended."""
    variables: dict[str, str] = {}
    for line in text.splitlines():
        match = MAKE_ASSIGNMENT.match(line)
        if match is None:
            continue
        value = match["value"].split("#", 1)[0].rstrip()
        if match["op"] == "+=":
            value = f"{variables.get(match['name'], '')} {value}".strip()
        variables[match["name"]] = value
    return variables


def expand(text: str, variables: dict[str, str], seen: frozenset[str] = frozenset()) -> str:
    """Return ``text`` with every Makefile variable reference expanded and ``$$`` read as ``$``."""

    def substitute(match: re.Match[str]) -> str:
        name = match["paren"] or match["brace"]
        if name is None:
            return "$"
        if name in seen:
            return ""
        return expand(variables.get(name, ""), variables, seen | {name})

    return MAKE_REFERENCE.sub(substitute, text)


def pytest_markers(command: str) -> str | None:
    """Return the marker expression a shell command hands pytest; none when it runs no pytest with ``-m``."""
    if "pytest" not in command:
        return None
    words = shlex.split(command)
    starts = [index for index, word in enumerate(words) if Path(word).name == "pytest"]
    if not starts:
        return None
    rest = words[starts[0] + 1 :]
    if MARKER_FLAG not in rest[:-1]:
        return None
    return rest[rest.index(MARKER_FLAG) + 1]


def makefile_recipes(text: str, goal: str | None = None) -> list[str]:
    """Return every recipe line, variables expanded, of ``goal`` and what it reaches, or of every target."""
    prerequisites, recipes = makefile_rules(text)
    targets = sorted(reached(prerequisites, goal) if goal else recipes)
    variables = make_variables(text)
    return [expand(recipe, variables) for target in targets for recipe in recipes.get(target, [])]


def offline_markers(makefile: str) -> list[str]:
    """Return each distinct marker expression of a pytest command that ``make test`` runs."""
    found = (pytest_markers(recipe) for recipe in makefile_recipes(makefile, OFFLINE_GOAL))
    return sorted({markers for markers in found if markers is not None})


def mutmut_markers(pyproject: dict[str, Any]) -> str | None:
    """Return the marker expression in ``[tool.mutmut]``'s pytest arguments; none when it passes no ``-m``."""
    args = [str(arg) for arg in pyproject.get("tool", {}).get("mutmut", {}).get("pytest_add_cli_args", [])]
    if MARKER_FLAG not in args[:-1]:
        return None
    return args[args.index(MARKER_FLAG) + 1]


def complexity_refusals(limit: int, eslint: int | None) -> list[str]:
    """Refuse an eslint complexity ceiling that is not ruff's ``max-complexity``."""
    if eslint == limit:
        return []
    return [f"eslint.config.js: complexity {eslint} differs from ruff max-complexity {limit} in pyproject.toml"]


def xenon_refusals(limit: int, grades: dict[str, list[str]]) -> list[str]:
    """Refuse each xenon grade, by file, whose band ceiling is not ruff's ``max-complexity``."""
    wanted = ceiling_grade(limit)
    expected = wanted or f"none, since {limit} is no radon band's ceiling"
    return [
        f"{name}: xenon --max-absolute {grade} differs from the grade whose ceiling is ruff "
        f"max-complexity {limit}: {expected}"
        for name, found in grades.items()
        for grade in found
        if grade != wanted
    ]


def marker_refusals(makefile: list[str], mutmut: str | None) -> list[str]:
    """Refuse a ``[tool.mutmut]`` marker expression that is not the Makefile's one offline expression."""
    if len(makefile) != 1:
        return [f"Makefile: `make test` runs pytest with {len(makefile)} marker expressions {makefile}, expected one"]
    if mutmut == makefile[0]:
        return []
    return [f"pyproject.toml: [tool.mutmut] markers {mutmut!r} differ from the Makefile's {makefile[0]!r}"]


def path_refusals(pythonpath: list[str], mypy_path: list[str]) -> list[str]:
    """Refuse a pytest ``pythonpath`` that is not mypy's ``mypy_path``, root for root in order."""
    if pythonpath == mypy_path:
        return []
    return [f"pyproject.toml: pytest pythonpath {pythonpath} differs from mypy mypy_path {mypy_path}"]


def refusals(root: Path) -> list[str]:
    """Return every refused copy under ``root``, one line each."""
    with (root / "pyproject.toml").open("rb") as handle:
        pyproject = tomllib.load(handle)
    tool = pyproject.get("tool", {})
    limit = int(tool["ruff"]["lint"]["mccabe"]["max-complexity"])
    pythonpath = tool.get("pytest", {}).get("ini_options", {}).get("pythonpath", [])
    mypy_path = tool.get("mypy", {}).get("mypy_path", [])
    makefile = (root / "Makefile").read_text(encoding="utf-8")
    precommit = (root / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    eslint = (root / "eslint.config.js").read_text(encoding="utf-8")
    grades = {
        "Makefile": xenon_grades(makefile_recipes(makefile)),
        ".pre-commit-config.yaml": xenon_grades(precommit_commands(precommit)),
    }
    return [
        *complexity_refusals(limit, eslint_complexity(eslint)),
        *xenon_refusals(limit, grades),
        *marker_refusals(offline_markers(makefile), mutmut_markers(pyproject)),
        *path_refusals(pythonpath, mypy_path),
    ]


def check(root: Path = ROOT) -> int:
    """Check the config copies under ``root`` and return the process exit status."""
    refused = refusals(root)
    for line in refused:
        print(line)
    if refused:
        print(f"\n{len(refused)} copy(ies) refused. A copy a tool cannot read from its source is held equal to it.")
        return 1
    print("[ok] every config copy equals its source")
    return 0


def main() -> int:
    """Run the gate on the repository root and return its exit status."""
    return check(ROOT)


if __name__ == "__main__":
    sys.exit(main())
