#!/usr/bin/env python3
"""Gate: every element that renders a staged edit is marked in a stylesheet.

A template that sets ``data-dirty=`` on an element says the element carries a
staged edit; the dirty dot is what shows it (docs/spec/design-system.md, Accent).
The attribute alone paints nothing, so a producer whose class no stylesheet
pairs with ``[data-dirty]`` ships an edit the user cannot see.

A producer is marked when one compound selector names both its class and
``[data-dirty]``: ``.drow[data-dirty]`` or ``.drow[data-dirty]::after``. A
descendant or child selector (``.drow [data-dirty]``) marks a different
element.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
STATIC = ROOT / "hqptuner" / "static"

#: where a tag opens: a literal name or an interpolated component, ``<${X}``
TAG_OPEN = re.compile(r"<(?=[a-zA-Z]|\$\{)")
PRODUCER = re.compile(r"\bdata-dirty=")
CLASS_ATTR = re.compile(r"""\bclass=(["'])\s*([\w-]+)""")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
PRELUDE = re.compile(r"([^{}]*)\{")
COMBINATOR = re.compile(r"\s*[>+~]\s*|\s+")
DIRTY_ATTR = "[data-dirty]"


def skip_string(src: str, i: int) -> int:
    """Return the index just past the string literal opening at ``src[i]``."""
    quote = src[i]
    i += 1
    while i < len(src) and src[i] != quote:
        if src[i] == "\\":
            i += 1
        elif quote == "`" and src.startswith("${", i):
            i = skip_expr(src, i + 2) - 1
        i += 1
    return i + 1


def skip_expr(src: str, i: int) -> int:
    """Return the index just past the ``}`` closing a ``${`` whose body starts at ``i``."""
    depth = 1
    while i < len(src):
        ch = src[i]
        if ch in "\"'`":
            i = skip_string(src, i)
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def tag_end(src: str, start: int) -> int:
    """Return the index of the ``>`` closing the tag that opens at ``start``."""
    i = start + 1
    while i < len(src):
        if src.startswith("${", i):
            i = skip_expr(src, i + 2)
            continue
        if src[i] in "\"'":
            i = skip_string(src, i)
            continue
        if src[i] == ">":
            return i
        i += 1
    return i


def producers(src: str) -> list[tuple[int, str]]:
    """Return (line of the opening ``<``, first class token) for every tag carrying ``data-dirty=``."""
    found = []
    for match in TAG_OPEN.finditer(src):
        tag = src[match.start() : tag_end(src, match.start())]
        cls = CLASS_ATTR.search(tag)
        if PRODUCER.search(tag) and cls:
            found.append((src.count("\n", 0, match.start()) + 1, cls.group(2)))
    return found


def marked_classes(css: str) -> set[str]:
    """Return every class one compound selector pairs with ``[data-dirty]``."""
    names: set[str] = set()
    for prelude in PRELUDE.finditer(BLOCK_COMMENT.sub("", css)):
        for selector in prelude.group(1).split(","):
            for compound in COMBINATOR.split(selector.strip()):
                if DIRTY_ATTR in compound:
                    names.update(re.findall(r"\.([\w-]+)", compound))
    return names


def unmarked(js: dict[str, str], css: str) -> list[tuple[str, int, str]]:
    """Return (path, line, class) for every producer no stylesheet marks, in source order."""
    marked = marked_classes(css)
    return [(path, line, cls) for path, src in js.items() for line, cls in producers(src) if cls not in marked]


def main() -> int:
    """Refuse a ``data-dirty`` producer under static/ that no stylesheet in static/css/ marks."""
    css = "\n".join(p.read_text() for p in sorted((STATIC / "css").rglob("*.css")))
    sources = sorted(p for p in STATIC.rglob("*.js") if "vendor" not in p.parts)
    js = {str(p.relative_to(ROOT)): p.read_text() for p in sources}
    problems = unmarked(js, css)
    for path, line, cls in problems:
        print(f'{path}:{line}: class "{cls}" sets data-dirty but no .{cls}{DIRTY_ATTR} rule marks it')
    if problems:
        print(f"\n{len(problems)} staged-edit producer(s) with no mark. Add the rule to static/css/.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
