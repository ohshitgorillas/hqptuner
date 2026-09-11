#!/usr/bin/env python3
"""Check a landed tests-only change against the block that approved it.

`kind: excision` and `kind: repair` have no implementation phase, so the
post-merge reviewer round that catches a softened test has no window to watch.
What it watched for still happens here, in one move rather than two: the
deletion is itself the softening. This script is that check, and it is
mechanical so it costs no reviewer round.

Run by `scripts/pair.sh merge`, never by a hook: a PreToolUse entry fires on a
tool call, and a comparison of two commits has none.

It reads the committed `tests/specs/<slug>.txt` and prints one line per target:

    OK <target>            the excision landed
    UNSATISFIED <target>   the target is still there, assertion and all
    MISSING <as-name>      the replacement the line promised never landed
    UNNAMED <path>         a file under tests/ changed that no line names

An excise target is satisfied on either of two facts: the test name is gone
from the file, or the name is present and the line's quoted `assertion:` text
is no longer in that test's own body. Body, not file: the same assertion text
can sit in a sibling test -- a parametrize case, a shared line -- and a
file-wide search would read the target as unsatisfied on a test no line names.

A node target, `tests/js/<file>::"<test title>"`, has no `def` to bound a body
with, so it is read against the whole file instead. That is weaker in exactly
the sibling case above, and it is the reading the grammar allows rather than a
choice made here.

Nothing here reads `replace:`. It holds prose, and prose has no mechanical
reading; `as:` is the field that names what the replacement must land as.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

TESTS = "tests/"

#: resolved so the argv carries a full path, as scripts/build_autoeq_db.py does
GIT = shutil.which("git") or "git"

#: everything below this line is the reviewer's own output, not the contract
SEPARATOR = "--- spec-reviewer"

_LINE = re.compile(r"^\s*\d+\.\s+excise\s+(?P<target>\S+)\s*$")
_FIELD = re.compile(r"^\s*(?P<key>rule|assertion|replace|as):\s*(?P<value>.*)$")


class Line:
    """One excision or repair line of an approved block."""

    def __init__(self, target: str) -> None:
        """Hold one target, its quoted assertion and its landing name."""
        self.target = target
        self.assertion = ""
        self.landing = ""  # the `as:` field, empty on a `kind: excision` line

    @property
    def path(self) -> str:
        """Give the file half of the target."""
        return self.target.split("::", 1)[0]

    @property
    def test(self) -> str:
        """Give the test half of the target, empty for a whole-file target."""
        _, _, name = self.target.partition("::")
        return name


def parse_block(text: str) -> list[Line]:
    """Read the lines of a block, in spec order."""
    contract, _, _ = text.partition(SEPARATOR)
    lines: list[Line] = []
    for raw in contract.splitlines():
        head = _LINE.match(raw)
        if head:
            lines.append(Line(head.group("target")))
            continue
        field = _FIELD.match(raw)
        if field and lines:
            key, value = field.group("key"), field.group("value").strip()
            if key == "assertion":
                lines[-1].assertion = value
            elif key == "as":
                lines[-1].landing = value
    return lines


def _git(*args: str) -> tuple[int, str]:
    done = subprocess.run([GIT, *args], capture_output=True, text=True, check=False)
    return done.returncode, done.stdout


def file_at(rev: str, path: str) -> str | None:
    """Read the file's content at that commit, or None where it does not exist."""
    code, out = _git("show", f"{rev}:{path}")
    return out if code == 0 else None


def changed_files(base: str, head: str) -> list[str]:
    """List the files under tests/ that differ between the two commits."""
    _, out = _git("diff", "--name-only", base, head, "--", TESTS)
    return [p for p in out.splitlines() if p.strip()]


def test_body(source: str, name: str) -> str | None:
    """Cut the span from `def <name>` to the next definition at that indent.

    A name in quotes is a node test title, which no `def` introduces: the
    whole file is its body, and None says the file does not carry it at all.
    """
    if name.startswith('"'):
        return source if name.strip('"') in source else None
    opener = re.compile(rf"^(?P<indent>\s*)(?:async\s+)?def\s+{re.escape(name)}\s*\(")
    rows = source.splitlines()
    for i, row in enumerate(rows):
        start = opener.match(row)
        if not start:
            continue
        indent = len(start.group("indent"))
        body = [row]
        for follow in rows[i + 1 :]:
            outdented = follow.strip() and len(follow) - len(follow.lstrip()) <= indent
            if outdented and follow.lstrip().startswith(("def ", "async def ", "class ", "@")):
                break
            body.append(follow)
        return "\n".join(body)
    return None


def excision_verdict(line: Line, head: str) -> str:
    """`OK` or `UNSATISFIED` for one excise target."""
    source = file_at(head, line.path)
    if source is None:
        return f"OK {line.target}"
    if not line.test:
        #: a whole-file target: the file itself is what had to stop existing
        return f"UNSATISFIED {line.target}"
    body = test_body(source, line.test)
    if body is None:
        return f"OK {line.target}"
    if line.assertion and line.assertion in body:
        return f"UNSATISFIED {line.target}"
    return f"OK {line.target}"


def landing_verdict(line: Line, head: str) -> str:
    """`OK` or `MISSING` for one `as:` name."""
    path, _, name = line.landing.partition("::")
    source = file_at(head, path)
    if source is not None and name and test_body(source, name) is not None:
        return f"OK {line.landing}"
    return f"MISSING {line.landing}"


def report(block: str, base: str, head: str) -> list[str]:
    """Give every verdict the block earns over that diff, in printing order."""
    lines = parse_block(block)
    named = {line.path for line in lines}
    named.update(line.landing.split("::", 1)[0] for line in lines if line.landing)

    out = [excision_verdict(line, head) for line in lines]
    out += [landing_verdict(line, head) for line in lines if line.landing]
    out += [f"UNNAMED {path}" for path in changed_files(base, head) if path not in named]
    return out


def main(argv: list[str]) -> int:
    """Print one verdict per line and return 1 where any of them refuses the land."""
    parser = argparse.ArgumentParser(description="Check a tests-only diff against its block.")
    parser.add_argument("--spec", required=True, help="tests/specs/<slug>.txt")
    parser.add_argument("--base", required=True, help="the commit the change started from")
    parser.add_argument("--head", required=True, help="the commit that landed it")
    args = parser.parse_args(argv)

    block = Path(args.spec).read_text(encoding="utf-8")

    verdicts = report(block, args.base, args.head)
    for verdict in verdicts:
        print(verdict)
    return 0 if all(v.startswith("OK ") for v in verdicts) else 1


def self_test() -> int:
    """Pin the four rules of the merge check, without a repository."""
    block = (
        "kind: repair\n"
        "1. excise tests/test_a.py::test_one\n"
        "   rule: docs/testing.md rule 9\n"
        "   assertion: assert LABEL == 'Preset'\n"
        "   replace: the loader names the preset it could not find\n"
        "   as: tests/test_b.py::test_two\n"
        "2. excise tests/test_c.py::test_three\n"
        "   rule: docs/testing.md rule 2\n"
        "   assertion: assert a and b\n"
        f"{SEPARATOR} READY ---\n"
        "3. excise tests/not_a_line.py::ignored\n"
    )
    lines = parse_block(block)
    kept = "def test_sibling():\n    assert LABEL == 'Preset'\n"
    survivor = "def test_one():\n    assert LABEL == 'Preset'\n\n\n" + kept
    sibling_only = "def test_one():\n    assert other\n\n\n" + kept

    rules = {
        "1 the contract stops at the reviewer separator": (
            [line.target for line in lines] == ["tests/test_a.py::test_one", "tests/test_c.py::test_three"]
        ),
        "2 a body carries its own assertion, a sibling's does not": (
            lines[0].assertion in (test_body(survivor, "test_one") or "")
            and lines[0].assertion not in (test_body(sibling_only, "test_one") or "")
        ),
        "3 only a line with `as:` names a landing": (
            [line.landing for line in lines] == ["tests/test_b.py::test_two", ""]
        ),
        "4 a node title is read against the whole file": (
            test_body('test("keeps the axis", () => {})', '"keeps the axis"') is not None
            and test_body('test("other", () => {})', '"keeps the axis"') is None
        ),
    }
    for label, ok in rules.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(rules.values()) else 1


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main(sys.argv[1:]))
