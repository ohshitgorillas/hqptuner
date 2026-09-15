"""The release script's preflight: whether ``scripts/bump.sh`` lets a bump through.

``scripts/bump.sh <--major|--minor|--patch>`` authors the release commit, and
before it does it asks the Trivia Judge's changelog sweep whether the
``[Unreleased]`` section is fit to ship. What a caller observes is only this:
after the run, what version the tree carries, and what status the script
returned.

Each case builds a miniature repository under ``tmp_path`` — a copy of this
checkout's own ``scripts/bump.sh``, a stub judge at
``.venv/bin/triviajudge-changelog``, a ``pyproject.toml`` and an
``hqptuner/__init__.py`` agreeing on the starting version, a changelog with one
bullet under ``## [Unreleased]``, committed clean on a branch named ``dev`` —
and runs the real script against it with a real ``git``. Nothing here reads the
script's internals: the stub judge is the only thing the cases vary, and the
version in ``pyproject.toml`` and the script's exit status are the only things
they read back.

The child process gets an explicit environment rather than the developer's
(docs/testing.md rule 16): ``HOME`` lands in ``tmp_path``, the global and system
git configuration are pointed at a path that does not exist, and every ambient
``GIT_*`` name is dropped, so the committer is the one the miniature repo's own
configuration names and no test result depends on the shell it was run from.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""


def tool(name: str) -> str:
    """The absolute path of an executable these cases drive, refusing to collect without it."""
    found = shutil.which(name)
    if found is None:
        raise FixtureError(f"no {name} on this system, and these cases drive a real one")
    return found


#: Resolved once, absolutely: a bare name would be whatever the caller's PATH
#: happened to put first.
GIT = tool("git")
BASH = tool("bash")


#: The release script under test, found relative to this file: it lives in
#: ``scripts/``, outside any package.
BUMP_PATH = Path(__file__).resolve().parents[2] / "scripts" / "bump.sh"

#: Where the script looks for the changelog sweep, relative to the repo root.
JUDGE_REL = Path(".venv") / "bin" / "triviajudge-changelog"

#: The version the miniature repo starts at, and the one a ``--patch`` run is
#: expected to write over it.
START = "1.2.3"
NEXT = "1.2.4"

#: A changelog carrying one conformant bullet under ``## [Unreleased]`` and one
#: released section beneath it, in the shape this repo's changelog uses.
CHANGELOG = (
    "# Changelog\n"
    "\n"
    "Notable changes to HQPTuner.\n"
    "\n"
    "## [Unreleased]\n"
    "\n"
    "### Added\n"
    "\n"
    "- **The thing works now.** It did not before, and the fix is in this release.\n"
    "\n"
    f"## [{START}] — 2026-01-01\n"
    "\n"
    "### Added\n"
    "\n"
    "- **The earlier thing works.** It did not before that release either.\n"
)

PYPROJECT = f'[project]\nname = "hqptuner"\nversion = "{START}"\n'

INIT_PY = f'__version__ = "{START}"\n'

#: A judge that flags the changelog when asked about the release, and passes
#: every other question. A wiring that asks a different question hears a pass.
RELEASE_JUDGE = (
    "#!/usr/bin/env bash\n"
    'printf \'%s\\n\' "$*" >>"$0_LOG"\n'
    'if [ "$#" -eq 1 ] && [ "$1" = "--release" ]; then\n'
    "  exit 1\n"
    "fi\n"
    "exit 0\n"
)

#: Read back out of ``pyproject.toml`` the way any reader of that file would.
VERSION_LINE = re.compile(r'^version = "([^"]+)"$', re.MULTILINE)


def constant_judge(status: int) -> str:
    """A stub judge's source, answering ``status`` whatever it is asked."""
    return '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >>"$0_LOG"\n' + f"exit {status}\n"


def child_env(home: Path) -> dict[str, str]:
    """The environment the script runs under: this one's, less everything git
    reads, plus a HOME and a git configuration of our own."""
    env = {name: value for name, value in os.environ.items() if not name.startswith("GIT_")}
    env["HOME"] = str(home)
    env["LC_ALL"] = "C"
    env["GIT_CONFIG_GLOBAL"] = str(home / "no-such-gitconfig")
    env["GIT_CONFIG_SYSTEM"] = str(home / "no-such-gitconfig")
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def git(repo: Path, *args: str) -> None:
    """Run a git command in the miniature repo, refusing to continue if it fails."""
    done = subprocess.run(
        [GIT, *args],
        cwd=repo,
        env=child_env(repo.parent),
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    if done.returncode != 0:
        raise FixtureError(f"git {' '.join(args)} failed: {done.stderr}")


def miniature_repo(tmp_path: Path, judge: str) -> Path:
    """A clean one-commit repository on branch ``dev``, at version ``START``,
    carrying this checkout's release script and the given stub judge."""
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    (repo / "hqptuner").mkdir()
    (repo / JUDGE_REL).parent.mkdir(parents=True)
    if not BUMP_PATH.is_file():
        raise FixtureError(f"no release script at {BUMP_PATH}")
    shutil.copy2(BUMP_PATH, repo / "scripts" / "bump.sh")
    (repo / "pyproject.toml").write_text(PYPROJECT, encoding="utf-8")
    (repo / "hqptuner" / "__init__.py").write_text(INIT_PY, encoding="utf-8")
    (repo / "CHANGELOG.md").write_text(CHANGELOG, encoding="utf-8")
    stub = repo / JUDGE_REL
    stub.write_text(judge, encoding="utf-8")
    stub.chmod(0o755)
    git(repo, "init", "-b", "dev")
    git(repo, "config", "user.name", "Bump Fixture")
    git(repo, "config", "user.email", "bump@example.invalid")
    git(repo, "config", "commit.gpgsign", "false")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "start")
    return repo


def run_bump(repo: Path, *flags: str) -> subprocess.CompletedProcess[str]:
    """The release script, run against the miniature repo as a caller runs it."""
    return subprocess.run(
        [BASH, "scripts/bump.sh", *flags],
        cwd=repo,
        env=child_env(repo.parent),
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )


def version_of(repo: Path) -> str:
    """The version ``pyproject.toml`` carries."""
    found = VERSION_LINE.search((repo / "pyproject.toml").read_text(encoding="utf-8"))
    if found is None:
        raise FixtureError("no version line in the miniature repo's pyproject.toml")
    return found.group(1)


# --- the sweep decides whether the bump happens -----------------------------


@pytest.mark.parametrize(
    "judge_status,expected",
    [(0, NEXT), (1, START)],
    ids=["the sweep passes the changelog", "the sweep flags the changelog"],
)
def test_a_patch_bump_advances_the_version_only_when_the_changelog_sweep_passes(
    tmp_path: Path, judge_status: int, expected: str
) -> None:
    """The judge's answer is what decides it: a pass writes the next version, a
    flag leaves the tree at the one it started on."""
    repo = miniature_repo(tmp_path, constant_judge(judge_status))
    run_bump(repo, "--patch")
    assert version_of(repo) == expected


# --- which question the sweep is asked --------------------------------------


def test_a_patch_bump_fails_when_the_release_sweep_flags_the_changelog(tmp_path: Path) -> None:
    """The sweep judges the whole ``[Unreleased]`` section, not the bullets the
    last commit added: a judge answering only ``--release`` with a flag still
    stops the bump."""
    repo = miniature_repo(tmp_path, RELEASE_JUDGE)
    assert run_bump(repo, "--patch", "--dry-run").returncode == 1
