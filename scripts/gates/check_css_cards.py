#!/usr/bin/env python3
"""Gate: the card frame is painted in one place, under one name.

``eslint-rules/no-hand-rolled-card.js`` stops a template writing
``class="card"``, so the frame cannot be re-*marked-up* elsewhere. It cannot
stop the frame being re-*painted* elsewhere. A rule that hands some other class
the card's fill and the card's corner radius builds the same surface under a
name that gate has never heard of, and walks straight past it.

``.narrow-bar`` did exactly that: card fill, card radius, a hand-rolled
``.narrow-header`` standing in for ``.card-head``, and ``--surface-raised`` — a
fill token — misused as its border colour. It shipped unflagged for as long as
it existed, which is the whole cost the one-component rule exists to avoid
(docs/design-system.md). A second copy of the frame is a second place to fix
when the surface changes, and cards.css's ``.span`` hairline mask only knows to
mask ``.card`` — a card-like container it has never heard of paints the page
colour over a card and reads as a dark band across the row.

So this gate reads the stylesheets and fails any rule block declaring
``background: var(--surface-card)`` together with ``border-radius:
var(--r-lg)`` — the two declarations that ARE the frame — unless the block is
the card's own rule in its own stylesheet.

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
#: the component that owns the frame — every complaint points a reader here
OWNER = "hqptuner/static/components/common.js"
#: the one stylesheet allowed to declare the frame
DEFINITION_SITE = "cards.css"

#: the card's fill, and the card's radius: together they are the frame
FILL = re.compile(r"^background(?:-color)?\s*:\s*var\(\s*--surface-card\s*\)")
RADIUS = re.compile(r"^border-radius\s*:\s*var\(\s*--r-lg\s*\)")
#: `.card`, `.card-head`, `.card-body` — and deliberately not `.card-grid`,
#: `.card-title` or `.card-cols2`, which are layout and type, not the frame
CARD_CLASS = re.compile(r"\.card(?:-head|-body)?(?![\w-])")
#: an exemption is honoured only when a reason follows the colon. The lookahead
#: is what makes that real: without it the comment's own `*/` reads as a reason,
#: and `/* card-frame-exempt: */` — the exact form of an exemption nobody could
#: justify — buys silence.
EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*(?!\*/)\S")

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


def is_frame(decls: list[str]) -> bool:
    """True when these declarations paint the card frame."""
    return any(FILL.match(d) for d in decls) and any(RADIUS.match(d) for d in decls)


def owns_frame(selector: str, path: Path) -> bool:
    """True when the block IS the card: the card's own class, in its own file."""
    return path.name == DEFINITION_SITE and bool(CARD_CLASS.search(selector))


def exempted(lines: list[str], first: int, last: int) -> bool:
    """True when the block, or the line above it, carries a pragma with a reason."""
    return any(EXEMPT.search(line) for line in lines[max(first - 2, 0) : last])


def check_file(path: Path) -> list[str]:
    """Return one complaint per card frame this stylesheet paints under its own name."""
    lines = path.read_text().splitlines()
    problems = []
    for selector, first, last, decls in rule_blocks(lines):
        if not is_frame(decls) or owns_frame(selector, path) or exempted(lines, first, last):
            continue
        problems.append(
            f"{path}:{first}: {selector} — repaints the card frame "
            f"(background: var(--surface-card) + border-radius: var(--r-lg)) under another name; "
            f"render it with Card from {OWNER}"
        )
    return problems


def main() -> int:
    problems: list[str] = []
    for name in sys.argv[1:]:
        problems.extend(check_file(Path(name)))
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} hand-rolled card frame(s). Render the card with Card from")
        print(f"{OWNER}, or mark the rule /* {PRAGMA} <reason> */ if the surface is not a card.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
