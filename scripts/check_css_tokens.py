#!/usr/bin/env python3
"""Gate: static CSS uses design tokens, never literal type or colour values.

The stylesheet had drifted to 24 free-chosen font-size values and five
different effective text greys (two colour tokens times three opacities).
New text landed looking out of place because nothing said which value to
pick. tokens.css now owns the ladder; this gate keeps it that way.

Escape hatch: put `/* token-exempt: <reason> */` on the offending line. It
must carry a reason — an exemption you cannot justify in a clause is a
value that belongs in tokens.css.
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

DECL = re.compile(r"^\s*(--)?([a-z-]+)\s*:\s*([^;]+);")
COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
#: the raw elevation ladder — legal only where it is defined
PRIMITIVE = re.compile(r"var\(\s*--bg\b")
#: every token a fill may name: the four surface roles, plus the state colours
FILL_TOKEN = re.compile(
    r"var\(\s*--(?:surface-(?:page|card|raised|well)|accent(?:-glow)?|on-accent"
    r"|line|dirty|muted|fg|green|amber|red|warn|thumb-bg)\b"
)


def check_decl(prop: str, value: str, custom: bool) -> str:
    """Return a complaint about one declaration, or '' if it is clean."""
    literal = not value.startswith("var(--") and value not in LITERAL_OK
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
        if PRAGMA in line:
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
        print(f"\n{len(problems)} untokenised value(s). Add the value to tokens.css,")
        print(f"or mark the line /* {PRAGMA} <reason> */ if it genuinely cannot be one.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
