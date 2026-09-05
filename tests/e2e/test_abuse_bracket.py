"""The abuse bracket's promise about HQPTuner's own state stores.

`scripts/abuse.sh open` brackets a hostile-input run and `close` ends it. What is
pinned here is what the bracket leaves behind on disk: a run writes into every
store HQPTuner owns, and `close` has to leave those stores as `open` found them.

Policy notes (docs/testing.md):

- One assertion per test.
- The subject is a shell script, so it is driven the way an operator drives it:
  a subprocess, its two environment knobs, and the files it leaves. Nothing
  reaches inside the script.
- No test waits on the wall clock. The script does its own bounded polling and
  the assertions read files it has already finished writing.
- The stores are addressed by their file names, which are wire identity
  (`Dockerfile`'s `HQPTUNER_*` path knobs), never by anything a user reads.
- The stack here is function-scoped, not the session one: the point of the first
  case is what the stores hold at the moment `open` runs, so it needs a server
  whose state nothing else has touched.
"""

import hashlib
import json
import os
import subprocess
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from e2e.support import stack as stack_support

#: Repo root — tests/e2e/test_abuse_bracket.py, so three parents up.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: Ceiling on one script run. The script's own restore poll is two minutes, so
#: this is a hang guard, not a duration anything is expected to take.
RUN_TIMEOUT = 300.0

#: Ceiling on one API call to the app, which is on loopback and already answering.
CALL_TIMEOUT = 30.0

#: The seven stores HQPTuner owns, as `Dockerfile`'s path knobs name them. The
#: directory is the config-preset store; the rest are single files.
STORES = (
    "presets",
    "live-presets.json",
    "favorites.json",
    "descriptions.json",
    "narrowing.json",
    "matrixmodes.json",
    "autopilot.json",
)


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _snapshot(state: Path) -> dict[str, str]:
    """Every file the seven stores hold right now, relative path to digest.

    A store that does not exist contributes nothing, so "the file the run created
    is gone again" and "the file the run changed is back" read as the same
    comparison.
    """
    found: dict[str, str] = {}
    for store in STORES:
        target = state / store
        if target.is_dir():
            found.update({str(p.relative_to(state)): _digest(p) for p in sorted(target.rglob("*")) if p.is_file()})
        elif target.is_file():
            found[store] = _digest(target)
    return found


def _call(stack: stack_support.Stack, method: str, path: str, body: dict[str, Any] | None = None) -> None:
    """Drive one of the app's write routes, raising on anything but a 2xx."""
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(  # noqa: S310 — literal loopback http URL
        f"{stack.base_url}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=CALL_TIMEOUT) as response:  # noqa: S310 — same URL
        response.read()


def _abuse(command: str, state: Path) -> subprocess.CompletedProcess[str]:
    """Run `scripts/abuse.sh <command>` against the stack, the way an operator runs it."""
    env = {**os.environ, "HQPTUNER_ABUSE_STATE": str(state)}
    return subprocess.run(  # noqa: S603 — fixed argv, the script under test
        [str(REPO_ROOT / "scripts" / "abuse.sh"), command],
        capture_output=True,
        text=True,
        timeout=RUN_TIMEOUT,
        check=False,
        env=env,
        cwd=str(REPO_ROOT),
    )


def _bracket(command: str, state: Path) -> subprocess.CompletedProcess[str]:
    """Run one end of the bracket, raising with the script's own output when it refuses."""
    result = _abuse(command, state)
    if result.returncode != 0:
        raise RuntimeError(f"abuse.sh {command} failed:\n{result.stdout}\n{result.stderr}")
    return result


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The directory the app writes every store into, and the one the bracket is pointed at."""
    area = tmp_path / "state"
    area.mkdir()
    # The bracket refuses to open without the event log, which the app builds a
    # read route for only when this is set.
    monkeypatch.setenv("HQPTUNER_DEBUG_LOG", str(area / "audit.jsonl"))
    return area


@pytest.fixture
def app(state: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[stack_support.Stack]:
    """A server of this test's own, with the bracket's API knob pointed at it.

    Function-scoped rather than the session stack: what the first case pins is the
    state the stores are in when `open` runs, so nothing else may have written there.
    """
    for running in stack_support.stack(state):
        monkeypatch.setenv("HQPTUNER_ABUSE_API", running.base_url)
        yield running


def _write_into_every_store(app: stack_support.Stack) -> None:
    """One value into each of the seven stores, as a hostile run would leave them."""
    _call(app, "PUT", "/api/livepresets/junk", {})
    _call(app, "POST", "/api/profile/save", {"name": "junkpreset"})
    _call(app, "PUT", "/api/favorites", {"filters": ["junk-filter"]})
    _call(app, "PUT", "/api/descriptions", {"name": "junkpreset", "text": "junk"})
    _call(app, "PUT", "/api/narrowing", {"facets": {"odd_rate_only": True}})
    _call(app, "PUT", "/api/matrixmodes", {"name": "junkpreset", "mode": "speakers"})
    _call(app, "POST", "/api/autopilot", {"enabled": True})


def test_close_leaves_every_store_as_open_found_it(app: stack_support.Stack, state: Path) -> None:
    """A run that writes into all seven stores leaves none of it behind."""
    _call(app, "PUT", "/api/livepresets/keep", {})
    _call(app, "PUT", "/api/descriptions", {"name": "keep", "text": "kept"})
    before = _snapshot(state)
    _bracket("open", state)
    _write_into_every_store(app)
    _bracket("close", state)
    assert _snapshot(state) == before


def test_close_refuses_when_the_snapshot_manifest_is_gone(app: stack_support.Stack, state: Path) -> None:
    """Without the manifest the bracket cannot tell an empty store from a lost snapshot, so it refuses."""
    _bracket("open", state)
    _call(app, "PUT", "/api/livepresets/junk", {})
    for manifest in (state / "abuse").rglob("manifest.json"):
        manifest.unlink()
    assert _abuse("close", state).returncode == 1
