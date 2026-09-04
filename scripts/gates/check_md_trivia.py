#!/usr/bin/env python3
"""Gate: markdown a commit adds states what holds now, not what happened.

The design docs collect trivia faster than any regex can name it: dated
approvals, hand-back receipts, resolved to-do items kept struck through,
corrections that narrate the mistake they fix, round and phase numbers used as
positions in history, and prose whose only content is that something did not
change. ``check_archaeology.py`` catches the keyword shapes in code comments;
pointed at markdown it drowns in ISO dates that sit inside legitimate
provenance tables. Telling those apart is a judgment call, so this gate asks a
model to make it.

Scope is the lines a commit adds, never the whole file: prose that already
shipped is not re-litigated on every touch. ``CHANGELOG.md`` has its own gate
and its own style rule, and ``docs/copy-before-after.md`` is the owner's copy
record; both are skipped. Blank lines, headings, fenced code and table rules
carry no prose and are not sent.

Transport is the ``claude`` CLI in print mode, one call per commit carrying
every line. There is no API key in this repo and no SDK in the venv, and the
CLI already holds a login. The model is pinned to Haiku: the question is small
and the answer is a short list. A CLI that fails, or an answer that is not the
JSON asked for, fails the gate rather than passing it.

Usage:

* ``python scripts/gates/check_md_trivia.py FILE...`` judges the staged diff of
  the named files (pre-commit)
* ``python scripts/gates/check_md_trivia.py --head`` judges every markdown line
  HEAD added (Makefile)
* ``python scripts/gates/check_md_trivia.py --lines FILE [--out FILE]`` judges
  ``path:line<TAB>text`` records from a file, for calibration
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: Files with their own gate or their own owner-held style rule.
SKIP = frozenset({"CHANGELOG.md", "docs/copy-before-after.md"})

PROMPT = """\
You review lines added to a software project's markdown docs. Flag TRIVIA:
text that tells the next reader what happened rather than what holds now.

Flag a line when it is, or carries, one of:
- a dated event: "approved 2026-07-XX", "decided 2026-07-XX", "hand-back PASS 2026-07-XX"
- a verification date stamped on a fact: "(verified 2026-07-XX)", "verified 2026-07-XX |".
  The fact stands without the date; the date is the trivia, so flag the line
- a completed process record: phase done, probe run, review round, screenshot receipt, "all N items"
- a delivery step, ordering, or protocol reminder from a plan that has already run:
  "Delivery order.", "Amend X first", "Hand-back per standing protocol", "not shipped
  until the step-7 hand-back passes", "Standing hand-back requirements (every phase from 3 on)"
- a resolved question kept as a struck-through or "resolved:" item, or a bare "Still open:"
- a correction that narrates the earlier mistake: "corrected", "supersedes an estimate
  made here earlier", "previously documented as"
- a round, step, phase or draft number used as a position in history: "Round 1 filed",
  "round-2's recv loop", "probe round 3", "Phase 0.2 targets", "Phase 0.2 deliverable",
  "step-7 hand-back", "earlier drafts"
- a statement of what code or docs once said or did
- narration by negation: text that exists only to say something did not change or still
  behaves as before ("Y still works the same as before", "unchanged from round 2",
  "continues to work the same way it always has")

Do NOT flag:
- a rule, constraint, or fact that holds now, in present tense, even if it contains a number
- a measurement or verified wire fact stated as current, with no date on it ("returns list
  indices, verified"; "state unchanged, HTTP 200" as an observed result)
- a statement that something is no longer required, when that is the current rule
- a citation of an external source, paper, manual section or upstream version, including
  its date or revision id
- a provenance or attribution table row whose date is the row's content (a source revision,
  a release date), as opposed to the date a claim was checked
- a to-do that is still open
- code, commands, tables of live values, headings

Prefer silence. Flag only when the line would lose nothing by being deleted
or rewritten in present tense.

Each input line is `<id><TAB><text>`. Output JSON only: an array of objects
{"id": "<id as given>", "reason": "<under 15 words>"}. Empty array when
nothing qualifies. No prose before or after the JSON.
"""

HEADING = re.compile(r"^\s{0,3}#{1,6}(\s|$)")
FENCE = re.compile(r"^\s{0,3}(```|~~~)")
TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


@dataclass(frozen=True)
class Line:
    """One added markdown line, addressed as the judge will echo it back."""

    path: str
    number: int
    text: str

    @property
    def id(self) -> str:
        """``path:line``, the id sent to the judge and printed on a flag."""
        return f"{self.path}:{self.number}"


def binary(name: str) -> str:
    """Absolute path of a tool on PATH, or a RuntimeError naming what is missing."""
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(f"`{name}` not on PATH")
    return path


def git_diff(*args: str) -> str:
    """Zero-context diff, so every ``+`` line is an added line."""
    cmd = [binary("git"), "diff", "-U0", "--no-color", *args]
    return subprocess.run(cmd, check=True, capture_output=True, text=True, cwd=ROOT).stdout  # noqa: S603


def added_lines(diff: str) -> list[Line]:
    """Every added line in a unified diff, with the path and new-file line number."""
    out: list[Line] = []
    path = ""
    number = 0
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            path = raw[4:].removeprefix("b/")
        elif match := HUNK.match(raw):
            number = int(match.group(1))
        elif raw.startswith("+"):
            out.append(Line(path, number, raw[1:]))
            number += 1
        elif not raw.startswith("-"):
            number += 1
    return out


def prose_only(lines: list[Line]) -> list[Line]:
    """Drop lines that carry no prose: blank, heading, table rule, fenced code, skipped files."""
    out: list[Line] = []
    fenced: set[str] = set()
    for line in lines:
        if line.path in SKIP or line.path == "/dev/null":
            continue
        if FENCE.match(line.text):
            fenced ^= {line.path}
            continue
        if line.path in fenced or not line.text.strip():
            continue
        if HEADING.match(line.text) or TABLE_RULE.match(line.text):
            continue
        out.append(line)
    return out


def from_records(path: Path) -> list[Line]:
    """Calibration input: one ``path:line<TAB>text`` record per line."""
    out: list[Line] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        ident, _, text = raw.partition("\t")
        file, _, number = ident.rpartition(":")
        out.append(Line(file, int(number), text))
    return out


def ask(lines: list[Line]) -> list[dict[str, str]]:
    """One CLI call for every line; the parsed JSON array it answers with."""
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    body = PROMPT + "\n\nLINES:\n" + "\n".join(f"{line.id}\t{line.text}" for line in lines)
    cmd = [
        binary("claude"),
        "-p",
        "--model",
        "claude-haiku-4-5",
        "--tools",
        "",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--output-format",
        "json",
    ]
    proc = subprocess.run(cmd, input=body, capture_output=True, text=True, env=env, cwd=ROOT, check=False)  # noqa: S603
    if proc.returncode != 0:
        raise RuntimeError(f"claude exited {proc.returncode}: {proc.stderr.strip() or proc.stdout.strip()}")
    envelope = json.loads(proc.stdout)
    if envelope.get("is_error"):
        raise RuntimeError(f"claude reported an error: {envelope.get('result')}")
    answer = str(envelope.get("result", "")).strip()
    answer = re.sub(r"^```(?:json)?\s*|\s*```$", "", answer)
    flags = json.loads(answer)
    if not isinstance(flags, list):
        raise RuntimeError(f"judge answered with {type(flags).__name__}, not a list")
    return [dict(item) for item in flags]


def report(lines: list[Line], flags: list[dict[str, str]]) -> int:
    """Print every flag against its line; the count is the exit status."""
    by_id = {line.id: line for line in lines}
    for flag in flags:
        line = by_id.get(str(flag.get("id")))
        where = line.id if line else f"?:{flag.get('id')}"
        print(f"{where}: {flag.get('reason', '').strip()}")
        if line:
            print(f"    {line.text.strip()}")
    if flags:
        print(f"\n{len(flags)} line(s) narrate history. State what holds now, or delete the remark.")
    else:
        print(f"[ok] {len(lines)} markdown line(s) state what holds now")
    return 1 if flags else 0


def collect(args: argparse.Namespace) -> list[Line]:
    """Lines to judge, from whichever input mode the arguments name."""
    if args.lines:
        return prose_only(from_records(Path(args.lines)))
    if args.head:
        return prose_only(added_lines(git_diff("HEAD~1", "--", "*.md")))
    if not args.files:
        return []
    return prose_only(added_lines(git_diff("--cached", "--", *args.files)))


def main() -> int:
    """Judge the added markdown lines; nothing to judge is a pass without a call."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", help="staged markdown files (pre-commit)")
    parser.add_argument("--head", action="store_true", help="judge the markdown HEAD added")
    parser.add_argument("--lines", help="calibration records, path:line<TAB>text")
    parser.add_argument("--out", help="write the judge's raw answer here")
    args = parser.parse_args()

    lines = collect(args)
    if not lines:
        print("[ok] no markdown prose added")
        return 0
    try:
        flags = ask(lines)
    except (RuntimeError, ValueError, OSError) as exc:
        print(f"check_md_trivia: judge unavailable, refusing to pass: {exc}", file=sys.stderr)
        return 1
    if args.out:
        Path(args.out).write_text(json.dumps(flags, indent=2) + "\n", encoding="utf-8")
    return report(lines, flags)


if __name__ == "__main__":
    sys.exit(main())
