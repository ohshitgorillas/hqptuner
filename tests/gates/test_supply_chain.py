"""The gate that holds the release pipeline's remote code to a pin.

``scripts/gates/check_supply_chain.py`` reads the checkout's workflows and
names every line that fetches code a remote party can change under the same
name. Cases drive the seams on literal workflow text, and ``main(argv)`` on a
checkout laid down under ``tmp_path``.

Seams are ``action_failures(name, source)``, ``pipe_failures(name, source)``,
``install_failures(name, source)`` and ``main(argv)``.
"""

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found by path: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_supply_chain.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_supply_chain_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
ACTION_FAILURES = GATE.action_failures
PIPE_FAILURES = GATE.pipe_failures
INSTALL_FAILURES = GATE.install_failures
MAIN = GATE.main

#: A commit SHA as GitHub prints it.
SHA = "0123456789abcdef0123456789abcdef01234567"


def workflow_using(ref: str) -> str:
    """A workflow whose one step runs the action named by ``ref``."""
    return f"jobs:\n  build:\n    steps:\n      - uses: {ref}\n"


def checkout_with(root: Path, ref: str) -> list[str]:
    """Lay a checkout holding one workflow that uses ``ref``; the argv naming it."""
    workflows = root / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "release.yml").write_text(workflow_using(ref), encoding="utf-8")
    return [str(root)]


# --- action pins ------------------------------------------------------------


def test_an_action_named_by_tag_names_its_file() -> None:
    assert "release.yml" in ACTION_FAILURES("release.yml", workflow_using("actions/checkout@v5"))[0]


def test_an_action_named_by_tag_names_its_ref() -> None:
    assert "actions/checkout@v5" in ACTION_FAILURES("release.yml", workflow_using("actions/checkout@v5"))[0]


@pytest.mark.parametrize(
    ("ref", "count"),
    [
        ("actions/checkout@v5", 1),
        ("docker/login-action@0123abc", 1),
        (f"actions/checkout@{SHA} # v5.0.0", 0),
        ("./.github/workflows/check.yml", 0),
    ],
    ids=["tag", "short sha", "full sha", "local call"],
)
def test_only_a_remote_action_not_named_by_a_full_sha_is_a_failure(ref: str, count: int) -> None:
    assert len(ACTION_FAILURES("release.yml", workflow_using(ref))) == count


# --- pipe to shell ----------------------------------------------------------


def workflow_running(command: str) -> str:
    """A workflow whose one step runs the shell line ``command``."""
    return f"jobs:\n  build:\n    steps:\n      - run: {command}\n"


@pytest.mark.parametrize(
    ("command", "count"),
    [
        ("curl -LsSf https://astral.sh/uv/install.sh | sh", 1),
        ("curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh", 1),
        ("wget -qO- https://example.org/install | sudo bash", 1),
        ("irm https://astral.sh/uv/install.ps1 | iex", 1),
        ("Invoke-RestMethod https://example.org/install.ps1 | Invoke-Expression", 1),
        ('curl -LsSfO "$base/checksums.txt"', 0),
        ('grep " $tarball\\$" checksums.txt | sha256sum -c -', 0),
        ("bash scripts/ci/install-uv.sh /usr/local/bin", 0),
    ],
    ids=["curl sh", "curl env sh", "wget sudo bash", "irm iex", "Invoke-RestMethod", "download", "checksum", "script"],
)
def test_only_a_fetched_script_piped_into_a_shell_is_a_failure(command: str, count: int) -> None:
    assert len(PIPE_FAILURES("release.yml", workflow_running(command))) == count


def test_a_piped_install_names_its_file_and_line() -> None:
    assert PIPE_FAILURES("release.yml", workflow_running("curl https://x | sh"))[0].startswith("release.yml:4:")


def test_a_checkout_with_a_piped_install_exits_nonzero(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "release.yml").write_text(workflow_running("curl https://x | sh"), encoding="utf-8")
    assert MAIN([str(tmp_path)]) == 1


# --- installs from the lock -------------------------------------------------


def job_running(job: str, command: str) -> str:
    """A workflow whose one job, named ``job``, runs the shell line ``command``."""
    return f"jobs:\n  {job}:\n    steps:\n      - run: {command}\n"


@pytest.mark.parametrize(
    ("command", "count"),
    [
        ('pip install -e ".[dev]"', 1),
        ('.venv/bin/pip install -e ".[dev]"', 1),
        ("python -m pip install requests", 1),
        ("uv pip install requests", 1),
        ("uv pip install . pyinstaller", 1),
        ("uv sync --python 3.14 --extra dev", 1),
        ("uv sync --frozen --extra dev", 1),
        ("uv tool install ruff", 1),
        ("uv pip install triviajudge requests", 1),
        ("uv pip install --python .venv/bin/python triviajudge==0.7.0 pytest", 1),
        ("uv pip install --python .venv/bin/python pytest", 1),
        ("uv sync --locked --python 3.14 --extra dev", 0),
        ("uv sync --locked --python 3.14 --extra dev --no-install-project --no-install-package filepawl", 0),
        ("uv pip install --python .venv/bin/python triviajudge", 0),
        ("uv pip install triviajudge", 0),
        ("npm ci", 0),
        ("make check IDLE_GATE=off", 0),
        ('bash scripts/ci/install-uv.sh "$RUNNER_TEMP/uv"', 0),
    ],
    ids=[
        "pip",
        "venv pip",
        "python -m pip",
        "uv pip",
        "uv pip dot",
        "sync unlocked",
        "sync frozen",
        "tool install",
        "extra name",
        "extra name after pin",
        "other name",
        "locked sync",
        "locked sync, no project",
        "triviajudge",
        "triviajudge, bare",
        "npm",
        "make",
        "install-uv",
    ],
)
def test_only_a_locked_sync_or_a_triviajudge_install_passes_in_check(command: str, count: int) -> None:
    assert len(INSTALL_FAILURES("check.yml", job_running("check", command))) == count


@pytest.mark.parametrize("job", ["check", "e2e"])
def test_an_unlocked_install_names_its_file_and_job(job: str) -> None:
    line = INSTALL_FAILURES("check.yml", job_running(job, "pip install requests"))[0]
    assert line.startswith(f"check.yml:4: job {job}:")


@pytest.mark.parametrize(
    ("step", "count"),
    [
        ("|\n          uv pip install --python .venv/bin/python \\\n            requests", 1),
        ("|\n          uv pip install --python .venv/bin/python \\\n            triviajudge", 0),
    ],
    ids=["other name", "triviajudge"],
)
def test_an_install_continued_over_lines_is_judged_whole(step: str, count: int) -> None:
    assert len(INSTALL_FAILURES("check.yml", job_running("check", step))) == count


@pytest.mark.parametrize(
    ("line", "count"),
    [("# never pip install here", 0), ("- run: pip install requests", 1)],
    ids=["comment", "step"],
)
def test_a_comment_naming_pip_install_is_not_an_install(line: str, count: int) -> None:
    source = f"jobs:\n  check:\n    steps:\n      {line}\n"
    assert len(INSTALL_FAILURES("check.yml", source)) == count


@pytest.mark.parametrize(("name", "count"), [("docker.yml", 0), ("check.yml", 1)], ids=["other workflow", "check"])
def test_only_a_workflow_under_the_lock_rule_is_judged(name: str, count: int) -> None:
    assert len(INSTALL_FAILURES(name, job_running("push", "pip install requests"))) == count


def test_a_checkout_with_an_unlocked_install_in_check_exits_nonzero(tmp_path: Path) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "check.yml").write_text(job_running("check", "pip install requests"), encoding="utf-8")
    assert MAIN([str(tmp_path)]) == 1


# --- main -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ref", "code"), [("actions/checkout@v5", 1), (f"actions/checkout@{SHA} # v5.0.0", 0)], ids=["tag", "full sha"]
)
def test_a_checkout_exits_nonzero_only_when_an_action_is_named_by_tag(tmp_path: Path, ref: str, code: int) -> None:
    assert MAIN(checkout_with(tmp_path, ref)) == code


def test_a_checkout_failure_is_printed_on_stdout(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    MAIN(checkout_with(tmp_path, "actions/checkout@v5"))
    assert "actions/checkout@v5" in capsys.readouterr().out


def own_argv(_root: Path) -> list[str]:
    """No argument: the gate reads the checkout it sits in."""
    return []


def tagged_argv(root: Path) -> list[str]:
    """The argv naming a checkout under ``root`` whose one action is named by tag."""
    return checkout_with(root, "actions/checkout@v5")


@pytest.mark.parametrize(("argv_for", "code"), [(own_argv, 0), (tagged_argv, 1)], ids=["own", "tagged"])
def test_the_repos_own_workflows_pass(tmp_path: Path, argv_for: Callable[[Path], list[str]], code: int) -> None:
    """The point of the gate: this repo's workflows name every remote action by commit."""
    assert MAIN(argv_for(tmp_path)) == code
