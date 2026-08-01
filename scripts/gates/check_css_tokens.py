#!/usr/bin/env python3
"""Gate: static CSS uses tokens, never literal type, colour, shape, space, or shading.

The stylesheet had drifted to 24 free-chosen font-size values and five
different effective text greys (two colour tokens times three opacities).
New text landed looking out of place because nothing said which value to
pick. tokens.css now owns the ladder; this gate keeps it that way.

It also holds the rhythm tokens to one mechanism, which is a different kind of
rule: not "which value" but "which property may spend it". Space between
siblings has two mechanisms in CSS — the container's `gap` and the child's
margin — and when both are used they do not override, they add. `.top-row`
carried `margin-bottom: var(--sp-4)` under a `.tab-body` already spending an
8px gap, so the space under the hero cards was 32px against every other card
pair's 8px; `.card-grid`'s `margin-top` did the same at 16px. Nothing about
either rule looks wrong on its own — both are tokenised, both name a step on
the scale — and the same bug was found and fixed by eye twice before that
(narrowing.css, controls.css). It is not catchable by reading one rule, so it
is a gate:

- a `--rhythm-*` token is legal on `gap` / `row-gap` / `column-gap` and
  nowhere else, and
- no vertical margin may spend a spacing token at all. Between siblings the
  container's gap is the only mechanism.

A vertical margin may still be `0` or `auto`; a literal length was already
rejected by the spacing rule above. Horizontal margins are untouched — they
centre things and inset the chrome rows, and no gap competes with them.

Escape hatch: put `/* token-exempt: <reason> */` on the offending line. It
must carry a reason — an exemption you cannot justify in a clause is a
value that belongs in tokens.css. For a vertical margin the clause has to say
why the space is not between siblings, because if it is, it is the gap's.
"""

import re
import sys
from pathlib import Path

#: properties whose value must be a var(--…) reference
TOKEN_PROPS = ("font-size", "font-weight", "letter-spacing")
#: properties that paint a surface — the value must name a role, not a shade
FILL_PROPS = ("background", "background-color")
#: CSS-wide keywords, plus bare zero, that carry no design decision
LITERAL_OK = frozenset({"inherit", "initial", "unset", "revert", "normal", "0"})
#: painting nothing is a legal fill — it names no shade, so it cannot drift
FILL_OK = LITERAL_OK | {"none", "transparent"}
#: the file allowed to hold literals — it is where the tokens are defined
DEFINITION_SITE = "tokens.css"
PRAGMA = "token-exempt:"

#: an exemption is honoured only when a reason follows the colon, the same
#: contract check_css_cards.py enforces. The lookahead is what makes it real:
#: without it the comment's own `*/` reads as a reason, and
#: `/* token-exempt: */` — the form of an exemption nobody could justify —
#: buys silence.
EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*(?!\*/)\S")
#: the only properties a --rhythm-* token may appear on
GAP_PROPS = frozenset({"gap", "row-gap", "column-gap"})
#: a rhythm role, spendable on a gap and nothing else
RHYTHM_TOKEN = re.compile(r"var\(\s*--rhythm-")
#: the rhythm scale, in either form — what a vertical margin may not spend
SPACING_TOKEN = re.compile(r"var\(\s*--(?:sp-\d|rhythm-)")
#: margin properties that set space above or below. The shorthands need their
#: components picked apart (see vertical_parts); the longhands are wholly
#: vertical. margin-left/right/inline are absent on purpose: nothing competes
#: with them, so `margin: 0 var(--gutter)` on a chrome row stays legal.
VERTICAL_MARGINS = frozenset({"margin-top", "margin-bottom", "margin-block-start", "margin-block-end"})
MARGIN_SHORTHANDS = frozenset({"margin", "margin-block"})

DECL = re.compile(r"^\s*(--)?([a-z-]+)\s*:\s*([^;]+);")
COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
#: the raw elevation ladder — legal only where it is defined
PRIMITIVE = re.compile(r"var\(\s*--bg\b")
#: the two motion roles: --dur for a state change, --sweep for a live readout
MOTION = re.compile(r"var\(\s*--(?:dur|sweep)\b")
#: opacity answers two questions — is this control in play (state), and how far
#: back does this graphic sit (depth). Both are roles, so both are tokens. 0 and
#: 1 stay literal: hidden and fully painted carry no shading decision.
OPACITY_OK = LITERAL_OK | {"1"}
OPACITY_TOKEN = re.compile(r"var\(\s*--o-")
#: any bare length — the thing a spacing value may never contain. Checking for a
#: literal (rather than requiring every component to be a token) is what lets
#: `0`, `auto`, and calc() arithmetic like `calc(var(--sp-3) * 1.1)` through: a
#: multiplier carries no unit, so it is not a length.
LENGTH = re.compile(r"[\d.]+(?:rem|em|px|ch|vh|vw|pt|%)")
#: every token a fill may name: the four surface roles, plus the state colours
FILL_TOKEN = re.compile(
    r"var\(\s*--(?:surface-(?:page|card|raised|well)|accent(?:-glow)?|on-accent"
    r"|line|dirty|muted|fg|green|amber|red|warn|thumb-bg)\b"
)


def shape_complaint(prop: str, value: str) -> str:
    """Return a complaint about a radius or transition declaration, or ''.

    Radius checks every corner in the value, not just the first: a shorthand
    may round some corners and square others, and `var(--r-md) 6px` is exactly
    the drift the ladder exists to stop. Transition only has to *name* a motion
    token — the rest of the value is property names and cannot drift.
    """
    if prop.endswith("radius"):
        if all(corner.startswith("var(--") or corner == "0" for corner in value.split()):
            return ""
        return f"{prop}: {value} — use a var(--r-*) token from {DEFINITION_SITE}"
    if prop == "transition" and not MOTION.search(value):
        return f"{prop}: {value} — use var(--dur) var(--ease) for a state change, var(--sweep) for a live readout"
    return ""


def is_spacing(prop: str) -> bool:
    """True for the properties that carry the page's rhythm."""
    return prop == "gap" or prop.endswith("-gap") or prop.startswith(("margin", "padding"))


def components(value: str) -> list[str]:
    """A shorthand's values, split on whitespace but never inside parentheses.

    `calc(-1 * var(--sp-1)) 0 var(--sp-1)` is three components, not five: a
    naive split would tear the calc() apart and read its interior as siblings.
    """
    parts: list[str] = []
    depth, current = 0, ""
    for char in value:
        if char.isspace() and not depth:
            if current:
                parts.append(current)
            current = ""
            continue
        depth += (char == "(") - (char == ")")
        current += char
    return parts + ([current] if current else [])


def vertical_parts(prop: str, value: str) -> list[str]:
    """The components of one declaration that set space above or below.

    Empty for anything horizontal, which is how `margin: 0 var(--gutter)` — the
    chrome rows' own inset — stays clear of a rule about sibling rhythm.
    """
    if prop in VERTICAL_MARGINS:
        return [value]
    if prop not in MARGIN_SHORTHANDS:
        return []
    parts = components(value)
    if prop == "margin-block":  # both components are vertical
        return parts
    # 1 value sets all four sides, 2 sets vertical then horizontal, 3 and 4 set
    # top and bottom at positions 0 and 2.
    return parts[:1] if len(parts) < 3 else [parts[0], parts[2]]


def rhythm_complaint(prop: str, value: str, custom: bool) -> str:
    """Return a complaint about a misspent rhythm token, or ''.

    The first half applies to a custom property too: re-exporting the role
    under a local name (`--my-gap: var(--rhythm-row)`) is how a one-mechanism
    rule gets a second mechanism back. The second half cannot — a custom
    property called `--margin-top` sets no margin.
    """
    if RHYTHM_TOKEN.search(value) and prop not in GAP_PROPS:
        return f"{prop}: {value} — a --rhythm-* token is a container's gap; it cannot be spent on {prop}"
    if not custom and any(SPACING_TOKEN.search(part) for part in vertical_parts(prop, value)):
        return (
            f"{prop}: {value} — vertical space between siblings comes from the "
            f"container's gap, which this adds to rather than replaces; set the "
            f"gap on the parent"
        )
    return ""


def check_decl(prop: str, value: str, custom: bool) -> str:
    """Return a complaint about one declaration, or '' if it is clean."""
    literal = not value.startswith("var(--") and value not in LITERAL_OK
    if complaint := rhythm_complaint(prop, value, custom):
        return complaint
    if not custom and (complaint := shape_complaint(prop, value)):
        return complaint
    if not custom and is_spacing(prop) and LENGTH.search(value):
        return f"{prop}: {value} — use a var(--sp-*) token from {DEFINITION_SITE}"
    if prop == "opacity" and not custom and value not in OPACITY_OK and not OPACITY_TOKEN.search(value):
        return f"{prop}: {value} — use a var(--o-*) token from {DEFINITION_SITE}"
    if prop in TOKEN_PROPS and not custom and literal:
        return f"{prop}: {value} — use a var(--fs-*|--fw-*|--track-*) token"
    if not custom and COLOUR.search(value):
        return f"{prop}: {value} — use a colour token from {DEFINITION_SITE}"
    if PRIMITIVE.search(value):
        return f"{prop}: {value} — --bg* is a raw shade; name a --surface-* role"
    if prop in FILL_PROPS and value not in FILL_OK and not FILL_TOKEN.search(value):
        return f"{prop}: {value} — a fill must reference a --surface-* or state token"
    return ""


def check_file(path: Path) -> list[str]:
    """Return one complaint per offending line in ``path``."""
    problems = []
    for num, line in enumerate(path.read_text().splitlines(), 1):
        if EXEMPT.search(line):
            continue
        match = DECL.match(line)
        if match is None:
            continue
        complaint = check_decl(match.group(2), match.group(3).strip(), bool(match.group(1)))
        if complaint:
            problems.append(f"{path}:{num}: {complaint}")
    return problems


def main() -> int:
    problems: list[str] = []
    for name in sys.argv[1:]:
        path = Path(name)
        if path.name != DEFINITION_SITE:
            problems.extend(check_file(path))
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} value(s) off the ladder. Add the value to tokens.css — or, for a")
        print("vertical margin, move the space to the parent's gap, which is the one mechanism")
        print(f"for it. Mark the line /* {PRAGMA} <reason> */ if neither applies; the reason is")
        print("required, and for a margin it has to say why the space is not between siblings.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
