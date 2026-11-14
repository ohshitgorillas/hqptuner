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

A base image named by tag is the same thing again: the tag moves. The Dockerfile's
images and the container that freezes the deb and the rpm are named by digest.
The images the smoke and lifecycle jobs install the packages on stay on tags:
they hold nothing that ships.

Usage: ``python scripts/gates/check_supply_chain.py [checkout-root]``
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterator

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


#: An image reference ending in a registry digest, the 64 hex characters of a sha256.
PINNED_IMAGE = re.compile(r"@sha256:[0-9a-f]{64}$")

#: The jobs whose ``container:`` freezes the packages that ship; the smoke and lifecycle images stay on tags.
PINNED_CONTAINER_JOBS = {"release.yml": frozenset({"build"})}

#: A ``container:`` key of a job and the image after it.
CONTAINER = re.compile(r"^\s*container:\s*(?P<image>\S+)\s*$")

#: A Dockerfile ``FROM`` and its image, after any ``--flag=value`` options; and a ``COPY --from`` that names one.
FROM_IMAGE = re.compile(r"^\s*FROM\s+(?:--\S+\s+)*(?P<image>\S+)", re.IGNORECASE)
COPY_FROM = re.compile(r"^\s*COPY\s+(?:--\S+\s+)*?--from=(?P<image>\S+)", re.IGNORECASE)

#: The name a ``FROM ... AS name`` gives its stage; a later ``FROM`` or ``COPY --from`` may name it, not an image.
STAGE_NAME = re.compile(r"\sAS\s+(?P<stage>\S+)\s*$", re.IGNORECASE)


#: The jobs that may hold ``packages: write``, by workflow: the one that pushes the image.
PACKAGE_WRITERS = {"docker.yml": frozenset({"build-push"})}

#: The workflows that must narrow the token to a read at the top: a caller's grant is the most a reusable one gets.
READ_AT_TOP = frozenset({"check.yml"})

#: A ``packages: write`` grant, and a ``contents: read`` one indented under a top-level ``permissions:``.
PACKAGES_WRITE = re.compile(r"^\s+packages:\s*write\b")
CONTENTS_READ = re.compile(r"^\s+contents:\s*read\b")


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


def _scoped_lines(source: str) -> Iterator[tuple[int, str, str]]:
    """Each line of a workflow as its number, its job (empty above the jobs) and its text; comments skipped."""
    in_jobs, job = False, ""
    for number, text in _logical_lines(source):
        if re.match(r"\S", text):
            in_jobs, job = text.startswith("jobs:"), ""
            yield number, "", text
            continue
        header = JOB_HEADER.match(text)
        if in_jobs and header:
            job = header["job"]
        elif not text.lstrip().startswith("#"):
            yield number, job, text


def _job_lines(source: str) -> Iterator[tuple[int, str, str]]:
    """Each step line of a workflow's jobs as its number, the job it sits in and its text; comments skipped."""
    return ((number, job, text) for number, job, text in _scoped_lines(source) if job)


def install_failures(name: str, source: str) -> list[str]:
    """One line per Python install, in a job that builds what ships, that does not come from the lock."""
    if name not in LOCKED_JOBS:
        return []
    jobs = LOCKED_JOBS[name]
    lines: list[str] = []
    for number, job, text in _job_lines(source):
        if jobs is not None and job not in jobs:
            continue
        for segment in re.split(r"&&|\|\||;", text):
            problem = _install_problem(name, segment)
            if problem:
                lines.append(f"{name}:{number}: job {job}: {problem}: {segment.strip()}")
    return lines


def dockerfile_failures(name: str, source: str) -> list[str]:
    """One line per image a Dockerfile pulls, by ``FROM`` or ``COPY --from``, that no full digest names."""
    stages: set[str] = {"scratch"}
    lines: list[str] = []
    for number, text in _logical_lines(source):
        match = FROM_IMAGE.match(text) or COPY_FROM.match(text)
        if match is None:
            continue
        image = match["image"]
        if image.lower() not in stages and not PINNED_IMAGE.search(image):
            lines.append(f"{name}:{number}: {image} is not pinned to a full sha256 digest")
        stage = STAGE_NAME.search(text)
        if stage and text.upper().startswith("FROM"):
            stages.add(stage["stage"].lower())
    return lines


def container_failures(name: str, source: str) -> list[str]:
    """One line per job whose container freezes what ships that no full digest names."""
    jobs = PINNED_CONTAINER_JOBS.get(name, frozenset())
    lines: list[str] = []
    for number, job, text in _job_lines(source):
        match = CONTAINER.match(text)
        if job in jobs and match and not PINNED_IMAGE.search(match["image"]):
            lines.append(
                f"{name}:{number}: job {job}: container {match['image']} is not pinned to a full sha256 digest"
            )
    return lines


def permission_failures(name: str, source: str) -> list[str]:
    """One line per ``packages: write`` outside the job that pushes, and per workflow that lacks its top-level read."""
    writers = PACKAGE_WRITERS.get(name, frozenset())
    lines: list[str] = []
    for number, job, text in _scoped_lines(source):
        if PACKAGES_WRITE.match(text) and job not in writers:
            where = f"job {job}" if job else "the workflow level"
            lines.append(f"{name}:{number}: packages: write on {where}, which does not push a package")
    if name in READ_AT_TOP and not any(CONTENTS_READ.match(text) for _, job, text in _scoped_lines(source) if not job):
        lines.append(f"{name}:1: no top-level permissions with contents: read")
    return lines


def main(argv: list[str]) -> int:
    """Check the workflows of one checkout, this one unless a root is named, and say so in the exit status."""
    root = Path(argv[0]) if argv else ROOT
    workflows = sorted((root / ".github" / "workflows").glob("*.yml"))
    lines = [
        line
        for path in workflows
        for check in (action_failures, pipe_failures, install_failures, container_failures, permission_failures)
        for line in check(path.name, path.read_text(encoding="utf-8"))
    ]

    dockerfile = root / "Dockerfile"
    if dockerfile.is_file():
        lines += dockerfile_failures(dockerfile.name, dockerfile.read_text(encoding="utf-8"))

    for line in lines:
        print(line)
    if lines:
        print(f"\n{len(lines)} problem(s). Pin every action and image, check every download, install from the lock.")
        return 1
    print(f"[ok] all {len(workflows)} workflows and the Dockerfile pin their remote code")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
