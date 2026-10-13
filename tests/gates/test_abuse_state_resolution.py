"""Where the abuse bracket finds HQPTuner's state, and which stores it brackets.

``scripts/abuse.sh`` snapshots HQPTuner's own stores at ``open`` and puts them
back at ``close``. It resolves two things at run time from the repo it lives in:
the state root, from ``HQPTUNER_ABUSE_STATE`` in the environment or else the
host's ``hqpcreds`` line of that name, refusing when neither names one; and the
store list, from the ``HQPTUNER_*`` paths under ``/state`` that the
``Dockerfile`` ENV block names, less ``backups``, the debug log and junkcal.
``status`` prints what it resolved, which is the surface read here.

Each case builds a miniature repository under ``tmp_path``: a copy of this
checkout's ``scripts/abuse.sh``, a ``Dockerfile`` the case writes, and an
``hqpcreds`` where the case wants a host default. Only ``status`` ever runs, so
nothing is snapshotted or restored. The child gets an explicit environment, not
the developer's: no ambient ``HQPTUNER_ABUSE_STATE`` reaches it, and its API knob
names a loopback port that is bound but never listening, so nothing it might ask
reaches a running app.

The report's layout is not pinned. A state root is read as its full path
appearing in stdout; the store list as which of the names the case's
``Dockerfile`` could have yielded appear in stdout as whole names, once the
case's own scratch directory is cut out of it.
"""

import os
import re
import shutil
import socket
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from narrow import FixtureError

#: The script under test, found relative to this file: it lives in
#: ``scripts/``, outside any package.
ABUSE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "abuse.sh"

#: The exit status ``abuse.sh`` refuses with, a precondition the operator has to
#: put right.
REFUSED = 3

#: Ceiling on one script run: a hang guard, not a duration anything is expected
#: to take.
RUN_TIMEOUT = 60

#: The host lines ``hqpcreds`` carries beside the abuse root, in its
#: ``NAME=value`` shape.
CHROMIUM_LINE = "HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell"
USERNAME_LINE = "HQPTUNER_HQP_USERNAME=hqplayer"

#: The three stores every case's ``Dockerfile`` names: two files and a directory.
STORE_ENTRIES = (
    "HQPTUNER_TALLY_FILE=/state/tally.json",
    "HQPTUNER_LEDGER_DIR=/state/ledger",
    "HQPTUNER_ROSTER_FILE=/state/roster.json",
)
STORES = frozenset({"tally.json", "ledger", "roster.json"})

#: Every name a case's ``Dockerfile`` puts after a path separator, store or not.
NAMED = STORES | {"backups", "audit.jsonl", "junkcal", "pipcache", "catalog", "scratch"}


def dockerfile(*, extra_env: str | None = None, preamble: str = "") -> str:
    """An image recipe in the shape of the repo's own: one ENV block continued by
    backslashes, the stores in it, a non-path knob closing it, and one more
    entry slipped in after the first store where a case asks for it."""
    slipped = [extra_env] if extra_env else []
    entries = [STORE_ENTRIES[0], *slipped, *STORE_ENTRIES[1:], "HQPTUNER_LISTEN_HOST=0.0.0.0"]
    block = " \\\n    ".join(entries)
    return (
        "FROM python:3.12-slim\n"
        f"{preamble}"
        "RUN mkdir -p /state\n"
        f"ENV {block}\n"
        "USER hqptuner\n"
        'CMD ["python", "-m", "hqptuner"]\n'
    )


#: A ``Dockerfile`` that also names one thing the store list must leave out.
WITH_NON_STORE = {
    "backups": dockerfile(extra_env="HQPTUNER_BACKUP_DIR=/state/backups"),
    "the debug log": dockerfile(extra_env="HQPTUNER_DEBUG_LOG=/state/audit.jsonl"),
    "junkcal": dockerfile(extra_env="HQPTUNER_JUNKCAL_DIR=/state/junkcal"),
    "a /state path not named HQPTUNER_*": dockerfile(extra_env="PIP_CACHE_DIR=/state/pipcache"),
    "an HQPTUNER_* path outside /state": dockerfile(extra_env="HQPTUNER_DATA_DIR=/app/catalog"),
    "an HQPTUNER_* /state path outside the ENV block": dockerfile(preamble="ARG HQPTUNER_SCRATCH_DIR=/state/scratch\n"),
}


@pytest.fixture
def dead_api() -> Iterator[str]:
    """A loopback URL whose port is held but never listened on, so a connect is refused."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
        held.bind(("127.0.0.1", 0))
        yield f"http://127.0.0.1:{held.getsockname()[1]}"


def miniature_repo(tmp_path: Path, recipe: str, creds: str | None) -> Path:
    """A repo root carrying this checkout's ``abuse.sh``, the given ``Dockerfile``
    and, unless ``creds`` is None, an ``hqpcreds`` with that text."""
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    if not ABUSE_PATH.is_file():
        raise FixtureError(reason=f"no abuse script at {ABUSE_PATH}")
    shutil.copy2(ABUSE_PATH, repo / "scripts" / "abuse.sh")
    (repo / "Dockerfile").write_text(recipe, encoding="utf-8")
    if creds is not None:
        (repo / "hqpcreds").write_text(creds, encoding="utf-8")
    return repo


def root_dir(tmp_path: Path, name: str) -> Path:
    """A state root outside the miniature repo, made so it exists as a host's would."""
    root = tmp_path / name
    root.mkdir()
    return root


def creds_naming(root: Path) -> str:
    """An ``hqpcreds`` whose abuse root line sits between two other host lines."""
    return f"{CHROMIUM_LINE}\nHQPTUNER_ABUSE_STATE={root}\n{USERNAME_LINE}\n"


def status(repo: Path, api: str, override: Path | None = None) -> subprocess.CompletedProcess[str]:
    """``scripts/abuse.sh status`` in the miniature repo, as an operator runs it."""
    env = {"PATH": os.environ.get("PATH", ""), "HOME": str(repo.parent), "LC_ALL": "C", "HQPTUNER_ABUSE_API": api}
    if override is not None:
        env["HQPTUNER_ABUSE_STATE"] = str(override)
    return subprocess.run(
        ["./scripts/abuse.sh", "status"],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=RUN_TIMEOUT,
    )


def reported_stores(stdout: str, scratch: Path) -> set[str]:
    """Which names the case's ``Dockerfile`` could yield appear in the report as
    whole names, with the case's scratch directory cut out first."""
    text = stdout.replace(str(scratch), "")
    return {name for name in NAMED if re.search(rf"(?<![\w.-]){re.escape(name)}(?![\w.-])", text)}


def test_without_an_override_the_state_root_is_the_one_hqpcreds_names(tmp_path: Path, dead_api: str) -> None:
    host_root = root_dir(tmp_path, "host-root")
    repo = miniature_repo(tmp_path, dockerfile(), creds_naming(host_root))
    assert str(host_root) in status(repo, dead_api).stdout


@pytest.mark.parametrize(
    "creds",
    [None, f"{CHROMIUM_LINE}\n{USERNAME_LINE}\n"],
    ids=["no hqpcreds", "hqpcreds without the abuse root line"],
)
def test_without_an_override_or_a_host_default_status_refuses(tmp_path: Path, dead_api: str, creds: str | None) -> None:
    repo = miniature_repo(tmp_path, dockerfile(), creds)
    assert status(repo, dead_api).returncode == REFUSED


@pytest.mark.parametrize("host_root", ["host-root", None], ids=["hqpcreds names another root", "no hqpcreds"])
def test_an_override_in_the_environment_is_the_state_root(tmp_path: Path, dead_api: str, host_root: str | None) -> None:
    override = root_dir(tmp_path, "override-root")
    creds = None if host_root is None else creds_naming(root_dir(tmp_path, host_root))
    repo = miniature_repo(tmp_path, dockerfile(), creds)
    assert str(override) in status(repo, dead_api, override).stdout


@pytest.mark.parametrize("recipe", WITH_NON_STORE.values(), ids=WITH_NON_STORE.keys())
def test_the_stores_are_the_env_blocks_hqptuner_state_paths_whatever_else_the_dockerfile_names(
    tmp_path: Path, dead_api: str, recipe: str
) -> None:
    repo = miniature_repo(tmp_path, recipe, None)
    report = status(repo, dead_api, root_dir(tmp_path, "override-root"))
    assert reported_stores(report.stdout, tmp_path) == STORES
