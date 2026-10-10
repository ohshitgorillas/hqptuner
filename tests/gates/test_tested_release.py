"""When a live run adds the daemon's release to the record of tested releases.

``scripts/pytest_plugins/tested_release.py`` is a pytest plugin ``make
test-live`` loads with ``-p tested_release``. A run that finishes green with its
``live``-marked tests actually run adds the release the daemon reports to
``hqptuner/data/tested-releases.json`` under the run's rootdir, a JSON list of
release strings. The release is the installed one the 8088 ``/about`` page
prints under its Version heading, read from the daemon the shell's
``HQPTUNER_*`` variables name, never the DSP engine build GetInfo answers with.
A run that fails, or whose live tests were skipped or never selected, leaves the
record as it was, and a release already recorded is not added twice.

Each case runs pytest in-process through ``pytester`` with the plugin loaded,
over a throwaway rootdir holding its own record and its own suite, against the
fake 8088 daemon plus the threaded 4321 fake. The shell's daemon address is set
to those fakes, so no case reaches the host's hqplayerd, and the record every
case reads and writes lives under the throwaway rootdir.
"""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import spawn_threaded_daemon
from narrow import FixtureError

pytest_plugins = ["pytester"]

#: The repository's own record, which no case may touch.
REAL_RECORD = Path(__file__).resolve().parents[2] / "hqptuner" / "data" / "tested-releases.json"

#: Where the record sits relative to the rootdir of the run that keeps it.
RECORD = Path("hqptuner") / "data" / "tested-releases.json"

#: A release recorded before any case runs; every case seeds the record with it.
EARLIER_RELEASE = "5.9.1"

#: The release the daemon reports for the run that should be recorded.
RECORDED_RELEASE = "6.0.2"

#: A second release a green run records, so the recorded value follows the daemon.
OTHER_RELEASE = "6.1.1"

#: The release the daemon reports for a run that must not be recorded.
UNRECORDED_RELEASE = "6.2.0"

#: A suite whose live test passes and whose offline test passes.
GREEN_SUITE = """
import pytest


@pytest.mark.live
def test_reads_the_daemon():
    pass


def test_offline():
    pass
"""

#: A suite whose live test passes but whose offline test fails.
FAILING_SUITE = """
import pytest


@pytest.mark.live
def test_reads_the_daemon():
    pass


def test_offline():
    raise AssertionError("offline test fails")
"""

#: A suite whose live test skips the way the canary does when it cannot connect.
SKIPPED_SUITE = """
import pytest


@pytest.mark.live
def test_reads_the_daemon():
    pytest.skip("hqplayerd unreachable")


def test_offline():
    pass
"""

#: A conftest that re-points the 8088 port for the length of the session, the
#: way the repository's own conftest rewrites every ``HQPTUNER_*`` variable
#: while a suite runs, and restores the shell's value when the session ends.
REPOINTING_CONFTEST = """
import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def _repointed():
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("HQPTUNER_HQP_HTTP_PORT", os.environ["SESSION_HTTP_PORT"])
        yield
"""

INI = """
[pytest]
asyncio_default_fixture_loop_scope = function
markers =
    live: requires a reachable hqplayerd
"""


@pytest.fixture(autouse=True)
def _real_record_untouched() -> Iterator[None]:
    """Refuses a case that changed the repository's own record."""
    before = REAL_RECORD.read_bytes() if REAL_RECORD.exists() else None
    yield
    after = REAL_RECORD.read_bytes() if REAL_RECORD.exists() else None
    if after != before:
        raise FixtureError(reason=f"a case wrote {REAL_RECORD}")


@pytest.fixture
def daemon(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    """The fake 8088 daemon plus the threaded 4321 fake, named by the shell's
    ``HQPTUNER_*`` daemon address. Yields the 8088 state; its ``release`` is
    what ``/about`` prints, and a case changes it between runs. The 4321 fake's
    GetInfo answers with engine build 6.0.4, which no
    case gives the 8088 fake as its release."""
    control = spawn_threaded_daemon()
    http = fake_http.spawn(fake_http.state(release=RECORDED_RELEASE))
    st = next(http)
    monkeypatch.setenv("HQPTUNER_HQP_HOST", "127.0.0.1")
    monkeypatch.setenv("HQPTUNER_HQP_CONTROL_PORT", str(next(control)))
    monkeypatch.setenv("HQPTUNER_HQP_HTTP_PORT", str(st["_port"]))
    yield st
    next(http, None)
    next(control, None)


@pytest.fixture
def rootdir(pytester: pytest.Pytester) -> Path:
    """A throwaway rootdir whose record already holds ``EARLIER_RELEASE``."""
    pytester.makeini(INI)
    record = pytester.path / RECORD
    record.parent.mkdir(parents=True)
    record.write_text(json.dumps([EARLIER_RELEASE]), encoding="utf-8")
    return pytester.path


def _run(pytester: pytest.Pytester, suite: str, *args: str) -> None:
    """Runs ``suite`` with the plugin loaded, the way ``make test-live`` would."""
    path = pytester.makepyfile(test_suite=suite)
    pytester.runpytest_inprocess("-p", "tested_release", *args, str(path))


def _recorded(rootdir: Path) -> list[str]:
    """The releases the record holds, in a fixed order."""
    releases: list[str] = json.loads((rootdir / RECORD).read_text(encoding="utf-8"))
    return sorted(releases)


@pytest.mark.parametrize("release", [RECORDED_RELEASE, OTHER_RELEASE])
def test_a_green_live_run_adds_the_release_the_about_page_reports_to_the_record(
    pytester: pytest.Pytester, rootdir: Path, daemon: dict[str, Any], *, release: str
) -> None:
    daemon["release"] = release
    _run(pytester, GREEN_SUITE)
    assert _recorded(rootdir) == sorted([EARLIER_RELEASE, release])


@pytest.mark.usefixtures("daemon")
def test_a_release_already_in_the_record_is_not_added_again(pytester: pytest.Pytester, rootdir: Path) -> None:
    _run(pytester, GREEN_SUITE)
    _run(pytester, GREEN_SUITE)
    assert _recorded(rootdir) == sorted([EARLIER_RELEASE, RECORDED_RELEASE])


#: Runs that are not green with their live tests run: the suite, and the
#: arguments it runs with.
UNRECORDED_RUNS = [
    pytest.param(FAILING_SUITE, (), id="failed"),
    pytest.param(SKIPPED_SUITE, (), id="live-skipped"),
    pytest.param(GREEN_SUITE, ("-m", "not live"), id="live-deselected"),
]


@pytest.mark.parametrize(("suite", "args"), UNRECORDED_RUNS)
def test_a_run_not_green_with_its_live_tests_run_adds_nothing_to_the_record(
    pytester: pytest.Pytester, rootdir: Path, daemon: dict[str, Any], *, suite: str, args: tuple[str, ...]
) -> None:
    _run(pytester, GREEN_SUITE)
    daemon["release"] = UNRECORDED_RELEASE
    _run(pytester, suite, *args)
    assert _recorded(rootdir) == sorted([EARLIER_RELEASE, RECORDED_RELEASE])


@pytest.mark.usefixtures("daemon")
def test_the_release_is_read_from_the_daemon_the_shell_names_not_one_the_suite_points_at(
    pytester: pytest.Pytester, rootdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    session_http = fake_http.spawn(fake_http.state(release=UNRECORDED_RELEASE))
    monkeypatch.setenv("SESSION_HTTP_PORT", str(next(session_http)["_port"]))
    pytester.makeconftest(REPOINTING_CONFTEST)
    try:
        _run(pytester, GREEN_SUITE)
    finally:
        next(session_http, None)
    assert _recorded(rootdir) == sorted([EARLIER_RELEASE, RECORDED_RELEASE])
