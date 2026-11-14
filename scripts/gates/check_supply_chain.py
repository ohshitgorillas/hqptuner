#!/usr/bin/env python3
"""Gate: the release pipeline fetches no remote code it has not pinned.

A tag names whatever commit its owner last pointed it at, so a workflow that
calls an action by tag runs code its repository did not review: the tag moves
and the next run follows it. A full commit SHA names one tree, and the tag stays
beside it as a trailing comment for the reader and for Dependabot.

A local ``./`` call runs this repository's own file and needs no pin.

A script fetched and piped straight into a shell is the same hole one step
earlier: nothing checks the bytes before they run. The install fetches an
archive, checks it against the checksum its release publishes, and only then
runs it.

What a build installs is the same question one level down. One hashed lock,
``uv.lock``, holds the packages CI tested and the release ships, and a job that
builds them installs by a ``uv sync --locked`` and from nothing else; a name
handed to ``pip`` or ``uv pip`` is resolved afresh on the day of the run.

Usage: ``python scripts/gates/check_supply_chain.py [checkout-root]``
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: A ``uses:`` step key, with or without the list dash, and the ref after it.
USES = re.compile(r"^\s*(?:-\s+)?uses:\s*(?P<ref>[^\s#]+)")

#: An action ref naming a full commit.
PINNED_REF = re.compile(r"@[0-9a-f]{40}$")


#: A download piped into an interpreter: a fetcher, then ``|``, then a shell or
#: ``Invoke-Expression``, with any ``env NAME=value`` or ``sudo`` prefix between.
PIPED_INSTALL = re.compile(
    r"\b(?:curl|wget|irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^|]*"
    r"\|\s*(?:(?:env|sudo)\s+(?:\w+=\S+\s+)*)*(?:sh|bash|zsh|iex|Invoke-Expression)\b",
    re.IGNORECASE,
)


#: A job header under ``jobs:``: a key at two spaces of indentation with nothing after it.
JOB_HEADER = re.compile(r"^  (?P<job>[\w-]+):\s*$")

#: The workflows whose Python installs must come from the lock, with the jobs of each; None is every job.
LOCKED_JOBS: dict[str, frozenset[str] | None] = {
    "check.yml": None,
    "release.yml": frozenset({"build", "build-macos", "build-windows"}),
}

#: The one package a workflow may install without the lock, by workflow.
UNLOCKED_INSTALL = {"check.yml": "triviajudge"}

#: ``pip install``, however it is reached, and the other ways a name becomes an install.
PYTHON_INSTALL = re.compile(r"\bpip3?\s+install\b|\bpipx\s+install\b|\buv\s+(?:tool\s+install|add|pip\s+sync)\b")

#: A ``uv sync``, and the flag that makes it fail on a stale lock instead of resolving again.
UV_SYNC = re.compile(r"\buv\s+sync\b")
LOCKED_FLAG = re.compile(r"\s--locked(?:\s|$)")


def action_failures(name: str, source: str) -> list[str]:
    """One line per remote action in a workflow that is not named by a full commit SHA."""
    lines: list[str] = []
    for number, text in enumerate(source.splitlines(), start=1):
        match = USES.match(text)
        if match is None:
            continue
        ref = match["ref"]
        if not ref.startswith("./") and not PINNED_REF.search(ref):
            lines.append(f"{name}:{number}: {ref} is not pinned to a full 40-hex commit SHA")
    return lines


def pipe_failures(name: str, source: str) -> list[str]:
    """One line per step in a workflow that pipes a downloaded script into a shell."""
    return [
        f"{name}:{number}: a downloaded script is piped into a shell: {text.strip()}"
        for number, text in enumerate(source.splitlines(), start=1)
        if PIPED_INSTALL.search(text)
    ]


def _logical_lines(source: str) -> list[tuple[int, str]]:
    """Each line of a workflow with its backslash continuations joined, under the number of its first line."""
    joined: list[tuple[int, str]] = []
    start = 0
    parts: list[str] = []
    for number, text in enumerate(source.splitlines(), start=1):
        if not parts:
            start = number
        parts.append(text.rstrip().removesuffix("\\"))
        if not text.rstrip().endswith("\\"):
            joined.append((start, " ".join(parts)))
            parts = []
    return joined


def _installed_names(segment: str) -> list[str]:
    """List the packages an install command names, leaving out its options and the interpreter it is given."""
    names: list[str] = []
    skip = False
    for word in segment.split("install", 1)[1].split():
        if skip:
            skip = False
        elif word == "--python":
            skip = True
        elif not word.startswith("-"):
            names.append(re.split(r"[=<>!~\[;]", word)[0])
    return names


def _install_problem(name: str, segment: str) -> str | None:
    """Why one command of a workflow installs Python packages outside the lock, or None when it does not."""
    if UV_SYNC.search(segment):
        return None if LOCKED_FLAG.search(segment) else "a uv sync that does not insist on the lock (--locked)"
    if PYTHON_INSTALL.search(segment):
        if _installed_names(segment) == [UNLOCKED_INSTALL.get(name, "")]:
            return None
        return "a Python install that does not come from the lock"
    return None


def install_failures(name: str, source: str) -> list[str]:
    """One line per Python install, in a job that builds what ships, that does not come from the lock."""
    if name not in LOCKED_JOBS:
        return []
    jobs = LOCKED_JOBS[name]
    lines: list[str] = []
    in_jobs, job = False, ""
    for number, text in _logical_lines(source):
        if re.match(r"\S", text):
            in_jobs, job = text.startswith("jobs:"), ""
            continue
        header = JOB_HEADER.match(text)
        if in_jobs and header:
            job = header["job"]
            continue
        if text.lstrip().startswith("#") or not job or (jobs is not None and job not in jobs):
            continue
        for segment in re.split(r"&&|\|\||;", text):
            problem = _install_problem(name, segment)
            if problem:
                lines.append(f"{name}:{number}: job {job}: {problem}: {segment.strip()}")
    return lines


def main(argv: list[str]) -> int:
    """Check the workflows of one checkout, this one unless a root is named, and say so in the exit status."""
    root = Path(argv[0]) if argv else ROOT
    workflows = sorted((root / ".github" / "workflows").glob("*.yml"))
    lines = [
        line
        for path in workflows
        for check in (action_failures, pipe_failures, install_failures)
        for line in check(path.name, path.read_text(encoding="utf-8"))
    ]

    for line in lines:
        print(line)
    if lines:
        print(f"\n{len(lines)} problem(s). Pin every action by commit, check every download, install from the lock.")
        return 1
    print(f"[ok] all {len(workflows)} workflows pin their remote code")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
