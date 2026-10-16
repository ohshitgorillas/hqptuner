#!/usr/bin/env python3
"""Gate: design-doc paths name real files, and code never points at the design docs.

1. **A backticked path in a design doc must name something in the tree.** A
   file under ``docs/spec/`` that cites `` `scripts/gate.sh` `` fails once
   that path is gone. Only paths under ``hqptuner/``, ``scripts/``, ``docs/``
   and ``tests/`` are checked, resolved against the repo root; ``main`` always
   scans ``docs/spec/*.md`` beside the files it is handed.

2. **Code never refers to a design doc.** A file under ``hqptuner/``,
   ``tests/`` or ``scripts/`` that names a file under ``docs/spec/``, by its
   path or by the bare name of a design doc, fails with the file, the line and
   the reference. Markdown files and anything under ``.claude/`` are not code.
   This script and its test define the rule, so they alone may carry such
   strings.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SPEC = ROOT / "docs" / "spec"

#: the bare file names of the design docs code may not name
DESIGN_DOCS = frozenset(path.name for path in SPEC.rglob("*.md"))

#: the trees whose files are code for the reference check
CODE_ROOTS = frozenset({"hqptuner", "tests", "scripts"})

#: the files that define the reference rule and so must spell it out
RULE_FILES = frozenset({Path(__file__).resolve(), ROOT / "tests" / "gates" / "test_check_doc_refs.py"})

#: a backticked repo path under one of the roots a design doc cites into; a
#: token with whitespace is a command, and one with a scheme or a dotted symbol
#: never starts with a bare root followed by a slash
CITED_PATH = re.compile(r"`((?:hqptuner|scripts|docs|tests)/[^`\s]*)`")

#: the design-doc names as one alternation, longest first
BARE_NAMES = "|".join(re.escape(name) for name in sorted(DESIGN_DOCS, key=len, reverse=True))

#: a design doc named by its path, or by its bare file name
REFERENCE = re.compile(rf"docs/spec/(?:[\w.-]+/)*[\w.-]+\.md(?![\w-])|(?<![\w.-])(?:{BARE_NAMES})(?![\w-])")


def tree_parts(path: Path) -> tuple[str, ...]:
    """Split the path into parts, repo-relative when it sits in the repo."""
    resolved = path.resolve()
    if resolved.is_relative_to(ROOT):
        return resolved.relative_to(ROOT).parts
    return resolved.parts


def design_doc(parts: tuple[str, ...]) -> bool:
    """Report whether these parts sit under a ``docs/spec/`` directory."""
    return any(parts[i : i + 2] == ("docs", "spec") for i in range(len(parts) - 1))


def code_file(path: Path) -> bool:
    """Report whether this file is code the reference check covers."""
    parts = tree_parts(path)
    return (
        path.suffix != ".md"
        and ".claude" not in parts
        and not design_doc(parts)
        and not CODE_ROOTS.isdisjoint(parts[:-1])
        and path.resolve() not in RULE_FILES
    )


def missing_paths(line: str) -> list[str]:
    """Each backticked path on this line that names nothing in the repo tree."""
    return [cited for cited in CITED_PATH.findall(line) if not (ROOT / cited).exists()]


def relabel(path: Path) -> str:
    """Repo-relative display path; falls back to whatever was passed in."""
    resolved = path.resolve()
    if resolved.is_relative_to(ROOT):
        return str(resolved.relative_to(ROOT))
    return str(path)


def check(path: Path) -> list[str]:
    """Every problem in one file."""
    label = relabel(path)
    problems: list[str] = []
    lines: list[str] = []
    read_ok = True
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        problems.append(f"{label}: unreadable: {exc}")
        read_ok = False
    if not read_ok:
        return problems
    if design_doc(tree_parts(path)):
        for index, line in enumerate(lines, start=1):
            problems.extend(f"{label}:{index}: `{cited}` — no such path" for cited in missing_paths(line))
    if code_file(path):
        for index, line in enumerate(lines, start=1):
            problems.extend(
                f"{label}:{index}: {match.group(0)} — code refers to a design doc" for match in REFERENCE.finditer(line)
            )
    return problems


def main(argv: list[str]) -> int:
    """Refuse a design-doc path that names no file, and any reference from code to a design doc."""
    if not DESIGN_DOCS:
        print("check_doc_refs: no design docs found", file=sys.stderr)
        return 1
    problems: list[str] = []
    seen: set[Path] = set()
    for path in [Path(arg) for arg in argv] + sorted(SPEC.glob("*.md")):
        resolved = path.resolve()
        if path.is_file() and resolved not in seen:
            seen.add(resolved)
            problems.extend(check(path))
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        print(f"\n{len(problems)} doc reference problem(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
