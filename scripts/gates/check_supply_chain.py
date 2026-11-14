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


#: The jobs that may hold ``packages: write``, by workflow: the one that pushes the image and the one that pushes its
#: signature, which is a package in the registry too.
PACKAGE_WRITERS = {"docker.yml": frozenset({"build-push", "sign-image"})}

#: The workflows that must narrow the token to a read at the top: a caller's grant is the most a reusable one gets.
READ_AT_TOP = frozenset({"check.yml"})

#: A ``packages: write`` grant, and a ``contents: read`` one indented under a top-level ``permissions:``.
PACKAGES_WRITE = re.compile(r"^\s+packages:\s*write\b")
CONTENTS_READ = re.compile(r"^\s+contents:\s*read\b")


#: Any repository secret; the Apple certificate and notary key; and every secret that signs a release.
ANY_SECRET = re.compile(r"\bsecrets\.")
APPLE_SECRET = re.compile(r"\bsecrets\.(?:MACOS_|NOTARY_)\w+")
SIGNING_SECRET = re.compile(r"\bsecrets\.(?:MACOS_|NOTARY_|SIMPLYSIGN_|GPG_|RELEASE_GPG_)\w+")

#: A job reading the image-signing key, the one environment that holds it, and what makes a job a build.
COSIGN_SECRET = re.compile(r"\bsecrets\.COSIGN_\w+")
COSIGN_ENVIRONMENT = re.compile(r"^    environment:\s*image-signing\s*$")
BUILD_STEP = re.compile(
    r"\buses:\s*(?:actions/checkout|docker/build-push-action)@"
    r"|\b(?:docker\s+(?:buildx\s+)?build|make|pyinstaller|nfpm|npm|npx|uv|pip3?|pipx)\s"
)

#: A job's call of the check workflow, its own ``if:``, and its ``needs:`` on one line.
CHECK_CALL = re.compile(r"^    uses:\s*\./\.github/workflows/check\.yml\s*$")
JOB_IF = re.compile(r"^    if:")
NEEDS = re.compile(r"^    needs:\s*(?P<jobs>\S.*?)\s*$")

#: A job's ``environment:`` key naming the one environment that holds the signing secrets.
SIGNING_ENVIRONMENT = re.compile(r"^    environment:\s*signing\s*$")

#: The jobs that run the build and so hold no secret, and the workflows that must hold a job signing the macOS app.
SECRETLESS_JOBS = {"release.yml": frozenset({"build", "build-macos"})}
SIGNS_MACOS = frozenset({"release.yml"})

#: The jobs that sign, named so that deleting their environment line fails even where no secret is visible.
SIGNING_JOBS = {"release.yml": frozenset({"package-linux", "package-windows", "sign-macos"})}


#: The SimplySign login script: the pinned hash of its installer, the hash taken and compared, the line that runs the
#: installer, the removal of the seed from the environment, and the first process the script starts.
INSTALLER_PIN = re.compile(r"^\s*\$InstallerSha256\s*=\s*'[0-9a-fA-F]{64}'\s*$")
HASH_OF_FILE = re.compile(r"\bGet-FileHash\b.*-Algorithm\s+SHA256\b", re.IGNORECASE)
HASH_COMPARED = re.compile(r"\$InstallerSha256\b.*\s-(?:ne|eq)\s|\s-(?:ne|eq)\s.*\$InstallerSha256\b", re.IGNORECASE)
MSIEXEC = re.compile(r"\bmsiexec\b", re.IGNORECASE)
SEED_REMOVED = re.compile(r"^\s*Remove-Item\s+Env:\\?SIMPLYSIGN_OTPAUTH_URI\b", re.IGNORECASE)
START_PROCESS = re.compile(r"\bStart-Process\b", re.IGNORECASE)


#: What eqlab's tree holds besides the part the browser imports, which the bundle leaves out of ``static``.
EQLAB_DEV_DIRS = ("src", "tests", ".claude", ".git")


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


def secret_failures(name: str, source: str) -> list[str]:
    """One line per secret in the build job, per signing job outside the signing environment, per missing signer."""
    secretless = SECRETLESS_JOBS.get(name, frozenset())
    first: dict[str, int] = {}
    importers: dict[str, int] = {}
    apple = False
    in_signing: set[str] = set()
    lines: list[str] = []
    for number, job, text in _job_lines(source):
        first.setdefault(job, number)
        if job in secretless and ANY_SECRET.search(text):
            lines.append(f"{name}:{number}: job {job}: the build runs here and reads a secret: {text.strip()}")
        if SIGNING_SECRET.search(text):
            importers.setdefault(job, number)
            apple = apple or APPLE_SECRET.search(text) is not None
        if SIGNING_ENVIRONMENT.match(text):
            in_signing.add(job)
    signers = {
        job: importers.get(job, first[job])
        for job in importers.keys() | (SIGNING_JOBS.get(name, frozenset()) & first.keys())
    }
    lines += [
        f"{name}:{number}: job {job}: signs or reads a signing secret and is not in environment: signing"
        for job, number in sorted(signers.items(), key=lambda item: item[1])
        if job not in in_signing
    ]
    if name in SIGNS_MACOS and not apple:
        lines.append(f"{name}:1: no job imports the Apple signing secrets, so nothing signs the macOS app")
    return lines


def cosign_failures(name: str, source: str) -> list[str]:
    """One line per job that reads the image-signing key outside its environment, and per such job that builds."""
    reads: dict[str, int] = {}
    builds: dict[str, int] = {}
    in_environment: set[str] = set()
    for number, job, text in _job_lines(source):
        if COSIGN_SECRET.search(text):
            reads.setdefault(job, number)
        if BUILD_STEP.search(text):
            builds.setdefault(job, number)
        if COSIGN_ENVIRONMENT.match(text):
            in_environment.add(job)
    lines = [
        f"{name}:{number}: job {job}: reads a COSIGN secret and is not in environment: image-signing"
        for job, number in reads.items()
        if job not in in_environment
    ]
    lines += [
        f"{name}:{builds[job]}: job {job}: reads a COSIGN secret and runs a build step"
        for job in reads
        if job in builds
    ]
    return sorted(lines, key=lambda line: int(line.split(":")[1]))


def signing_check_failures(name: str, source: str) -> list[str]:
    """One line per job in the signing environment that does not wait on a check run on every trigger.

    ``needs:`` is read as one line, a name or a flow list; a block list reads as no needs.
    """
    calls: set[str] = set()
    limited: set[str] = set()
    needs: dict[str, set[str]] = {}
    signing: dict[str, int] = {}
    for number, job, text in _job_lines(source):
        if CHECK_CALL.match(text):
            calls.add(job)
        if JOB_IF.match(text):
            limited.add(job)
        found = NEEDS.match(text)
        if found:
            needs[job] = set(re.split(r"[\s,\[\]]+", found["jobs"])) - {""}
        if SIGNING_ENVIRONMENT.match(text):
            signing[job] = number
    runs_always = calls - limited
    return [
        f"{name}:{number}: job {job}: in environment: signing and does not wait on a check that runs on every trigger"
        for job, number in signing.items()
        if not needs.get(job, set()) & runs_always
    ]


def login_script_failures(name: str, source: str) -> list[str]:
    """One line per way the SimplySign login script runs the installer unchecked or starts a process with the seed."""
    code = [
        (number, text) for number, text in enumerate(source.splitlines(), start=1) if not text.lstrip().startswith("#")
    ]

    def first(pattern: re.Pattern[str]) -> int | None:
        return next((number for number, text in code if pattern.search(text)), None)

    lines: list[str] = []
    if not any(INSTALLER_PIN.match(text) for _, text in code):
        lines.append(f"{name}:1: no $InstallerSha256 pinned to a full SHA-256")
    msiexec, hashed, compared = first(MSIEXEC), first(HASH_OF_FILE), first(HASH_COMPARED)
    if msiexec is not None and (hashed is None or compared is None or max(hashed, compared) > msiexec):
        lines.append(
            f"{name}:{msiexec}: msiexec runs before the installer's SHA-256 is taken and compared with the pin"
        )
    start, removed = first(START_PROCESS), first(SEED_REMOVED)
    if start is not None and (removed is None or removed > start):
        lines.append(f"{name}:{start}: the seed is still in the environment at the first Start-Process")
    return lines


def spec_failures(name: str, source: str) -> list[str]:
    """One line per eqlab developer directory the frozen bundle's spec does not leave out of ``static``."""
    code = "\n".join(text for text in source.splitlines() if not text.lstrip().startswith("#"))
    return [
        f"{name}: does not leave out static/vendor/eqlab/{directory}"
        for directory in EQLAB_DEV_DIRS
        if f"static/vendor/eqlab/{directory}" not in code
    ]


def main(argv: list[str]) -> int:
    """Check the workflows of one checkout, this one unless a root is named, and say so in the exit status."""
    root = Path(argv[0]) if argv else ROOT
    workflows = sorted((root / ".github" / "workflows").glob("*.yml"))
    lines = [
        line
        for path in workflows
        for check in (
            action_failures,
            pipe_failures,
            install_failures,
            container_failures,
            permission_failures,
            secret_failures,
            cosign_failures,
            signing_check_failures,
        )
        for line in check(path.name, path.read_text(encoding="utf-8"))
    ]

    dockerfile = root / "Dockerfile"
    if dockerfile.is_file():
        lines += dockerfile_failures(dockerfile.name, dockerfile.read_text(encoding="utf-8"))

    spec = root / "hqptuner.spec"
    if spec.is_file():
        lines += spec_failures(spec.name, spec.read_text(encoding="utf-8"))

    login = root / "packaging" / "windows" / "simplysign-login.ps1"
    if login.is_file():
        lines += login_script_failures(login.name, login.read_text(encoding="utf-8"))

    for line in lines:
        print(line)
    if lines:
        print(f"\n{len(lines)} problem(s). Pin every action and image, check every download, install from the lock.")
        return 1
    print(f"[ok] all {len(workflows)} workflows and the Dockerfile pin their remote code")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
