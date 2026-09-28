"""``scripts/eqtools_mcp.py`` runs the EQ session's two tools, eqlab and eqstage, on one job.

``run_job(tool, job, root, env)`` takes a tool name, a job (a path to a job file
under ``docs/eq-assistant/sessions/`` or an inline job object), the checkout root and
the environment the tool runs in. It returns a ``JobResult`` carrying the tool's
stdout, or raises ``ToolError`` with a ``code``.

Cases build a checkout root under ``tmp_path`` whose two tool scripts are shell stubs
that print their own name, a colon, then their stdin, and put a ``node`` on the
tool's ``PATH`` that runs its script with ``sh``.
"""

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path
from types import ModuleType

import pytest


class FixtureError(Exception):
    """A test's own scaffolding is wrong, not a failure of the behavior under test."""

    def __init__(self, *, reason: str) -> None:
        super().__init__(reason)


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"

#: each tool's script, as the stub checkout lays it out
STUBS = {"eqlab": "hqptuner/static/vendor/eqlab/src/eqlab.js", "eqstage": "scripts/eqstage/eqstage.js"}


def _load(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    monkeypatch.syspath_prepend(str(SCRIPTS_DIR))
    path = SCRIPTS_DIR / "eqtools_mcp.py"
    spec = importlib.util.spec_from_file_location("eqtools_mcp_under_test", path)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {path}")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "eqtools_mcp_under_test", module)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def eqtools(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return _load(monkeypatch)


@pytest.fixture
def root(tmp_path: Path) -> Path:
    for name, rel in STUBS.items():
        script = tmp_path / rel
        script.parent.mkdir(parents=True)
        script.write_text(f"printf '%s:' {name}\ncat\n")
    (tmp_path / "docs" / "eq-assistant" / "sessions" / "hd600").mkdir(parents=True)
    return tmp_path


def _which(name: str) -> Path:
    found = shutil.which(name)
    if found is None:
        raise FixtureError(reason=f"no {name} on PATH")
    return Path(found)


@pytest.fixture
def env(tmp_path: Path) -> dict[str, str]:
    sh = _which("sh")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    node = bin_dir / "node"
    node.write_text(f'#!{sh}\nexec {sh} "$1"\n')
    node.chmod(0o755)
    return {"PATH": os.pathsep.join([str(bin_dir), str(sh.parent), str(_which("cat").parent)])}


def _job_file(root: Path, rel: str, text: str) -> str:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return str(path)


def _refusal(eqtools: ModuleType, tool: str, job: object, root: Path, env: dict[str, str]) -> str:
    """Return the refusal code `run_job` raised, or an empty string when it ran the job."""
    try:
        eqtools.run_job(tool, job, root, env)
    except eqtools.ToolError as refused:
        return str(refused.code)
    return ""


@pytest.mark.parametrize("tool", ["eqlab", "eqstage"])
def test_each_tool_runs_its_own_script(eqtools: ModuleType, root: Path, env: dict[str, str], tool: str) -> None:
    result = eqtools.run_job(tool, {"job": {"kind": "vocab"}}, root, env)
    assert result.stdout.split(":", 1)[0] == tool


def test_inline_job_reaches_the_tool_as_json(eqtools: ModuleType, root: Path, env: dict[str, str]) -> None:
    job = {"job": {"kind": "vocab", "terms": ["boomy", "warm"]}}
    result = eqtools.run_job("eqlab", job, root, env)
    assert json.loads(result.stdout.split(":", 1)[1]) == job


def test_job_file_reaches_the_tool_byte_for_byte(eqtools: ModuleType, root: Path, env: dict[str, str]) -> None:
    text = '{"eq": {"bands": [{"type": "peak", "f": 5000, "q": 2, "g": -4}]}, "dry_run": true}\n'
    path = _job_file(root, "docs/eq-assistant/sessions/hd600/turn-3.json", text)
    result = eqtools.run_job("eqstage", path, root, env)
    assert result.stdout.split(":", 1)[1] == text


def test_relative_job_path_resolves_against_the_root(eqtools: ModuleType, root: Path, env: dict[str, str]) -> None:
    _job_file(root, "docs/eq-assistant/sessions/hd600/turn-4.json", '{"n": 4}')
    result = eqtools.run_job("eqlab", "docs/eq-assistant/sessions/hd600/turn-4.json", root, env)
    assert result.stdout.split(":", 1)[1] == '{"n": 4}'


@pytest.mark.parametrize(
    "rel",
    [
        "docs/eq-assistant/job.json",
        "docs/eq-assistant/sessions/../job.json",
        "scripts/eqstage/job.json",
    ],
)
def test_job_file_outside_sessions_is_refused(eqtools: ModuleType, root: Path, env: dict[str, str], rel: str) -> None:
    _job_file(root, rel, "{}")
    assert _refusal(eqtools, "eqlab", str(root / rel), root, env) == "job_outside_sessions"


def test_symlink_out_of_sessions_is_refused(eqtools: ModuleType, root: Path, env: dict[str, str]) -> None:
    target = Path(_job_file(root, "docs/secret.json", "{}"))
    link = root / "docs" / "eq-assistant" / "sessions" / "hd600" / "link.json"
    link.symlink_to(target)
    assert _refusal(eqtools, "eqlab", str(link), root, env) == "job_outside_sessions"


@pytest.mark.parametrize("tool", ["curl", "eqlab.js", "", "apply"])
def test_unknown_tool_is_refused(eqtools: ModuleType, root: Path, env: dict[str, str], tool: str) -> None:
    assert _refusal(eqtools, tool, {"job": {}}, root, env) == "unknown_tool"


@pytest.mark.parametrize("job", [None, 3, ["a"], True])
def test_job_that_is_neither_path_nor_object_is_refused(
    eqtools: ModuleType, root: Path, env: dict[str, str], job: object
) -> None:
    assert _refusal(eqtools, "eqlab", job, root, env) == "bad_job"


def test_tools_call_without_a_job_is_an_error_result(eqtools: ModuleType) -> None:
    response = eqtools.handle_request({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "eqlab"}})
    assert (response or {}).get("result", {}).get("isError") is True


def test_tools_list_names_exactly_the_two_tools(eqtools: ModuleType) -> None:
    response = eqtools.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert sorted(t["name"] for t in (response or {})["result"]["tools"]) == ["eqlab", "eqstage"]
