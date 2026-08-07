#!/usr/bin/env python3
"""Gate: every custom property is read, and every keyframe is animated.

The orphaned-class gate catches a class the JS names and no stylesheet
defines. The other direction — CSS that defines something nothing ever asks
for — has two shapes it can be caught in, because unlike a class name both are
spelled out in full on the consuming side:

- a ``--token: value`` that no ``var(--token)`` anywhere reads, and
- an ``@keyframes name`` that no ``animation`` declaration names.

Neither can hide behind an interpolated name the way a class can. A token is
read as the literal text ``var(--token)`` and a keyframe is named as a bare
word in an animation value, so a static reader sees every consumer there is,
and a reverse gate is sound here where it was not for classes.

JS counts as a consumer, both ways round: ``theme.js`` writes ``--accent`` and
``--accent-glow`` through ``style.setProperty``, and ``controls/index.js``
builds a gradient out of the string ``var(--accent)``. A gate reading only the
stylesheets would call those dead. Reading a property back with
``getPropertyValue("--x")`` counts too; writing one with ``setProperty`` does
not, because a value nobody ever reads is exactly what this gate is for.

Escape hatch: ``/* dead-exempt: <reason> */`` on the declaring line, the same
contract the token and card gates use — the reason is required. It is for a
name assembled at runtime, which no static reader can follow.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
STATIC = ROOT / "hqptuner" / "static"
PRAGMA = "dead-exempt:"

#: an exemption is honoured only when a reason follows the colon, the same
#: contract check_css_tokens.py enforces: without the lookahead the comment's
#: own `*/` reads as a reason and a blank exemption buys silence.
EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*(?!\*/)\S")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
#: a whole-line `//` comment: safe to strip, unlike a `//` inside a URL literal
LINE_COMMENT = re.compile(r"^[ \t]*//[^\n]*$", re.M)

#: a custom property being given a value — the declaring side
DECLARED = re.compile(r"(--[a-zA-Z_][\w-]*)\s*:")
#: a custom property being read — the consuming side, in CSS or in a JS string
USED = re.compile(r"var\(\s*(--[a-zA-Z_][\w-]*)")
#: reading a property back off a computed style, the only JS read that is not
#: spelled `var(--x)`
GET_PROPERTY = re.compile(r"getPropertyValue\(\s*[\"'](--[a-zA-Z_][\w-]*)[\"']")
KEYFRAMES = re.compile(r"@keyframes\s+([a-zA-Z_-][\w-]*)")
#: an animation shorthand or its name longhand; the value holds the keyframe
ANIMATION = re.compile(r"\banimation(?:-name)?\s*:\s*([^;}]+)")
#: a bare word in an animation value. Timing functions and keywords land here
#: too, which is harmless: they are matched against declared keyframe names.
WORD = re.compile(r"[a-zA-Z_-][\w-]*")


def blank_comments(text: str) -> str:
    """Drop comment prose while holding every line at its original number."""
    return BLOCK_COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def declarations(path: Path, pattern: re.Pattern[str]) -> dict[str, int]:
    """{name: line} for every ``pattern`` match in ``path``, exemptions skipped.

    The first declaration wins: a token redefined under a media query is one
    name with one home, and that home is where a reader would go to delete it.
    """
    found: dict[str, int] = {}
    text = path.read_text()
    raw = text.splitlines()
    for num, line in enumerate(blank_comments(text).splitlines(), 1):
        if EXEMPT.search(raw[num - 1]):
            continue
        for match in pattern.finditer(line):
            found.setdefault(match.group(1), num)
    return found


def read_properties(paths: list[Path]) -> set[str]:
    """Every custom property something reads, across CSS and JS alike."""
    names: set[str] = set()
    for path in paths:
        text = blank_comments(LINE_COMMENT.sub("", path.read_text()))
        names.update(USED.findall(text))
        names.update(GET_PROPERTY.findall(text))
    return names


def animated_names(paths: list[Path]) -> set[str]:
    """Every bare word an ``animation`` value names, across CSS and JS alike."""
    names: set[str] = set()
    for path in paths:
        for value in ANIMATION.findall(blank_comments(LINE_COMMENT.sub("", path.read_text()))):
            names.update(WORD.findall(re.sub(r"var\([^)]*\)", " ", value)))
    return names


def sources() -> tuple[list[Path], list[Path]]:
    """(stylesheets, every file that may consume what they declare)."""
    styles = sorted((STATIC / "css").glob("*.css"))
    scripts = sorted(p for p in STATIC.rglob("*.js") if "vendor" not in p.parts)
    return styles, styles + scripts


def problems() -> list[str]:
    """One complaint per declared name nothing consumes."""
    styles, consumers = sources()
    read, animated = read_properties(consumers), animated_names(consumers)
    found = []
    for path in styles:
        rel = path.relative_to(ROOT)
        for name, line in sorted(declarations(path, DECLARED).items()):
            if name not in read:
                found.append(f"{rel}:{line}: custom property {name} is read by no var({name})")
        for name, line in sorted(declarations(path, KEYFRAMES).items()):
            if name not in animated:
                found.append(f"{rel}:{line}: @keyframes {name} is named by no animation")
    return found


def main() -> int:
    """Refuse a custom property no var() reads and a keyframe no animation names."""
    found = problems()
    for problem in found:
        print(problem)
    if found:
        print(f"\n{len(found)} declaration(s) nothing consumes. Delete the dead CSS, or mark the")
        print(f"line /* {PRAGMA} <reason> */ if the name is assembled at runtime; the reason")
        print("is required.")
        return 1
    print("[ok] every custom property is read and every keyframe is animated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
