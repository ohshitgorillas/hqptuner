#!/usr/bin/env python3
"""Gate: a commit message records the change and its reason, not how it was found.

A commit message is where a decision is recorded, so it may state what was
wrong and why the fix is shaped as it is, in whatever tense the bug demands.
What it may not carry is trivia about the road there: which attempt came first,
what the session or a reviewer did, what somebody found along the way, a dated
remark, a tally of a file's past. None of that helps the next reader make the
next change, and each such line invites the next one. ``PATTERNS`` below holds
the phrasing that reliably marks such narration, one labelled class per entry;
the phrases are spelled there and nowhere else in this file, since the comment
gate reads this docstring too.

The subject and body are scanned. Git's own ``#`` comment lines are not, and
neither is the trailing block of ``Key: value`` trailers, which is where a
session link lives.

The fix is never to reword around the pattern: state the change and the
constraint behind it, or delete the line. A line that must stay takes
``history-ok: <reason>``, reason required, the same contract as the comment
gate in ``check_archaeology.py``.

Usage: ``python scripts/gates/check_commit_msg.py <message-file>`` (the
commit-msg hook contract) or ``-`` to read the message from stdin.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PRAGMA = "history-ok:"

PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b20[0-9]{2}-[01][0-9]-[0-3][0-9]\b"), "dated narration"),
    (
        re.compile(
            r"\b(?:used to|originally|at first|earlier (?:draft|version|design|attempt)"
            r"|previous attempt|first (?:attempt|try|pass)|second (?:attempt|pass|round)"
            r"|round (?:two|three)|iterations?)\b",
            re.IGNORECASE,
        ),
        "iteration narration",
    ),
    (
        re.compile(r"\b(?:turn(?:s|ed) out|discovered|realized|had to discover)\b", re.IGNORECASE),
        "discovery narration",
    ),
    (
        re.compile(
            r"\b(?:(?:this|the|a) session"
            r"|(?:reviewer|writer|builder|subagent|agent) (?:let|missed|caught|flagged|returned)"
            r"|process note|withdrawn|was reversed)\b",
            re.IGNORECASE,
        ),
        "process narration",
    ),
    (
        re.compile(r"\b(?:in (?:the|its|this) history|history of)\b", re.IGNORECASE),
        "history tally",
    ),
)

EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*\S")
BARE_PRAGMA = re.compile(re.escape(PRAGMA) + r"\s*$")

#: a trailer is a token, a colon, a value — the shape git itself parses
TRAILER = re.compile(r"^[A-Za-z][A-Za-z0-9-]*:\s+\S")

REDIRECT = (
    "A commit message records the change and the reason for it, never the\n"
    "road there: no attempts, sessions, discoveries, dates or tallies of a\n"
    "file's history. State the constraint, or delete the line. A line that\n"
    f"must stay takes `{PRAGMA} <reason>`."
)


def scanned_lines(text: str) -> list[tuple[int, str]]:
    """(line, text) for every line the gate reads: no `#` comments, no trailing trailers."""
    lines = [line for line in text.splitlines() if not line.startswith("#")]
    while lines and not lines[-1].strip():
        lines.pop()
    end = len(lines)
    while end and TRAILER.match(lines[end - 1]):
        end -= 1
    return list(enumerate(lines[:end], 1))


def check_message(text: str) -> list[str]:
    """Return one complaint per narrating line or reasonless pragma in the message."""
    complaints = []
    for lineno, line in scanned_lines(text):
        if BARE_PRAGMA.search(line):
            complaints.append(f"line {lineno}: bare `{PRAGMA}` — the reason is required")
            continue
        if EXEMPT.search(line):
            continue
        for pattern, label in PATTERNS:
            if match := pattern.search(line):
                complaints.append(f'line {lineno}: {label} ("{match.group(0)}")')
    return complaints


def message_text(arg: str) -> str:
    """Return the message under test: stdin for ``-``, else the file's contents."""
    if arg == "-":
        return sys.stdin.read()
    return Path(arg).read_text(encoding="utf-8")


def main() -> int:
    """Refuse a commit message narrating how the change was arrived at."""
    complaints = check_message(message_text(sys.argv[1]))
    for complaint in complaints:
        print(complaint)
    if complaints:
        print(f"\n{REDIRECT}")
    return 1 if complaints else 0


if __name__ == "__main__":
    sys.exit(main())
