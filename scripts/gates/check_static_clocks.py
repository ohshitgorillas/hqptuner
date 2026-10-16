#!/usr/bin/env python3
"""Gate: no frontend code reaches the platform's clock except ``lib/clock.js``.

The gate reads each file it is handed and refuses every bare ``setTimeout``,
``setInterval``, ``requestAnimationFrame``, ``performance.now`` or ``Date.now``
under ``hqptuner/static/``, one problem per name, opening with
``<path>:<line>:`` and naming what it found. ``lib/clock.js`` holds the one
platform clock and ``vendor/`` is third-party; both are spared. Anything that
waits, repeats, animates or reads the time takes a Clock instead, so a test
drives it with a fake and never waits on wall time.

A name is bare when code names it, called or not: ``const t = setTimeout;``
hands out the platform clock as surely as a call does. A name read off an
object, ``clock.setTimeout`` or ``PLATFORM.now``, goes through an injected
clock and is not bare, except off ``window``, ``globalThis`` or ``self``, which
are the platform itself. A name inside a comment, a string or a regular
expression literal is text, not code, and is not reported.

Usage: ``python scripts/gates/check_static_clocks.py $(git ls-files 'hqptuner/static/*.js')``
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

#: The tree the gate judges, as a run of path components.
JUDGED = ("hqptuner", "static")

#: The platform clock module, as the path components it ends with.
CLOCK_MODULE = ("hqptuner", "static", "lib", "clock.js")

#: Third-party code, as a run of path components.
VENDOR = ("hqptuner", "static", "vendor")

#: The objects that are the platform itself, so a name read off one is still bare.
GLOBALS = frozenset({"window", "globalThis", "self"})

#: A refused name, standing alone as an identifier or a two-part member chain.
NAME = re.compile(
    r"(?<![\w$])(setTimeout|setInterval|requestAnimationFrame|performance\s*\.\s*now|Date\s*\.\s*now)(?![\w$])"
)

#: The object a name is read off, at the end of the code before the name.
OWNER = re.compile(r"(?:(?<![\w$.])([\w$]+)\s*)?\??\.\s*$")

#: How far back of a name the gate looks for the object it is read off.
OWNER_REACH = 64

#: Plain code, up to the next character that may open a literal or a comment or move a brace.
CODE = re.compile(r"[^'\"`/{}]+|[{}]")

#: A single- or double-quoted string, to its closing quote or the end of the line.
QUOTED = {
    "'": re.compile(r"'(?:\\.|[^'\\\n])*'?"),
    '"': re.compile(r'"(?:\\.|[^"\\\n])*"?'),
}

#: A comment of either kind, an unterminated block comment running to the end.
COMMENTS = (re.compile(r"//[^\n]*"), re.compile(r"/\*.*?(?:\*/|\Z)", re.DOTALL))

#: Template literal text, from inside the literal to its close, an opened substitution, or the end.
TEMPLATE_TEXT = re.compile(r"(?:\\.|[^`\\$]|\$(?!\{))*(?:`|\$\{|\Z)", re.DOTALL)

#: A regular expression literal, on one line.
REGEX_LITERAL = re.compile(r"/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n\[])+/[A-Za-z]*")

#: Characters after which a ``/`` opens a regular expression rather than divides.
REGEX_AFTER = frozenset("(,=:[!&|?{};+-*%<>~^")

#: Keywords after which a ``/`` opens a regular expression rather than divides.
REGEX_KEYWORD = re.compile(
    r"(?<![\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$"
)

#: What the code before a literal value reads as, once the literal is masked.
VALUE = "0"

#: Marks a ``{`` that opened a template substitution, whose ``}`` resumes the template.
SUBSTITUTION = "`"


def blank(text: str) -> str:
    """Spaces in place of every character but a newline, so offsets and line numbers hold."""
    return re.sub(r"[^\n]", " ", text)


class Masker:
    """Blanks every comment and every string, template and regex literal's text in a JavaScript source."""

    def __init__(self, source: str) -> None:
        """Start at the top of ``source``, outside any literal or brace."""
        self.source = source
        self.pos = 0
        self.out: list[str] = []
        self.braces: list[str] = []
        self.tail = ""

    def run(self) -> str:
        """Return the source with only its code left standing."""
        while self.pos < len(self.source):
            self.step()
        return "".join(self.out)

    def step(self) -> None:
        """Consume the literal, comment or run of code at the current position."""
        char = self.source[self.pos]
        if char == "`" or (char == "}" and self.braces[-1:] == [SUBSTITUTION]):
            self.template(char)
        elif char in QUOTED:
            self.literal(QUOTED[char].match(self.source, self.pos))
        elif char == "/":
            self.slash()
        else:
            self.code()

    def emit(self, text: str) -> None:
        """Keep code as written, and remember how it ends."""
        self.out.append(text)
        self.pos += len(text)
        self.tail = (self.tail + text).rstrip()[-OWNER_REACH:]

    def literal(self, match: re.Match[str] | None) -> None:
        """Blank a literal or comment that starts here; a literal reads as a value to what follows."""
        text = match.group() if match else self.source[self.pos]
        self.out.append(blank(text))
        self.pos += len(text)
        if not text.startswith(("//", "/*")):
            self.tail = VALUE

    def template(self, opener: str) -> None:
        """Keep a template's delimiters and blank its text, up to its close or its next substitution."""
        if opener == "}":
            self.braces.pop()
        self.emit(opener)
        match = TEMPLATE_TEXT.match(self.source, self.pos)
        text = match.group() if match else ""
        closer = next((end for end in ("`", "${") if text.endswith(end)), "")
        self.out.append(blank(text[: len(text) - len(closer)]))
        self.pos += len(text) - len(closer)
        self.emit(closer)
        if closer == "${":
            self.braces.append(SUBSTITUTION)
        else:
            self.tail = VALUE

    def slash(self) -> None:
        """Blank a comment or regular expression that opens here, or keep a division."""
        for pattern in COMMENTS:
            match = pattern.match(self.source, self.pos)
            if match:
                self.literal(match)
                return
        match = REGEX_LITERAL.match(self.source, self.pos) if self.regex_allowed() else None
        if match:
            self.literal(match)
        else:
            self.emit("/")

    def regex_allowed(self) -> bool:
        """Whether a ``/`` here opens a regular expression, judged by the code before it."""
        return not self.tail or self.tail[-1] in REGEX_AFTER or bool(REGEX_KEYWORD.search(self.tail))

    def code(self) -> None:
        """Keep a run of code, tracking the braces that a template substitution closes on."""
        match = CODE.match(self.source, self.pos)
        text = match.group() if match else self.source[self.pos]
        if text == "{":
            self.braces.append(text)
        elif text == "}" and self.braces:
            self.braces.pop()
        self.emit(text)


def bare(code: str, start: int) -> bool:
    """Whether the name at ``start`` is the platform's own, rather than read off an injected clock."""
    owner = OWNER.search(code[max(0, start - OWNER_REACH) : start])
    return owner is None or owner.group(1) in GLOBALS


def judged(path: Path) -> bool:
    """Whether the file sits under ``hqptuner/static/``, outside the clock module and vendor code."""
    parts = path.parts

    def holds(run: tuple[str, ...]) -> bool:
        return any(parts[i : i + len(run)] == run for i in range(len(parts)))

    return holds(JUDGED) and not holds(VENDOR) and parts[-len(CLOCK_MODULE) :] != CLOCK_MODULE


def check_file(path: Path) -> list[str]:
    """Every bare clock name in one file, in source order."""
    code = Masker(path.read_text(encoding="utf-8")).run()
    return [problem(path, code, match) for match in NAME.finditer(code) if bare(code, match.start())]


def problem(path: Path, code: str, match: re.Match[str]) -> str:
    """Return the report line for one bare name: where it is and what it is."""
    line = code.count("\n", 0, match.start()) + 1
    name = re.sub(r"\s", "", match.group(1))
    return f"{path}:{line}: bare {name}; take a Clock (lib/clock.js) instead"


def main(argv: list[str]) -> int:
    """Refuse any bare clock name in the files handed over that the gate judges."""
    problems = [problem for path in map(Path, argv) if path.is_file() and judged(path) for problem in check_file(path)]
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        print(
            f"\n{len(problems)} bare clock(s) under hqptuner/static/; anything that waits, repeats, animates"
            " or reads the time takes a Clock, and only lib/clock.js reaches the platform's own",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
