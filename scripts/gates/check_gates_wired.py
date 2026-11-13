#!/usr/bin/env python3
"""Gate: every gate script in ``scripts/gates/`` runs in the Makefile and in pre-commit.

Each gate is wired in by hand, one line per script, and nothing else notices
when a script never acquires that line — or keeps it after a target is
rewritten. An uninvoked gate stops running, and a gate that stops running rots
silently: it can drift all the way to crashing on import while ``make check``
stays green.

There are two wirings, not one. ``make check`` is run by hand; pre-commit runs
on every commit. A gate present in the first and absent from the second still
looks wired. Absence from pre-commit can be correct — a gate too slow for the
commit path belongs in ``make check`` only — and a deliberate absence reads the
same as a forgotten one, because both are spelled as silence.

A gate counts as wired in the Makefile only when a recipe line of ``check``, or
of a target ``check`` reaches through its prerequisites, invokes it. A recipe
``check`` never reaches does not run on ``make check``, and a prerequisite or a
comment runs nothing. In ``.pre-commit-config.yaml`` a gate counts as wired
only when a hook's ``entry`` or ``args`` invokes it; a hook's ``name`` or
``files`` only mentions it.

So Makefile wiring is mandatory with no exemption: a gate that should not run
is a gate that should be deleted. Pre-commit wiring is mandatory *or* exempt,
and an exemption is a line of prose in ``PRECOMMIT_EXEMPT`` saying why. An
exemption naming no gate is itself a failure — a stale reason is the same drift
one layer up. ``check_gates_wired.py`` is a gate script under
``scripts/gates/`` like any other, so both configs invoke it too.

Usage: ``python scripts/gates/check_gates_wired.py``
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: Gates that run in the Makefile only, filename to the reason they stay off the
#: commit path. Empty is the healthy state: every gate measured so far is fast
#: enough for pre-commit, including the two that shell out to node.
PRECOMMIT_EXEMPT: dict[str, str] = {}

#: The Makefile target whose recipes, and those of the targets it reaches, count
#: as wiring.
GOAL = "check"

#: A Makefile rule line: targets, then one or two colons that do not open an
#: ``:=`` assignment, then prerequisites and any inline recipe. A line with ``=``
#: before its first colon is an assignment and does not match.
RULE = re.compile(r"^(?P<targets>[^:=#\t][^:=#]*?)::?(?!=)(?P<rest>.*)$")

#: A YAML mapping key, optionally the first key of a block-list item.
KEY = re.compile(r"^(?P<lead>\s*(?:-\s+)?)(?P<key>[\w-]+):(?:\s+|$)(?P<value>.*)$")

#: The hook keys whose values pre-commit executes.
COMMAND_KEYS = ("entry", "args")

#: A YAML comment trailing a value.
TRAILING_COMMENT = re.compile(r"\s+#.*$")


def gate_scripts(gates: Path) -> list[str]:
    """Path of every gate script under the directory, relative to it, sorted."""
    return sorted(path.relative_to(gates).as_posix() for path in gates.rglob("*.py") if path.is_file())


def inert(line: str) -> bool:
    """Whether a line is blank or a comment, which both configs mark with ``#``."""
    stripped = line.lstrip()
    return not stripped or stripped.startswith("#")


def logical_lines(text: str) -> list[str]:
    """Join each backslash-continued run of Makefile lines into one line."""
    joined: list[str] = []
    pending = ""
    for line in text.splitlines():
        if line.endswith("\\"):
            pending += line[:-1] + " "
            continue
        joined.append(pending + line)
        pending = ""
    if pending:
        joined.append(pending)
    return joined


def parse_rule(line: str) -> tuple[list[str], list[str], list[str]]:
    """Targets, prerequisites and inline recipe of a rule line; all empty for any other line."""
    match = RULE.match(line)
    if match is None:
        return [], [], []
    head, semicolon, inline = match["rest"].partition(";")
    prerequisites = [word for word in head.split("#", 1)[0].split() if word != "|"]
    return match["targets"].split(), prerequisites, [inline] if semicolon else []


def shell_command(recipe: str) -> bool:
    """Whether a recipe line hands the shell a command rather than a comment."""
    body = recipe.lstrip("@-+ \t")
    return bool(body) and not body.startswith("#")


def makefile_rules(text: str) -> tuple[dict[str, set[str]], dict[str, list[str]]]:
    """Prerequisites and recipe lines of every Makefile target.

    A recipe line belongs to the rule above it. A blank or comment line keeps
    that rule open; any other line that is not a recipe line closes it.
    """
    prerequisites: dict[str, set[str]] = {}
    recipes: dict[str, list[str]] = {}
    current: list[str] = []
    for line in logical_lines(text):
        if line.startswith("\t"):
            for target in current:
                recipes.setdefault(target, []).append(line[1:])
        elif not inert(line):
            current, needs, inline = parse_rule(line)
            for target in current:
                prerequisites.setdefault(target, set()).update(needs)
                recipes.setdefault(target, []).extend(inline)
    return prerequisites, recipes


def reached(prerequisites: dict[str, set[str]], goal: str) -> set[str]:
    """Return the goal and every target it reaches through prerequisites."""
    seen: set[str] = set()
    todo = [goal]
    while todo:
        target = todo.pop()
        if target not in seen:
            seen.add(target)
            todo.extend(prerequisites.get(target, ()))
    return seen


def makefile_commands(text: str) -> list[str]:
    """Every shell command a recipe of ``check``, or of a target it reaches, runs."""
    prerequisites, recipes = makefile_rules(text)
    return [
        recipe
        for target in sorted(reached(prerequisites, GOAL))
        for recipe in recipes.get(target, [])
        if shell_command(recipe)
    ]


def continues(line: str, column: int | None) -> bool:
    """Whether a line carries on the value of the key that opened at ``column``.

    A value runs on over every deeper-indented line, and over block-list items
    at the key's own indentation.
    """
    if column is None:
        return False
    stripped = line.lstrip()
    indent = len(line) - len(stripped)
    return indent > column or (indent == column and stripped.startswith("- "))


def command_key(line: str) -> tuple[int | None, str]:
    """Column and value of an ``entry`` or ``args`` key on the line; no column for any other line."""
    match = KEY.match(line)
    if match is None or match["key"] not in COMMAND_KEYS:
        return None, ""
    return len(match["lead"]), match["value"]


def precommit_commands(text: str) -> list[str]:
    """Return the value of every hook ``entry`` and ``args`` key, one string per value line."""
    commands: list[str] = []
    column: int | None = None
    for line in text.splitlines():
        if inert(line):
            continue
        if continues(line, column):
            commands.append(TRAILING_COMMENT.sub("", line.strip()))
            continue
        column, value = command_key(line)
        if column is not None:
            commands.append(TRAILING_COMMENT.sub("", value))
    return commands


def unwired(commands: list[str], names: list[str]) -> list[str]:
    """Return the gates whose path appears in none of ``commands``."""
    return [name for name in names if not any(f"scripts/gates/{name}" in command for command in commands)]


def stale(names: list[str], exempt: dict[str, str]) -> list[str]:
    """Return exemption keys naming no gate script, sorted."""
    return sorted(key for key in exempt if key not in names)


def check(root: Path, exempt: dict[str, str] | None = None) -> int:
    """Refuse a gate no recipe ``make check`` reaches invokes, or that no pre-commit hook runs.

    Both checks run every time: a tree failing one still reports the other, so
    one fix per run is never the shape of this.
    """
    if exempt is None:
        exempt = PRECOMMIT_EXEMPT
    names = gate_scripts(root / "scripts" / "gates")
    problems = 0

    for name in unwired(makefile_commands((root / "Makefile").read_text()), names):
        print(f"scripts/gates/{name}: no recipe that `make check` reaches invokes it")
        problems += 1
    precommit = precommit_commands((root / ".pre-commit-config.yaml").read_text())
    for name in unwired(precommit, [n for n in names if n not in exempt]):
        print(f"scripts/gates/{name}: no hook entry or args in .pre-commit-config.yaml invokes it, and not exempt")
        problems += 1
    for name in stale(names, exempt):
        print(f"PRECOMMIT_EXEMPT[{name!r}]: names no gate script")
        problems += 1

    if problems:
        print(f"\n{problems} problem(s). Every gate runs in a recipe that `make check` reaches, and in a")
        print("hook's entry or args in .pre-commit-config.yaml unless PRECOMMIT_EXEMPT gives a reason it should not.")
        return 1
    print(f"[ok] all {len(names)} gate scripts are wired into the Makefile and pre-commit")
    return 0


def main() -> int:
    """Check this repo."""
    return check(ROOT)


if __name__ == "__main__":
    sys.exit(main())
