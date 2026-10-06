#!/usr/bin/env python3
"""Gate: the faceplate has no card (docs/design-system.md).

A faceplate stylesheet has one surface, sections marked by an engraved header
and a hairline, every section on the same two columns. The gate fails

- a selector naming ``.card``, ``.card-head``, ``.card-body`` or ``.pack``, and
- a rule painting the plate's own fill (``--plate*``) together with a corner
  radius under any name but ``.plate``: a rounded panel in the plate's color
  is a card, whatever it is called.

Escape hatch: ``/* card-frame-exempt: <reason> */`` inside the block or on the
line above it, same contract as the token and class gates — the reason is
required.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PRAGMA = "card-frame-exempt:"
#: the faceplate's refused class names: the card, and the two-track pack grid
REFUSED_CLASS = re.compile(r"\.(?:card(?:-head|-body)?|pack)(?![\w-])")
#: the plate's own fill, and any corner radius that rounds something
PLATE_FILL = re.compile(r"^background(?:-color)?\s*:\s*var\(\s*--plate")
ANY_RADIUS = re.compile(r"^border-radius\s*:\s*(?!0\s*$)")
#: the one faceplate selector allowed to round the plate's fill
PLATE_CLASS = re.compile(r"\.plate(?![\w-])")
#: an exemption is honoured only when a reason follows the colon. The lookahead
#: is what makes that real: without it the comment's own `*/` reads as a reason,
#: and `/* card-frame-exempt: */` — the exact form of an exemption nobody could
#: justify — buys silence.
EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*(?!\*/)\S")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)

Block = tuple[str, int, int, list[str]]


def faceplate_blocks(text: str) -> list[Block]:
    """(selector, first line, last line, declarations) for every rule block, however it is laid out.

    The faceplate writes a rule on one line, so this reader walks characters,
    not lines. A stack, because a block inside ``@media`` is a block: its
    declarations belong to it and not to the at-rule wrapping it. The reported
    line is where the selector starts.
    """
    blocks: list[Block] = []
    stack: list[tuple[str, int, list[str]]] = []
    line, start, current = 1, 1, ""
    for char in BLOCK_COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text):
        if char not in "{};":
            start = start if current.strip() else line
            current += char
            line += char == "\n"
            continue
        piece, current = " ".join(current.split()), ""
        if char == "{":
            stack.append((piece, start, []))
            continue
        if stack and piece:
            stack[-1][2].append(piece)
        if char == "}" and stack:
            selector, first, decls = stack.pop()
            blocks.append((selector, first, line, decls))
    return blocks


def exempted(lines: list[str], first: int, last: int) -> bool:
    """Report whether the block, or the line above it, carries a pragma with a reason."""
    return any(EXEMPT.search(line) for line in lines[max(first - 2, 0) : last])


def faceplate_complaint(selector: str, decls: list[str]) -> str:
    """Return a complaint about one block of a faceplate stylesheet, or ''."""
    if REFUSED_CLASS.search(selector):
        return f"{selector} — the faceplate has no card and no pack grid; a section is a header and a hairline"
    rounded = any(PLATE_FILL.match(d) for d in decls) and any(ANY_RADIUS.match(d) for d in decls)
    if rounded and not PLATE_CLASS.search(selector):
        return f"{selector} — a rounded panel in the plate's fill is a card; the plate is the one surface"
    return ""


def check_file(path: Path) -> list[str]:
    """Return one complaint per card this stylesheet paints where it may not."""
    text = path.read_text()
    lines = text.splitlines()
    problems = []
    for selector, first, last, decls in faceplate_blocks(text):
        complaint = faceplate_complaint(selector, decls)
        if complaint and not exempted(lines, first, last):
            problems.append(f"{path}:{first}: {complaint}")
    return problems


def main() -> int:
    """Refuse any card, pack grid or rounded plate panel on the faceplate."""
    problems: list[str] = []
    for name in sys.argv[1:]:
        problems.extend(check_file(Path(name)))
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} card(s) where none may be painted. Drop the frame, or mark the rule")
        print(f"/* {PRAGMA} <reason> */ if the surface is not a card.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
