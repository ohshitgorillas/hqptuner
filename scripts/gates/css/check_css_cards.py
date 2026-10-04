#!/usr/bin/env python3
"""Gate: the v1 card frame is painted in one place, and the faceplate has no card.

Two rule sets, chosen by where the stylesheet lives (docs/design-system.md).

A stylesheet in a v1 concern directory (``css/base``, ``css/cards``,
``css/controls``, ``css/features``) owns one card. ``eslint-rules/no-hand-rolled-card.js``
stops a template writing ``class="card"``, so the frame cannot be re-*marked-up*
elsewhere. It cannot stop the frame being re-*painted* elsewhere. A rule that
hands some other class the card's fill and the card's corner radius builds the
same surface under a name that gate has never heard of, and walks straight past
it. A second copy of the frame is a second place to fix when the surface
changes, and cards.css's ``.span`` hairline mask only knows to mask ``.card`` —
a card-like container it has never heard of paints the page color over a card
and reads as a dark band across the row. So there the gate fails any rule block
declaring ``background: var(--surface-card)`` together with ``border-radius:
var(--r-lg)`` — the two declarations that ARE the frame — unless the block is
the card's own rule in its own stylesheet.

Every other stylesheet is a faceplate stylesheet: one surface, sections marked
by an engraved header and a hairline, every section on the same two columns.
There the gate fails

- a selector naming ``.card``, ``.card-head``, ``.card-body`` or ``.pack``, and
- a rule painting the plate's own fill (``--plate*``) together with a corner
  radius under any name but ``.plate``: a rounded panel in the plate's color
  is a card, whatever it is called.

Escape hatch: ``/* card-frame-exempt: <reason> */`` inside the block or on the
line above it, same contract as the token and class gates — the reason is
required. A surface that needs the card's fill and the card's radius while not
being a card is a claim you should be able to make in a clause.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PRAGMA = "card-frame-exempt:"
#: the component that owns the v1 frame — every v1 complaint points a reader here
OWNER = "hqptuner/static/components/common.js"
#: the one stylesheet allowed to declare the v1 frame
DEFINITION_SITE = "cards.css"
#: the v1 concern directories, each a child of a `css` directory
V1_CONCERNS = frozenset({"base", "cards", "controls", "features"})

#: the card's fill, and the card's radius: together they are the v1 frame
FILL = re.compile(r"^background(?:-color)?\s*:\s*var\(\s*--surface-card\s*\)")
RADIUS = re.compile(r"^border-radius\s*:\s*var\(\s*--r-lg\s*\)")
#: `.card`, `.card-head`, `.card-body` — and deliberately not `.card-grid`,
#: `.card-title` or `.card-cols2`, which are layout and type, not the frame
CARD_CLASS = re.compile(r"\.card(?:-head|-body)?(?![\w-])")
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


def rule_blocks(lines: list[str]) -> list[Block]:
    """(selector, first line, last line, declarations) for every rule block.

    A stack, because a block inside ``@media`` is a block: its declarations
    belong to it and not to the at-rule wrapping it. A selector split over
    several lines (``.a,`` / ``.b,`` / ``.c {``) is gathered first, so the
    reported line is where a reader would start reading the rule.
    """
    blocks: list[Block] = []
    stack: list[tuple[str, int, list[str]]] = []
    prelude: list[str] = []
    start = 0
    for num, raw in enumerate(lines, 1):
        line = raw.strip()
        if line.endswith("{"):
            prelude.append(line[:-1].strip())
            stack.append((" ".join(part for part in prelude if part), start or num, []))
            prelude, start = [], 0
        elif line.startswith("}"):
            if stack:
                selector, first, decls = stack.pop()
                blocks.append((selector, first, num, decls))
        elif line.endswith(",") and ";" not in line:
            start = start or num
            prelude.append(line)
        else:
            prelude, start = [], 0
            if stack:
                stack[-1][2].append(line)
    return blocks


def faceplate_blocks(text: str) -> list[Block]:
    """(selector, first line, last line, declarations) for every rule block, however it is laid out.

    The faceplate writes a rule on one line, so this reader walks characters,
    not lines. Same stack as ``rule_blocks``; the reported line is where the
    selector starts.
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


def is_frame(decls: list[str]) -> bool:
    """Report whether these declarations paint the v1 card frame."""
    return any(FILL.match(d) for d in decls) and any(RADIUS.match(d) for d in decls)


def owns_frame(selector: str, path: Path) -> bool:
    """Report whether the block IS the card: the card's own class, in its own file."""
    return path.name == DEFINITION_SITE and bool(CARD_CLASS.search(selector))


def exempted(lines: list[str], first: int, last: int) -> bool:
    """Report whether the block, or the line above it, carries a pragma with a reason."""
    return any(EXEMPT.search(line) for line in lines[max(first - 2, 0) : last])


def v1_complaint(selector: str, decls: list[str], path: Path) -> str:
    """Return a complaint about one block of a v1 stylesheet, or ''."""
    if not is_frame(decls) or owns_frame(selector, path):
        return ""
    return (
        f"{selector} — repaints the card frame "
        f"(background: var(--surface-card) + border-radius: var(--r-lg)) under another name; "
        f"render it with Card from {OWNER}"
    )


def faceplate_complaint(selector: str, decls: list[str]) -> str:
    """Return a complaint about one block of a faceplate stylesheet, or ''."""
    if REFUSED_CLASS.search(selector):
        return f"{selector} — the faceplate has no card and no pack grid; a section is a header and a hairline"
    rounded = any(PLATE_FILL.match(d) for d in decls) and any(ANY_RADIUS.match(d) for d in decls)
    if rounded and not PLATE_CLASS.search(selector):
        return f"{selector} — a rounded panel in the plate's fill is a card; the plate is the one surface"
    return ""


def is_v1(path: Path) -> bool:
    """Report whether this stylesheet sits in a v1 concern directory."""
    return path.parent.name in V1_CONCERNS and path.parent.parent.name == "css"


def check_file(path: Path) -> list[str]:
    """Return one complaint per card this stylesheet paints where it may not."""
    text = path.read_text()
    lines = text.splitlines()
    v1 = is_v1(path)
    problems = []
    for selector, first, last, decls in rule_blocks(lines) if v1 else faceplate_blocks(text):
        complaint = v1_complaint(selector, decls, path) if v1 else faceplate_complaint(selector, decls)
        if complaint and not exempted(lines, first, last):
            problems.append(f"{path}:{first}: {complaint}")
    return problems


def main() -> int:
    """Refuse a second v1 card frame, and any card, pack grid or rounded plate panel on the faceplate."""
    problems: list[str] = []
    for name in sys.argv[1:]:
        problems.extend(check_file(Path(name)))
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} card(s) where none may be painted. In a v1 stylesheet render the card with Card")
        print(f"from {OWNER}; on the faceplate drop the frame. Mark the rule")
        print(f"/* {PRAGMA} <reason> */ if the surface is not a card.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
