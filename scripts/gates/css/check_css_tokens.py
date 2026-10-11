#!/usr/bin/env python3
"""Gate: a faceplate stylesheet uses tokens (docs/spec/design-system.md).

- no raw color outside tokens.css, on any property, custom ones included;
- ``line-height`` is never ``normal``: it follows each font file's metrics,
  which differ by browser, and moves text off the plate;
- ``font-family`` names a ``--f-*`` token;
- a ``transition`` or ``animation`` carries no literal duration: it is
  ``none`` or it names a motion token;
- no literal size on any property, custom ones included: a non-zero px, rem
  or em length is refused wherever it sits in the value, inside ``calc()``,
  a transform or a shorthand alike, and so is a bare number on
  ``font-weight`` or ``opacity`` other than an opacity of ``0`` or ``1``.
  Zero in any unit, a percentage, ``var()``, ``auto``, ``none`` and the
  CSS-wide keywords carry no size and stay legal.

A declaration breaking more than one rule is one complaint.

Escape hatch: put `/* token-exempt: <reason> */` on the offending line. It
must carry a reason — an exemption you cannot justify in a clause is a
value that belongs in tokens.css.
"""

import re
import sys
from pathlib import Path

#: the file allowed to hold literals — it is where the tokens are defined
DEFINITION_SITE = "tokens.css"
PRAGMA = "token-exempt:"

#: an exemption is honoured only when a reason follows the colon, the same
#: contract check_css_cards.py enforces. The lookahead is what makes it real:
#: without it the comment's own `*/` reads as a reason, and
#: `/* token-exempt: */` — the form of an exemption nobody could justify —
#: buys silence.
EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*(?!\*/)\S")
#: CSS-wide keywords: legal anywhere, they name no value of their own
CSS_WIDE = frozenset({"inherit", "initial", "unset", "revert"})
#: a literal time — what a faceplate transition or animation may not carry
DURATION = re.compile(r"(?<![\w-])[\d.]+m?s\b")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
DECL = re.compile(r"(--)?([a-zA-Z][\w-]*)\s*:\s*(.+)", re.DOTALL)

#: (line the declaration starts on, custom property?, property, value)
Declaration = tuple[int, bool, str, str]
COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
#: a px, rem or em length; the lookbehind keeps a digit inside a name or a
#: longer number from starting a match of its own
LENGTH = re.compile(r"(?<![\w.-])-?(\d*\.?\d+)(?:px|rem|em)\b", re.IGNORECASE)
NUMBER = re.compile(r"-?\d*\.?\d+")
#: properties whose bare number is a design value: a weight or a shade
NUMERIC_PROPS = frozenset({"font-weight", "opacity"})
#: fully hidden and fully painted carry no shading decision
OPACITY_OK = frozenset({0.0, 1.0})


def literal_size(prop: str, value: str) -> bool:
    """Report whether a value spends a size that belongs in tokens.css.

    Any non-zero px, rem or em length counts, wherever it sits in the value,
    and so does a bare number on a property that takes one as its design value.
    """
    if any(float(match.group(1)) for match in LENGTH.finditer(value)):
        return True
    if prop not in NUMERIC_PROPS or not NUMBER.fullmatch(value):
        return False
    return prop != "opacity" or float(value) not in OPACITY_OK


def faceplate_complaint(prop: str, value: str) -> str:
    """Return a complaint about one faceplate declaration, or '' if it is clean."""
    if COLOUR.search(value):
        return f"{prop}: {value} — use a color token from {DEFINITION_SITE}"
    if literal_size(prop, value):
        return f"{prop}: {value} — name a size, space, weight or opacity token from {DEFINITION_SITE}"
    if prop == "line-height" and value == "normal":
        return f"{prop}: {value} — pin it: var(--lh-eng), var(--lh-text) or a number"
    if prop == "font-family" and value not in CSS_WIDE and not value.startswith("var(--f-"):
        return f"{prop}: {value} — name a --f-* family token from {DEFINITION_SITE}"
    if prop.startswith(("transition", "animation")) and DURATION.search(value):
        return f"{prop}: {value} — name a motion token from {DEFINITION_SITE}"
    return ""


def statements(text: str) -> list[tuple[int, str, str]]:
    """Return (start line, text, terminator) for every run of CSS between `{`, `}` and `;`.

    A terminator inside parentheses or a quoted string belongs to the value
    holding it, so a data URL or a `content` string is one statement.
    """
    found: list[tuple[int, str, str]] = []
    line, start, parens, quote, current = 1, 1, 0, "", ""
    for char in text:
        if quote:
            quote = "" if char == quote else quote
        elif char in "\"'":
            quote = char
        elif char in "()":
            parens += 1 if char == "(" else -1
        elif char in "{};" and not parens:
            found.append((start, current.strip(), char))
            current = ""
            continue
        if not current.strip():
            start = line
        current += char
        line += char == "\n"
    return found


def declarations(text: str) -> list[Declaration]:
    """Return every declaration in a stylesheet, however many share a line.

    A statement is a declaration when it sits inside a block and does not open
    one: `a:hover {` ends in a brace and is a selector, and anything at depth
    zero is an at-rule.
    """
    found: list[Declaration] = []
    depth = 0
    blanked = BLOCK_COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)
    for line, body, terminator in statements(blanked):
        match = DECL.fullmatch(body) if depth and terminator != "{" else None
        if match is not None:
            found.append((line, bool(match.group(1)), match.group(2), " ".join(match.group(3).split())))
        depth += (terminator == "{") - (terminator == "}")
    return found


def check_file(path: Path) -> list[str]:
    """Return one complaint per offending declaration in ``path``."""
    text = path.read_text()
    lines = text.splitlines()
    problems = []
    for num, _custom, prop, value in declarations(text):
        if EXEMPT.search(lines[num - 1]):
            continue
        if complaint := faceplate_complaint(prop, value):
            problems.append(f"{path}:{num}: {complaint}")
    return problems


def main() -> int:
    """Refuse a CSS value off the faceplate's tokens."""
    problems: list[str] = []
    for name in sys.argv[1:]:
        path = Path(name)
        if path.name != DEFINITION_SITE:
            problems.extend(check_file(path))
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} value(s) off the tokens. Add the value to tokens.css, or mark the line")
        print(f"/* {PRAGMA} <reason> */; the reason is required.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
