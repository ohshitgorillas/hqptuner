"""The gate that holds the release pipeline's remote code to a pin.

``scripts/gates/check_supply_chain.py`` reads the checkout's workflows and
names every line that fetches code a remote party can change under the same
name. Cases drive the seams on literal workflow text, and ``main(argv)`` on a
checkout laid down under ``tmp_path``.

Seams are ``action_failures(name, source)`` and ``main(argv)``.
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
