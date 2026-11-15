#!/usr/bin/env python3
"""Gate: a release ships its checksums, packages and images signed, and its git dependencies at one commit.

A signature that is never made leaves nothing for a user to check, and nothing
else in the pipeline fails when a signing step is deleted. So the release
workflow writes ``SHA256SUMS``, signs it with GPG and attaches both; the deb and
rpm each carry an nfpm signature block naming a key; and a job in the
``image-signing`` environment runs ``cosign sign`` on an image named by digest.

A git dependency named by branch or tag is code its owner can change under the
same name, the same hole as an action named by tag. Every ``git+`` requirement
and every git source in ``pyproject.toml`` names a full commit.

Usage: ``python scripts/gates/check_release_signatures.py [checkout-root]``
"""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

ROOT = Path(__file__).resolve().parent.parent.parent

#: The checksum file written from the assets, its detached GPG signature, the check of that signature, and the release
#: that attaches both.
WRITES_SUMS = re.compile(r"\bsha256sum\b.*>\s*\S*SHA256SUMS\b")
SIGNS_SUMS = re.compile(r"\bgpg\b.*--detach-sign\b.*\bSHA256SUMS\b")
VERIFIES_SUMS = re.compile(r"\bgpg\b.*--verify\b.*\bSHA256SUMS\.asc\b")
RELEASE_CREATE = re.compile(r"\bgh\s+release\s+create\b")

#: A job header under ``jobs:``, a job's ``environment:`` naming the image-signing one, and a ``cosign sign`` of an
#: image named by digest, literal or by variable.
JOB_HEADER = re.compile(r"^  (?P<job>[\w-]+):\s*$")
IMAGE_SIGNING = re.compile(r"^    environment:\s*image-signing\s*$")
SIGNS_DIGEST = re.compile(r"\bcosign\s+sign\b.*@(?:sha256:[0-9a-f]{64}|\$\{?\w+\}?)")

#: A top-level key of a YAML file, a ``signature:`` key, and a ``key_file:`` with a value that is not empty.
TOP_KEY = re.compile(r"^(?P<key>[\w-]+):")
SIGNATURE = re.compile(r"^(?P<indent>\s+)signature:\s*$")
KEY_FILE = re.compile(r"^\s+key_file:\s*(?P<value>\S.*?)\s*$")

#: A ``git+`` URL and the ref after its last ``@``, and a ref naming a full commit.
GIT_URL = re.compile(r"git\+(?P<url>[^\s;\"']+)")
FULL_COMMIT = re.compile(r"[0-9a-f]{40}")


def _code(source: str) -> list[str]:
    """Return the lines of a file that are not comments, YAML's and the shell's alike."""
    return [text for text in source.splitlines() if not text.lstrip().startswith("#")]


def checksum_failures(name: str, source: str) -> list[str]:
    """One line per checksum step a release lacks: writing SHA256SUMS, signing it, checking it, attaching both."""
    lines = _code(source)
    problems = []
    if not any(WRITES_SUMS.search(line) for line in lines):
        problems.append("no job writes SHA256SUMS with sha256sum")
    if not any(SIGNS_SUMS.search(line) for line in lines):
        problems.append("no job signs SHA256SUMS with gpg --detach-sign")
    if not any(VERIFIES_SUMS.search(line) for line in lines):
        problems.append("no job checks SHA256SUMS.asc with gpg --verify before the release")
    if not any(RELEASE_CREATE.search(line) and "SHA256SUMS.asc" in line for line in lines):
        problems.append("the release does not attach SHA256SUMS.asc")
    return [f"{name}: {problem}" for problem in problems]


def _signed_packages(source: str) -> set[str]:
    """Name the top-level sections of an nfpm config holding a ``signature:`` block that names a key file."""
    signed: set[str] = set()
    section, depth = "", -1
    for text in _code(source):
        top = TOP_KEY.match(text)
        signature = SIGNATURE.match(text)
        key_file = KEY_FILE.match(text)
        if top:
            section, depth = top["key"], -1
        elif signature:
            depth = len(signature["indent"])
        elif text.strip() and len(text) - len(text.lstrip()) <= depth:
            depth = -1
        elif key_file and depth >= 0 and key_file["value"].strip("'\"").strip():
            signed.add(section)
    return signed


def package_signature_failures(name: str, source: str) -> list[str]:
    """One line per package, deb and rpm, whose nfpm config carries no signature naming a key file."""
    signed = _signed_packages(source)
    return [
        f"{name}: the {package} package carries no signature naming a key_file"
        for package in ("deb", "rpm")
        if package not in signed
    ]


def _job_lines(source: str) -> Iterator[tuple[str, str]]:
    """Each line under a workflow's ``jobs:`` with the job it sits in; comments left out."""
    in_jobs, job = False, ""
    for text in _code(source):
        if re.match(r"\S", text):
            in_jobs, job = text.startswith("jobs:"), ""
            continue
        header = JOB_HEADER.match(text)
        if in_jobs and header:
            job = header["job"]
        elif job:
            yield job, text


def image_signature_failures(name: str, source: str) -> list[str]:
    """One line when no job in the image-signing environment runs ``cosign sign`` on an image named by digest."""
    in_environment: set[str] = set()
    signs: set[str] = set()
    for job, text in _job_lines(source):
        if IMAGE_SIGNING.match(text):
            in_environment.add(job)
        if SIGNS_DIGEST.search(text):
            signs.add(job)
    if in_environment & signs:
        return []
    return [f"{name}: no job in environment: image-signing runs cosign sign on an image digest"]


def _requirements(data: dict[str, object]) -> Iterator[str]:
    """Every requirement string ``pyproject.toml`` lists: dependencies, optional dependencies, dependency groups."""
    project = data.get("project")
    project = project if isinstance(project, dict) else {}
    lists: list[object] = [project.get("dependencies")]
    for table in (project.get("optional-dependencies"), data.get("dependency-groups")):
        lists += list(table.values()) if isinstance(table, dict) else []
    for entries in lists:
        yield from (entry for entry in entries if isinstance(entry, str)) if isinstance(entries, list) else ()


def _git_sources(data: dict[str, object]) -> Iterator[tuple[str, dict[str, object]]]:
    """Each ``[tool.uv.sources]`` entry that fetches from git, by package name."""
    tool = data.get("tool")
    uv = tool.get("uv") if isinstance(tool, dict) else None
    sources = uv.get("sources") if isinstance(uv, dict) else None
    for package, source in sources.items() if isinstance(sources, dict) else ():
        if isinstance(source, dict) and "git" in source:
            yield str(package), source


def git_pin_failures(name: str, source: str) -> list[str]:
    """One line per git requirement or git source in ``pyproject.toml`` that names no full commit."""
    data = tomllib.loads(source)
    lines = []
    for requirement in _requirements(data):
        url = GIT_URL.search(requirement)
        if url and not FULL_COMMIT.fullmatch(url["url"].rpartition("@")[2]):
            lines.append(f"{name}: git+{url['url']} is not pinned to a full 40-hex commit")
    for package, entry in _git_sources(data):
        if not FULL_COMMIT.fullmatch(str(entry.get("rev", ""))):
            lines.append(f"{name}: the git source of {package} is not pinned to a full 40-hex commit by rev")
    return lines


#: Each file the gate reads, by path under the checkout, with the check that reads it.
CHECKS: dict[str, Callable[[str, str], list[str]]] = {
    ".github/workflows/release.yml": checksum_failures,
    ".github/workflows/docker.yml": image_signature_failures,
    "packaging/linux/nfpm.yaml": package_signature_failures,
    "pyproject.toml": git_pin_failures,
}


def main(argv: list[str]) -> int:
    """Check one checkout, this one unless a root is named, and say so in the exit status."""
    root = Path(argv[0]) if argv else ROOT
    lines: list[str] = []
    for relative, check in CHECKS.items():
        path = root / relative
        if not path.is_file():
            lines.append(f"{relative}: missing, so nothing in it is signed")
            continue
        lines += check(path.name, path.read_text(encoding="utf-8"))
    for line in lines:
        print(line)
    if lines:
        print(f"\n{len(lines)} problem(s). Sign every checksum file, package and image; pin every git dependency.")
        return 1
    print("[ok] the release signs its checksums, packages and images, and every git dependency names a commit")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
