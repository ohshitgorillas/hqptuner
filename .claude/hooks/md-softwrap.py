#!/usr/bin/env python3
"""Soft-wrap enforcement for Markdown.

Project rule: documentation is soft-wrapped. One paragraph, list item, or
blockquote is one logical line; wrapping is the viewer's job, not the author's.
Hard-wrapped prose makes every later edit a reflow and every diff unreadable.

Two modes:

  --check FILE...   exit 1 if any file carries hard-wrapped prose (prints paths)
  --fix   FILE...   rewrite the files in place, joining continuation lines

With no flag, reads a PostToolUse hook payload on stdin and blocks (exit 2) when
the file just written is hard-wrapped.

Preserved verbatim: leading YAML frontmatter, fenced code, headings, tables,
thematic breaks, HTML blocks, blank lines, indentation, blockquote prefixes, and
explicit hard breaks (a line ending in two spaces or a backslash).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^\s*#{1,6}\s")
TABLE_RE = re.compile(r"^\s*\|")
RULE_RE = re.compile(r"^\s*([-*_])\s*(?:\1\s*){2,}$")
HTML_RE = re.compile(r"^\s*<")
LIST_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+")
QUOTE_RE = re.compile(r"^(\s*>+\s?)(.*)$")
SETEXT_RE = re.compile(r"^\s*(=+|-+)\s*$")
HARD_BREAK_RE = re.compile(r"(?:  +|\\)$")


def _is_block_start(text: str) -> bool:
    """A line that opens its own block and never joins the previous one."""
    return bool(
        not text.strip()
        or HEADING_RE.match(text)
        or TABLE_RE.match(text)
        or RULE_RE.match(text)
        or SETEXT_RE.match(text)
        or HTML_RE.match(text)
        or LIST_RE.match(text)
    )


def _frontmatter_end(lines: list[str]) -> int:
    """Index just past a leading YAML frontmatter block, or 0 if there is none.

    The fences are `---`, which also reads as a thematic break: a block start
    that opens a block rather than closing one. Left to the reflow loop the
    opening fence would glue itself to the first key (`--- description: ...`),
    so the whole block is handed through verbatim instead.
    """
    if not lines or lines[0].strip() != "---":
        return 0
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return i + 1
    return 0  # unterminated — not frontmatter, reflow it like any other prose


def reflow(source: str) -> str:
    lines = source.split("\n")
    fm = _frontmatter_end(lines)
    out: list[str] = lines[:fm]
    lines = lines[fm:]
    block: list[str] = []
    block_prefix = ""
    in_fence = False
    fence_marker = ""

    def flush() -> None:
        nonlocal block, block_prefix
        if block:
            out.append(block_prefix + " ".join(block))
            block = []
            block_prefix = ""

    for line in lines:
        fence = FENCE_RE.match(line)
        if fence:
            if not in_fence:
                flush()
                in_fence, fence_marker = True, fence.group(1)
            elif line.strip().startswith(fence_marker):
                in_fence, fence_marker = False, ""
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue

        quote = QUOTE_RE.match(line)
        prefix, text = (quote.group(1), quote.group(2)) if quote else ("", line)

        if not text.strip():
            flush()
            out.append(line)
            continue

        if _is_block_start(text) or prefix != block_prefix or not block:
            flush()
            block_prefix = prefix
            indent = LIST_RE.match(text)
            if indent is None and not prefix:
                block_prefix = re.match(r"^\s*", text).group(0)  # type: ignore[union-attr]
                block.append(text.strip())
            else:
                block.append(text.rstrip())
        else:
            block.append(text.strip())

        if HARD_BREAK_RE.search(line):
            # explicit hard break: the author meant this line to end here
            out.append(block_prefix + " ".join(block) + "  ")
            block, block_prefix = [], ""

    flush()
    return "\n".join(out)


def _offenders(paths: list[str]) -> list[Path]:
    bad = []
    for raw in paths:
        path = Path(raw)
        if path.suffix.lower() != ".md" or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        if reflow(text) != text:
            bad.append(path)
    return bad


def main() -> int:
    argv = sys.argv[1:]
    if argv and argv[0] in ("--check", "--fix"):
        mode, paths = argv[0], argv[1:]
        if mode == "--fix":
            for raw in paths:
                path = Path(raw)
                if path.suffix.lower() != ".md" or not path.is_file():
                    continue
                text = path.read_text(encoding="utf-8")
                new = reflow(text)
                if new != text:
                    path.write_text(new, encoding="utf-8")
                    print(f"reflowed {path}")
            return 0
        bad = _offenders(paths)
        for path in bad:
            print(f"hard-wrapped: {path}")
        return 1 if bad else 0

    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    target = (payload.get("tool_input") or {}).get("file_path")
    if not target or not _offenders([target]):
        return 0
    print(
        f"{target} is hard-wrapped. Project rule: Markdown is soft-wrapped — one logical "
        "line per paragraph, list item, or blockquote, no wrapping at any column. "
        f"Fix with: python3 .claude/hooks/md-softwrap.py --fix {target}",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
