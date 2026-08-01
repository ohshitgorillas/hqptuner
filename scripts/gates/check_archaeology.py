#!/usr/bin/env python3
"""Gate: comments state live constraints, not decision archaeology.

A comment earns its keep by telling the next reader a constraint the code
cannot show. A comment that narrates what the code once did, when a decision
happened, or which iteration came before spends the reader's attention on
facts that help nobody make the next change — and each one invites the next.
This gate blocks the phrasing that reliably marks such narration:

- ISO dates in prose (``2026-07-28``) — a dated remark describes a moment,
  not an invariant;
- ``used to`` and ``earlier draft/version/design`` — past-behaviour narration;
- ``extracted from`` / ``split out from`` / ``moved here from`` / ``reorg`` —
  refactor archaeology;
- conventional-commit citations (``fix(live): …``) — git already holds these;
- ``withdrawn`` / ``was reversed`` / ``process note`` — process archaeology.

Scope is shipped code and tooling comments. ``tests/`` is deliberately out of
scope — a regression test legitimately names the bug it pins, in whatever tense
the bug demands — and so is ``scripts/probes/``, whose scripts are session
records with dates as their content. ``CHANGELOG.md`` and vendored code are
excluded by the file list in the Makefile.

The fix is never to reword around the pattern: state the constraint that holds
NOW, in present tense, or delete the remark. History that must stay — an
upstream attribution, a pinned legacy behaviour — takes ``history-ok:
<reason>`` on the offending line, reason required, same contract as the token,
class, card and dirty-mark gates.
"""

from __future__ import annotations

import re
import sys
import tokenize
from pathlib import Path

PRAGMA = "history-ok:"

PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b20[0-9]{2}-[01][0-9]-[0-3][0-9]\b"), "dated narration"),
    (re.compile(r"\bused to\b", re.IGNORECASE), "past-behaviour narration"),
    (
        re.compile(r"\bearlier (?:draft|version|design)\b", re.IGNORECASE),
        "prior-iteration narration",
    ),
    (
        re.compile(r"\b(?:extracted|split out|moved here) from\b", re.IGNORECASE),
        "refactor archaeology",
    ),
    (re.compile(r"\breorg\b", re.IGNORECASE), "refactor archaeology"),
    (
        re.compile(r"\b(?:feat|fix|docs|test|chore|refactor)\([a-z0-9-]+\):"),
        "commit citation",
    ),
    (
        re.compile(r"\b(?:withdrawn|was reversed|process note)\b", re.IGNORECASE),
        "process archaeology",
    ),
)

#: a pragma with nothing after it — the form of an exemption nobody could justify
EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*(?!\*/)\S")
BARE_PRAGMA = re.compile(re.escape(PRAGMA) + r"\s*(?:\*/\s*)?$")

#: `//` opens a comment unless it is the tail of a URL scheme
LINE_COMMENT = re.compile(r"(?<!:)//(.*)$")

REDIRECT = (
    "An archaeology comment narrates what the code was; a comment earns its\n"
    "keep by stating the live constraint. Rewrite it in present tense as the\n"
    "invariant that holds now, or delete the remark. History that must stay\n"
    f"(upstream attribution, pinned legacy behaviour) takes `{PRAGMA} <reason>`\n"
    "on the offending line."
)


def python_comment_lines(path: Path) -> list[tuple[int, str]]:
    """(line, text) for every comment and triple-quoted string line."""
    out: list[tuple[int, str]] = []
    with tokenize.open(path) as handle:
        for tok in tokenize.generate_tokens(handle.readline):
            if tok.type == tokenize.COMMENT:
                out.append((tok.start[0], tok.string))
            elif tok.type == tokenize.STRING and tok.string.lstrip("rbuRBU").startswith(('"""', "'''")):
                for offset, line in enumerate(tok.string.splitlines()):
                    out.append((tok.start[0] + offset, line))
    return out


def block_comment_lines(path: Path, line_comments: bool) -> list[tuple[int, str]]:
    """(line, text) for `/* … */` blocks, plus `//` comments when asked."""
    out: list[tuple[int, str]] = []
    in_block = False
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        rest = line
        if in_block:
            head, closed, rest = rest.partition("*/")
            out.append((lineno, head))
            if not closed:
                continue
            in_block = False
        while "/*" in rest:
            rest = rest.split("/*", 1)[1]
            body, closed, rest = rest.partition("*/")
            out.append((lineno, body))
            if not closed:
                in_block = True
                break
        else:
            if line_comments and (match := LINE_COMMENT.search(rest)):
                out.append((lineno, match.group(1)))
    return out


def comment_lines(path: Path) -> list[tuple[int, str]]:
    if path.suffix == ".py":
        return python_comment_lines(path)
    if path.suffix in (".js", ".mjs"):
        return block_comment_lines(path, line_comments=True)
    if path.suffix == ".css":
        return block_comment_lines(path, line_comments=False)
    return list(enumerate(path.read_text(encoding="utf-8").splitlines(), 1))


def check_file(path: Path) -> list[str]:
    complaints = []
    for lineno, text in comment_lines(path):
        if BARE_PRAGMA.search(text):
            complaints.append(f"{path}:{lineno}: bare `{PRAGMA}` — the reason is required")
            continue
        if EXEMPT.search(text):
            continue
        for pattern, label in PATTERNS:
            if match := pattern.search(text):
                complaints.append(f'{path}:{lineno}: {label} ("{match.group(0)}")')
    return complaints


def main() -> int:
    complaints: list[str] = []
    self_path = Path(__file__).resolve()
    for name in sys.argv[1:]:
        path = Path(name)
        # this file is the one place the blocked phrases may be spelled out —
        # the docstring above names them as examples
        if path.is_file() and path.resolve() != self_path:
            complaints.extend(check_file(path))
    for complaint in complaints:
        print(complaint)
    if complaints:
        print(f"\n{REDIRECT}")
    return 1 if complaints else 0


if __name__ == "__main__":
    sys.exit(main())
