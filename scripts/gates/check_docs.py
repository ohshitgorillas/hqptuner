#!/usr/bin/env python3
"""Gate: the docs tree is short-lined and every doc is indexed with a subject.

1. **No logical line in a design doc runs past ``LIMIT`` characters.** Every
   ``.md`` file under ``docs/spec/`` or ``docs/parked/``, at any depth, is
   checked line by line; a table row is a line like any other.

2. **The index names every doc.** Each ``.md`` file anywhere under ``docs/``
   must be the target of a link in ``docs/README.md``; the index need not name
   itself. A link inside an HTML comment names nothing.

3. **Every index entry gives its doc a subject.** A list item that links a
   ``.md`` doc must carry text after the link; an HTML comment is not text.

There is no pragma or comment escape. ``main`` takes the repository root and
prints one line per problem naming the file.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

#: the longest logical line, in characters, a design doc may carry
LIMIT = 700

#: the directories under ``docs/`` whose Markdown is held to ``LIMIT``
LINE_LIMITED = frozenset({"spec", "parked"})

#: an HTML comment, possibly spanning lines
COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)

#: a Markdown inline link; group 1 is its target
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")

#: a list item opening on a link; group 1 is the target, group 2 what follows
ENTRY = re.compile(r"^\s*[-*+]\s+\[[^\]]*\]\(([^)\s]+)\)(.*)$")

#: the separator an entry puts between its link and its subject
SEPARATOR = " \t:-"


def markdown_files(docs: Path) -> list[Path]:
    """Every ``.md`` file under ``docs``, sorted."""
    return sorted(path for path in docs.rglob("*.md") if path.is_file())


def read_lines(path: Path) -> list[str] | None:
    """Return the file's lines, or ``None`` when it cannot be read as UTF-8."""
    try:
        return path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return None


def label(path: Path, root: Path) -> str:
    """Root-relative display path."""
    return str(path.relative_to(root))


def line_limited(path: Path, docs: Path) -> bool:
    """Report whether this doc sits under one of the line-limited directories."""
    parts = path.relative_to(docs).parts
    return len(parts) > 1 and parts[0] in LINE_LIMITED


def long_lines(path: Path, root: Path) -> list[str]:
    """One problem per line in this file longer than ``LIMIT`` characters."""
    lines = read_lines(path)
    if lines is None:
        return [f"{label(path, root)}: unreadable as UTF-8"]
    return [
        f"{label(path, root)}:{number}: line is {len(line)} characters, over the limit of {LIMIT}"
        for number, line in enumerate(lines, start=1)
        if len(line) > LIMIT
    ]


def link_target(target: str, docs: Path) -> Path:
    """Resolve the file a link in the index points at, anchors dropped."""
    return (docs / target.split("#", 1)[0]).resolve()


def indexed_targets(index_text: str, docs: Path) -> set[Path]:
    """Every file the index links, links inside comments excluded."""
    return {link_target(target, docs) for target in LINK.findall(COMMENT.sub("", index_text))}


def has_subject(tail: str) -> bool:
    """Report whether the text after an entry's link says anything."""
    return any(char.isalnum() for char in COMMENT.sub("", tail).strip(SEPARATOR))


def subjectless_entries(index_text: str, index_label: str) -> list[str]:
    """One problem per index entry that links a doc and gives it no subject."""
    problems: list[str] = []
    for number, line in enumerate(index_text.splitlines(), start=1):
        match = ENTRY.match(line)
        if match and match.group(1).split("#", 1)[0].endswith(".md") and not has_subject(match.group(2)):
            problems.append(f"{index_label}:{number}: entry for {match.group(1)} gives no subject")
    return problems


def index_problems(root: Path, docs: Path, files: list[Path]) -> list[str]:
    """Every unindexed doc and every subjectless entry."""
    index = docs / "README.md"
    index_label = label(index, root)
    lines = read_lines(index)
    problems = [] if lines is not None else [f"{index_label}: missing or unreadable as UTF-8"]
    text = "\n".join(lines or [])
    linked = indexed_targets(text, docs)
    problems += [
        f"{label(path, root)}: not linked from {index_label}"
        for path in files
        if path != index and path.resolve() not in linked
    ]
    return problems + subjectless_entries(text, index_label)


def check(root: Path) -> list[str]:
    """Every problem in the docs tree under ``root``."""
    docs = root / "docs"
    if not docs.is_dir():
        return [f"{label(docs, root)}: no docs directory"]
    files = markdown_files(docs)
    problems: list[str] = []
    for path in files:
        if line_limited(path, docs):
            problems.extend(long_lines(path, root))
    return problems + index_problems(root, docs, files)


def main(argv: list[str]) -> int:
    """Refuse a long design-doc line, an unindexed doc and a subjectless index entry."""
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
