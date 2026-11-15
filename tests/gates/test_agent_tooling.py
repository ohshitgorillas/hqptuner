"""The gate that holds the tracked agent settings to exact commands and no MCP self-enable.

``scripts/gates/check_agent_tooling.py`` reads ``.claude/settings.json`` under a
checkout and names every allow rule that runs ``pip install`` or ``npx`` and
every ``enabledMcpjsonServers`` key. Cases drive ``settings_failures(name,
source)`` on literal file text, and ``main(argv)`` on a checkout laid down under
``tmp_path``.
"""

import importlib.util
import json
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found by path: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_agent_tooling.py"

#: The settings file under a checkout root.
SETTINGS = ".claude/settings.json"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_agent_tooling_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
SETTINGS_FAILURES = GATE.settings_failures
MAIN = GATE.main

#: Allow rules that run repo code by exact command.
EXACT_ALLOW = ["Bash(make check)", "Bash(git commit *)"]


def settings_text(allow: list[str], **top_level: object) -> str:
    """A settings file allowing ``allow``, with the keyword arguments as top-level keys beside ``permissions``."""
    return json.dumps({"permissions": {"allow": allow}, **top_level})


@pytest.mark.parametrize(
    ("source", "count"),
    [
        (settings_text(EXACT_ALLOW), 0),
        (settings_text([*EXACT_ALLOW, "Bash(.venv/bin/pip install *)"]), 1),
        (settings_text([*EXACT_ALLOW, "Bash(npx prettier *)"]), 1),
        (settings_text(EXACT_ALLOW, enabledMcpjsonServers=["hqpdoc"]), 1),
        (settings_text(["Bash(pip install x)", "Bash(npx y)"], enabledMcpjsonServers=[]), 3),
    ],
    ids=["exact rules only", "pip install", "npx", "mcp self-enable", "all three"],
)
def test_a_settings_file_fails_once_per_fault(source: str, count: int) -> None:
    assert len(SETTINGS_FAILURES(SETTINGS, source)) == count


@pytest.mark.parametrize(
    ("source", "word"),
    [
        (settings_text(["Bash(.venv/bin/pip install *)"]), "pip install"),
        (settings_text(["Bash(npx prettier *)"]), "npx"),
        (settings_text([], enabledMcpjsonServers=["hqpdoc"]), "enabledMcpjsonServers"),
    ],
    ids=["pip install", "npx", "mcp self-enable"],
)
def test_a_fault_line_names_what_is_wrong(source: str, word: str) -> None:
    assert [word in line for line in SETTINGS_FAILURES(SETTINGS, source)] == [True]


def lay_down(root: Path, source: str | None) -> list[str]:
    """Write ``source`` as the checkout's settings file, none when ``source`` is None, and return the argv naming it."""
    if source is not None:
        path = root / SETTINGS
        path.parent.mkdir(parents=True)
        path.write_text(source, encoding="utf-8")
    return [str(root)]


@pytest.mark.parametrize(
    ("source", "code"),
    [
        (settings_text(EXACT_ALLOW), 0),
        (settings_text(["Bash(npx prettier *)"]), 1),
        (None, 1),
        ("{", 1),
    ],
    ids=["exact", "broken", "missing", "not json"],
)
def test_a_checkout_exits_nonzero_only_when_its_settings_are_broken(
    tmp_path: Path, source: str | None, code: int
) -> None:
    assert MAIN(lay_down(tmp_path, source)) == code


def test_a_checkout_failure_is_printed_on_stdout(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    MAIN(lay_down(tmp_path, settings_text(["Bash(npx prettier *)"])))
    assert "npx prettier" in capsys.readouterr().out


def own_argv(_root: Path) -> list[str]:
    """No argument: the gate reads the checkout it sits in."""
    return []


def broken_argv(root: Path) -> list[str]:
    """The argv naming a checkout under ``root`` whose settings allow ``npx``."""
    return lay_down(root, settings_text(["Bash(npx prettier *)"]))


@pytest.mark.parametrize(("argv_for", "code"), [(own_argv, 0), (broken_argv, 1)], ids=["own", "broken"])
def test_the_repos_own_settings_are_held(tmp_path: Path, argv_for: Callable[[Path], list[str]], code: int) -> None:
    """The point of the gate: this repo's tracked settings allow no installer and enable no MCP server."""
    assert MAIN(argv_for(tmp_path)) == code
