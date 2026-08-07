#!/usr/bin/env python3
"""Gate: every class named in JS has a selector in the stylesheets.

A class name is a string on one side and a selector on the other, and nothing
checked that the pair still met. The Crossfeed Response disclosure shipped
markup whose class no stylesheet defined: the gates were green, the page
rendered, and the styling silently did nothing. Nine such classes were live
when this gate was written, including a three-key legend where only the middle
key had a rule.

The frontend is declarative htm+preact — there is no ``classList``, no
``className`` and no ``setAttribute("class")`` anywhere — so every class
reaches the DOM through a ``class=`` attribute or a helper feeding one. That is
what makes a static reader possible at all. The reader takes the literal tokens
out of a ``class=`` value, and follows a bare identifier in that value one level
to its declaration in the same file (``class=${cls}``,
``class=${fieldClasses(entry, k)}``).

Two things are deliberately out of scope, because the name only exists at
runtime: an interpolated class (``vr-${which}``, ``alert-${a.sev}``) — the
prefix is real but the whole name is not knowable here — and a class read off
an object (``class=${z.cls}``), whose literal lives in a data table rather than
in class position.

The reverse direction — a selector no JS names — is NOT checked, and cannot be.
``class="swatch ${a}"`` names a class with no literal prefix at all, so the
accent swatches ``.blue`` / ``.green`` / ``.amber`` / ``.violet`` are reachable while looking
dead. A reverse gate would fail on live styling.

Escape hatch: ``// class-exempt: <reason>`` on the offending line or the one
above it, same contract as the token gate — the reason is required. It is for a
class that is a *hook* rather than styling: the collapse marker a test reads
back is the case it was written for.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
STATIC = ROOT / "hqptuner" / "static"
PRAGMA = "class-exempt:"
#: stands in for a ${...} run while a class value is split into words
HOLE = "\x00"

#: kebab-lowercase — the shape every class in this codebase has
TOKEN = re.compile(r"^[a-z][a-z0-9-]*$")
#: a whole-line `//` comment: safe to strip, unlike a `//` inside a URL literal
LINE_COMMENT = re.compile(r"^[ \t]*//[^\n]*$", re.M)
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
STRING = re.compile(r"\"([^\"\n]*)\"|'([^'\n]*)'|`([^`]*)`", re.S)
IDENT = re.compile(r"[A-Za-z_$][\w$]*")
DECL = re.compile(r"\b(?:const|let|var|function)\s+")
#: a literal being compared is a value, not a class: `entry.size === "lg"`
COMPARISON = re.compile(r"[=!]=\s*$")


def decomment(src: str) -> str:
    r"""Drop comment prose, which is full of words shaped like class names.

    Line NUMBERS have to survive this, because the ``class-exempt`` pragma is
    matched against the offending line and the one above it. ``LINE_COMMENT``
    already preserves them (its ``[^\n]*`` never eats the newline), but a block
    comment spans lines, so substituting it with ``""`` collapsed every one of
    them and shifted the rest of the file upward. A file carrying a 20-line
    JSDoc block then reported a hit 20 lines above where it really was, the
    two-line pragma window looked at the wrong place, and a correctly exempted
    class failed the gate. Replace each block with its own newlines instead.
    """

    def keep_lines(match: re.Match[str]) -> str:
        return "\n" * match.group(0).count("\n")

    return BLOCK_COMMENT.sub(keep_lines, LINE_COMMENT.sub("", src))


def attr_end(src: str, start: int) -> int:
    """Index of the quote closing the attribute opened at ``start``, ${} aware."""
    quote, depth, i = src[start], 0, start + 1
    while i < len(src):
        if depth == 0 and src[i] == quote:
            return i
        if src.startswith("${", i):
            depth += 1
            i += 2
            continue
        if depth and src[i] == "{":
            depth += 1
        elif depth and src[i] == "}":
            depth -= 1
        i += 1
    return len(src)


def brace_end(src: str, start: int) -> int:
    """Index of the brace closing the ``${`` that begins at ``start``."""
    depth, i = 0, start + 1
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(src)


def class_sites(src: str) -> list[tuple[int, str]]:
    """(offset, raw value) for every ``class=`` attribute in the source."""
    sites = []
    for match in re.finditer(r"\bclass=", src):
        i = match.end()
        if i < len(src) and src[i] in "\"'":
            sites.append((match.start(), src[i + 1 : attr_end(src, i)]))
        elif src.startswith("${", i):
            # keep the ${} on: the value is an expression, and stripping the
            # delimiters would read the bare identifier in `class=${cls}` as a
            # literal class named "cls".
            sites.append((match.start(), src[i : brace_end(src, i) + 1]))
    return sites


def literal_tokens(text: str, depth: int = 2) -> set[str]:
    """Class-shaped words from every string literal in ``text``, nested included.

    A literal on the right of a comparison is skipped: ``entry.size === "lg"``
    tests a value, it does not name a class.
    """
    tokens: set[str] = set()
    for match in STRING.finditer(text):
        if COMPARISON.search(text[: match.start()]):
            continue
        inner = next(group for group in match.groups() if group is not None)
        tokens.update(word for word in inner.split() if TOKEN.match(word))
        if depth:
            tokens |= literal_tokens(inner, depth - 1)
    return tokens


def split_value(value: str) -> tuple[str, list[str]]:
    """Return a class value as (text with each ``${...}`` holed out, the runs removed)."""
    runs: list[str] = []
    bare, i = "", 0
    while i < len(value):
        if value.startswith("${", i):
            end = brace_end(value, i)
            runs.append(value[i + 2 : end])
            bare += HOLE
            i = end + 1
        else:
            bare += value[i]
            i += 1
    return bare, runs


def value_tokens(value: str) -> tuple[set[str], set[str]]:
    """(literal classes, identifiers worth following) for one ``class=`` value."""
    bare, runs = split_value(value)
    tokens: set[str] = set()
    follow: set[str] = set()
    taken = 0
    for word in bare.split():
        holes = word.count(HOLE)
        mine = runs[taken : taken + holes]
        taken += holes
        if not holes:
            if TOKEN.match(word):
                tokens.add(word)
        elif not word.replace(HOLE, ""):
            # a whole word built by interpolation: its literals and helpers are
            # in play. A word with text glued on (`vr-${which}`) is not — that
            # name is only knowable at runtime.
            for run in mine:
                tokens |= literal_tokens(run)
                follow.update(IDENT.findall(run))
    return tokens, follow


def declaration(src: str, name: str) -> tuple[str, int]:
    """(source, offset) of ``name``'s declaration, up to its first flat newline."""
    match = re.search(DECL.pattern + re.escape(name) + r"\b", src)
    if match is None:
        return "", 0
    depth, i = 0, match.end()
    while i < len(src):
        if src[i] in "{([":
            depth += 1
        elif src[i] in "})]":
            depth -= 1
        elif src[i] == "\n" and depth <= 0:
            return src[match.start() : i], match.start()
        i += 1
    return src[match.start() :], match.start()


def named_classes(src: str) -> dict[str, int]:
    """{class: line} for every class one JS source names in class position.

    A class written in a helper is reported at the helper's line, not at the
    ``class=${…}`` that uses it. That is where a reader would go to change it,
    and it is the only line an exemption can sit on: a comment inside the
    template markup would render as visible text.
    """
    found: dict[str, int] = {}
    code = decomment(src)
    lines = src.splitlines()

    def keep(tokens: set[str], line: int) -> None:
        """Record ``tokens`` at ``line``, unless that line is exempted."""
        context = lines[max(line - 2, 0) : line]
        if any(PRAGMA in text for text in context):
            return
        for token in tokens:
            found.setdefault(token, line)

    for offset, value in class_sites(code):
        tokens, follow = value_tokens(value)
        keep(tokens, code.count("\n", 0, offset) + 1)
        for name in follow:
            body, at = declaration(code, name)
            first = code.count("\n", 0, at) + 1
            for number, text in enumerate(body.splitlines()):
                keep(literal_tokens(text), first + number)
    return found


def css_classes(paths: list[Path]) -> set[str]:
    """Every class the stylesheets define a rule for."""
    names: set[str] = set()
    for path in paths:
        text = BLOCK_COMMENT.sub("", path.read_text())
        for prelude in re.finditer(r"^[^{}]*\{", text, re.M):
            names.update(re.findall(r"\.([a-zA-Z_][\w-]*)", prelude.group(0)))
    return names


def main() -> int:
    """Refuse a class name written in JS that no stylesheet in static/css/ defines a rule for."""
    styled = css_classes(sorted((STATIC / "css").glob("*.css")))
    sources = sorted(p for p in STATIC.rglob("*.js") if "vendor" not in p.parts)
    problems = []
    for path in sources:
        for name, line in sorted(named_classes(path.read_text()).items()):
            if name not in styled:
                rel = path.relative_to(ROOT)
                problems.append(f'{rel}:{line}: class "{name}" has no selector in static/css/')
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} class name(s) with no rule. Add the rule, drop the class,")
        print(f"or mark the line /* {PRAGMA} <reason> */ if the class is a hook, not styling.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
