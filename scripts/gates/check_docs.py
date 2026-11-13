#!/usr/bin/env python3
"""Gate: no logical line in a design doc runs past ``LIMIT`` characters.

Every ``.md`` file under ``docs/spec/`` or ``docs/parked/``, at any depth, is
checked line by line; a table row is a line like any other. There is no pragma
or comment escape. ``main`` takes the repository root and prints one line per
problem naming the file.
"""

from __future__ import annotations

import sys
from pathlib import Path

#: the longest logical line, in characters, a design doc may carry
LIMIT = 700

#: the directories under ``docs/`` whose Markdown is held to ``LIMIT``
LINE_LIMITED = frozenset({"spec", "parked"})


def markdown_files(docs: Path) -> list[Path]:
    """Every ``.md`` file under ``docs``, sorted."""
    return sorted(path for path in docs.rglob("*.md") if path.is_file())


def label(path: Path, root: Path) -> str:
    """Root-relative display path."""
    return str(path.relative_to(root))


def read_lines(path: Path, root: Path, problems: list[str]) -> list[str]:
    """Return the file's lines; a file that is missing or not UTF-8 reads as empty and lands in ``problems``."""
    text = ""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        problems.append(f"{label(path, root)}: missing")
    except (OSError, UnicodeDecodeError):
        problems.append(f"{label(path, root)}: unreadable as UTF-8")
    return text.splitlines()


def line_limited(path: Path, docs: Path) -> bool:
    """Report whether this doc sits under one of the line-limited directories."""
    parts = path.relative_to(docs).parts
    return len(parts) > 1 and parts[0] in LINE_LIMITED


def long_lines(lines: list[str], path_label: str) -> list[str]:
    """One problem per line of ``lines`` longer than ``LIMIT`` characters."""
    return [
        f"{path_label}:{number}: line is {len(line)} characters, over the limit of {LIMIT}"
        for number, line in enumerate(lines, start=1)
        if len(line) > LIMIT
    ]


def check(root: Path) -> list[str]:
    """Every long design-doc line in the docs tree under ``root``."""
    docs = root / "docs"
    if not docs.is_dir():
        return [f"{label(docs, root)}: no docs directory"]
    problems: list[str] = []
    for path in markdown_files(docs):
        if line_limited(path, docs):
            lines = read_lines(path, root, problems)
            problems += long_lines(lines, label(path, root))
    return problems


def main(argv: list[str]) -> int:
    """Refuse a long design-doc line."""
    if len(argv) != 1:
        print("usage: check_docs.py <repo-root>", file=sys.stderr)
        return 2
    problems = check(Path(argv[0]).resolve())
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} docs problem(s)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
