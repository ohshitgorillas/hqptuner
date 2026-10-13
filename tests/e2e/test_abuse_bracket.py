"""The abuse bracket's promise about HQPTuner's own stores and the engine's live matrix profile.

`scripts/abuse.sh open` brackets a hostile-input run and `close` ends it. A run
writes into every store HQPTuner owns, and `close` has to leave those stores as
`open` found them, refusing and touching none of them when the snapshot manifest
is gone.

A run is also free to switch the engine's live matrix profile, and `close` has
to put back the profile the daemon was on when `open` ran — unless the daemon no
longer offers that profile, in which case `close` refuses rather than installing
a name the engine cannot resolve.

Policy notes:

- The subject is a shell script, so it is driven the way an operator drives it:
  a subprocess, its two environment knobs, and what it leaves behind. Nothing
  reaches inside the script.
- The script does its own bounded polling and the assertions read state it has
  already finished writing.
- The stores are the ones `abuse.sh status` reports for the state root the
  test points it at, never a list written out here.
- The stack here is function-scoped, not the session one: what each case pins is
  what the stores hold and the profile the engine is on at the moment `open`
  runs, so it needs a server and a daemon nothing else has touched.
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
from narrow import FixtureError

from e2e.support import stack as stack_support

#: Repo root — tests/e2e/test_abuse_bracket.py, so three parents up.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: Ceiling on one script run. The script's own restore poll is two minutes, so
#: this is a hang guard, not a duration anything is expected to take.
RUN_TIMEOUT = 300.0

#: Ceiling on one API call to the app, which is on loopback and already answering.
CALL_TIMEOUT = 30.0

#: A profile the control fake answers MatrixListProfiles with, so it is a switch
#: target the daemon resolves. Stands for wherever a hostile run leaves the engine.
RUN_PROFILE = "Mch-to-Stereo mixdown"

#: A name the control fake's profile list does not carry, so a baseline recorded
#: while the daemon reports it is dangling and cannot be switched back to.
ABSENT_PROFILE = "Profile The Engine Does Not Have"

#: The exit status `abuse.sh` refuses with: distinct from a step that failed and
#: from a crash, either of which exits otherwise.
REFUSED = 3

#: The prefix `abuse.sh status` puts before each store it resolved, one per line.
STORE_LINE = "store: "

#: What the run leaves in every store: a hostile value no store held at open.
JUNK = b"junk the hostile run left behind"

#: Ceiling on the app noticing a State the fake already reports. Bounded wait on a
#: condition, not a duration anything is expected to take.
OBSERVE_TIMEOUT = 30.0


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


def _live_active(app: stack_support.Stack) -> str:
    """The active matrix profile as the app serves it, `.data.live_active` of `GET /api/matrix`."""
    request = urllib.request.Request(f"{app.base_url}/api/matrix", method="GET")  # noqa: S310 — loopback http URL
    with urllib.request.urlopen(request, timeout=CALL_TIMEOUT) as response:  # noqa: S310 — same URL
        payload = json.loads(response.read())
    return str(payload["data"]["live_active"])


class _ActiveProfileMismatchError(RuntimeError):
    """The app never settled on the expected active matrix profile within the deadline."""

    def __init__(self, *, reported: str, expected: str) -> None:
        super().__init__(f"app still reports {reported!r} as the active profile, not {expected!r}")


def _await_active(app: stack_support.Stack, name: str) -> None:
    """Wait until the app reports `name` as the active profile, so `open` records that baseline.

    Nothing here sleeps or reads the clock. `app.wait_for_command` blocks on
    `control_log`'s own condition, which every control command the app sends —
    including its periodic `State` poll — notifies, so the predicate is
    re-checked (an `/api/matrix` read) each time the app has had a chance to
    pick up the profile, not on a fixed cadence.
    """
    if app.wait_for_command(lambda: _live_active(app) == name, OBSERVE_TIMEOUT):
        return
    raise _ActiveProfileMismatchError(reported=_live_active(app), expected=name)


def _switch(app: stack_support.Stack, name: str) -> None:
    """Move the engine's live profile through the app's own switch route, and wait for it to land."""
    _call(app, "POST", "/api/matrix/profile", {"action": "switch", "name": name})
    _await_active(app, name)


def _put_daemon_on(app: stack_support.Stack, name: str) -> None:
    """Park the engine on `name` before the bracket opens.

    The unnamed [Default] is the empty name the fake already starts on, so there
    is nothing to switch; anything else is reached the way a user reaches it.
    """
    if name:
        _switch(app, name)
    else:
        _await_active(app, name)


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


class _AbuseBracketError(RuntimeError):
    """`scripts/abuse.sh` refused the bracket command, carrying its own stdout and stderr."""

    def __init__(self, *, command: str, stdout: str, stderr: str) -> None:
        super().__init__(f"abuse.sh {command} failed:\n{stdout}\n{stderr}")


def _bracket(command: str, state: Path) -> subprocess.CompletedProcess[str]:
    """Run one end of the bracket, raising with the script's own output when it refuses."""
    result = _abuse(command, state)
    if result.returncode != 0:
        raise _AbuseBracketError(command=command, stdout=result.stdout, stderr=result.stderr)
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


def _stores(state: Path) -> tuple[str, ...]:
    """The stores `abuse.sh status` resolves for `state`, as paths relative to it."""
    report = _abuse("status", state)
    stores = tuple(line.removeprefix(STORE_LINE) for line in report.stdout.splitlines() if line.startswith(STORE_LINE))
    if report.returncode != 0 or not stores:
        raise FixtureError(reason=f"abuse.sh status resolved no stores:\n{report.stdout}\n{report.stderr}")
    return stores


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _snapshot(state: Path, stores: tuple[str, ...]) -> dict[str, str]:
    """Every file the stores hold right now, path relative to `state` to digest.

    A store that does not exist contributes nothing, so "the file the run created
    is gone again" and "the file the run changed is back" read as the same
    comparison.
    """
    found: dict[str, str] = {}
    for store in stores:
        target = state / store
        if target.is_dir():
            found.update({str(p.relative_to(state)): _digest(p) for p in target.rglob("*") if p.is_file()})
        elif target.is_file():
            found[store] = _digest(target)
    return found


def _write_into_every_store(state: Path, stores: tuple[str, ...]) -> None:
    """Leave junk in each store, as a hostile run would: a new file in a directory, new contents in a file."""
    for store in stores:
        target = state / store
        if target.is_dir():
            target = target / "junk"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(JUNK)


def _seed_stores(app: stack_support.Stack) -> None:
    """Give two stores content before `open`, so close has something to put back, not only to delete."""
    _call(app, "PUT", "/api/livepresets/keep", {})
    _call(app, "PUT", "/api/descriptions", {"name": "keep", "text": "kept"})


def test_close_leaves_every_store_as_open_found_it(app: stack_support.Stack, state: Path) -> None:
    """A run that writes into every store leaves none of it behind."""
    stores = _stores(state)
    _seed_stores(app)
    before = _snapshot(state, stores)
    _bracket("open", state)
    _write_into_every_store(state, stores)
    _bracket("close", state)
    assert _snapshot(state, stores) == before


def _close_without_manifest(
    app: stack_support.Stack, state: Path
) -> tuple[subprocess.CompletedProcess[str], dict[str, str]]:
    """Open the bracket, write into every store, lose the snapshot manifest, then close.

    Answers the close and the stores as they stood just before it.
    """
    stores = _stores(state)
    _seed_stores(app)
    _bracket("open", state)
    _write_into_every_store(state, stores)
    for manifest in (state / "abuse").rglob("manifest.json"):
        manifest.unlink()
    left = _snapshot(state, stores)
    return _abuse("close", state), left


def test_close_refuses_when_the_snapshot_manifest_is_gone(app: stack_support.Stack, state: Path) -> None:
    """Without the manifest the bracket cannot tell an empty store from a lost snapshot, so it refuses."""
    closed, _left = _close_without_manifest(app, state)
    assert closed.returncode == REFUSED


def test_a_close_refused_for_a_lost_manifest_leaves_the_stores_as_it_found_them(
    app: stack_support.Stack, state: Path
) -> None:
    """A refusal restores nothing: putting back a snapshot it cannot vouch for could empty a live store."""
    _closed, left = _close_without_manifest(app, state)
    assert _snapshot(state, _stores(state)) == left


@pytest.mark.parametrize("baseline", ["Default", ""])
def test_close_puts_the_engine_back_on_the_profile_open_found(
    app: stack_support.Stack, state: Path, baseline: str
) -> None:
    """A run that switches the live matrix profile leaves the engine where `open` found it."""
    _put_daemon_on(app, baseline)
    _bracket("open", state)
    _switch(app, RUN_PROFILE)
    _bracket("close", state)
    assert app.control_state["matrix_profile"] == baseline


def _close_after_the_baseline_vanished(app: stack_support.Stack, state: Path) -> subprocess.CompletedProcess[str]:
    """Open on a profile the daemon no longer lists, switch to the run profile, then close."""
    app.control_state["matrix_profile"] = ABSENT_PROFILE
    _await_active(app, ABSENT_PROFILE)
    _bracket("open", state)
    _switch(app, RUN_PROFILE)
    return _abuse("close", state)


def test_close_refuses_when_the_recorded_profile_is_no_longer_offered(app: stack_support.Stack, state: Path) -> None:
    """A baseline the daemon no longer lists is refused, never switched back to."""
    assert _close_after_the_baseline_vanished(app, state).returncode == REFUSED


def test_a_close_refused_for_a_vanished_profile_leaves_the_run_profile_engaged(
    app: stack_support.Stack, state: Path
) -> None:
    _close_after_the_baseline_vanished(app, state)
    assert app.control_state["matrix_profile"] == RUN_PROFILE
