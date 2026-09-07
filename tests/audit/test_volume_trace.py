"""The volume trace: what the audit log says about every level HQPTuner sees.

A preset that loads at its startup volume and then jumps to the top of the range
leaves nothing behind today, so this suite drives the real REST surface against
the two fake daemons and reads the log back with a plain ``json.loads`` per line
(``audit_records``), the way ``test_audit_wiring`` does.

Two record shapes are covered, and neither is selected by its event name: an
*observation* is picked out by the checkpoint it names in ``source``
(``config_form``, ``preset.stored``, ``post_apply``), and a *write* by the
``readback`` it carries. Every asserted level is one this suite itself put on
the wire — the level staged, the level posted, or the startup volume the seeded
preset was built with — compared as a number, since the string form of a level
is formatting rather than contract (docs/testing.md rules 9 and 11).
"""

import contextlib
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from audit_records import records
from conftest import spawn_threaded_daemon, wait_for_api
from fake_config_xml import cfg_xml
from fake_control import DEFAULTS
from fake_http import state
from fastapi.testclient import TestClient
from test_audit_wiring import _app

from hqptuner.presets.store.presets import PresetStore

#: The level posted at ``POST /api/volume`` throughout — a half-dB value, so a
#: readback that came back from the engine rather than from the request body is
#: still distinguishable from the daemon's resting ``-10.0``.
POSTED = "-24.5"

#: Where the engine is moved to after that write, with no write behind the move:
#: the shape the brief describes, and what separates the level HQPTuner asked
#: for from the level the engine happens to be reporting.
MOVED = "-40"


# --- reading the volume records back -----------------------------------------


def observations(path: Path, source: str) -> list[dict[str, Any]]:
    """Every volume observation taken at that checkpoint, oldest first."""
    return [rec for rec in records(path) if rec.get("source") == source]


def last_observation(path: Path, source: str) -> dict[str, Any]:
    """The most recent observation at that checkpoint, or an empty record."""
    found = observations(path, source)
    return found[-1] if found else {}


def last_volume_write(path: Path) -> dict[str, Any]:
    """The most recent record of a volume HQPTuner wrote — the one carrying a
    readback — or an empty record if nothing wrote."""
    found = [rec for rec in records(path) if "readback" in rec]
    return found[-1] if found else {}


def level(raw: object) -> float | None:
    """A recorded level as a number; ``None`` stays ``None`` (no reading)."""
    return None if raw is None else float(str(raw))


def levels(record: dict[str, Any]) -> list[float]:
    """Every reading in an observation's field set, as numbers. The checkpoint
    carries several volume fields and which one a level lands under is the
    implementation's business; that a level was recorded at all is not."""
    found: list[float] = []
    for value in dict(record.get("fields") or {}).values():
        with contextlib.suppress(TypeError, ValueError):
            found.append(float(str(value)))
    return found


# --- the apps under test ------------------------------------------------------


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def unwritable_log(tmp_path: Path) -> Path:
    """A debug-log path the emitter cannot write: a directory where it wants a
    file, so every append raises rather than landing."""
    path = tmp_path / "unwritable.jsonl"
    path.mkdir()
    return path


@pytest.fixture
def audit_client(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int, audit_log: Path
) -> Iterator[TestClient]:
    """The REST surface on the fake 8088 daemon with the audit log enabled."""
    yield from _app(http_daemon, tmp_path, closed_port, audit_log)


@pytest.fixture
def blocked_client(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int, unwritable_log: Path
) -> Iterator[TestClient]:
    """The same app pointed at a debug log that cannot be written."""
    yield from _app(http_daemon, tmp_path, closed_port, unwritable_log)


#: Build an app on a fresh threaded 4321 fake — ``overrides`` bakes State
#: overrides into that daemon, ``control_state`` hands in the live State dict so
#: the case can move the engine afterwards.
ClientFactory = Callable[..., TestClient]


@pytest.fixture
def control_client(http_daemon: dict[str, Any], tmp_path: Path, audit_log: Path) -> Iterator[ClientFactory]:
    """Both lanes at once — control on a threaded fake 4321 daemon, http on the
    fake 8088 one — which is what a live volume write needs before it can happen
    at all. Everything built here is torn down in reverse order."""
    stack = contextlib.ExitStack()

    def build(overrides: dict[str, str] | None = None, control_state: dict[str, str] | None = None) -> TestClient:
        ports = spawn_threaded_daemon(overrides, control_state)
        port = next(ports)
        stack.callback(next, ports, None)
        clients = _app(http_daemon, tmp_path, port, audit_log)
        client = next(clients)
        stack.callback(next, clients, None)
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        return client

    yield build
    stack.close()


@pytest.fixture
def dual_lane_client(control_client: ClientFactory) -> TestClient:
    return control_client()


# --- driving the checkpoints --------------------------------------------------


class Scene(NamedTuple):
    """One logged app, the daemon behind it, and the directory its preset store
    lives in — what a checkpoint driver needs to move any of the three."""

    client: TestClient
    daemon: dict[str, Any]
    tmp_path: Path


@pytest.fixture
def scene(audit_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path) -> Scene:
    return Scene(audit_client, http_daemon, tmp_path)


def seed_preset(tmp_path: Path, name: str, startup_volume: str) -> None:
    """A stored preset saved off a daemon whose config carried that startup
    volume — a full 6.0.4-shaped snapshot, ``<defaults volume=...>`` and all."""
    PresetStore(tmp_path / "presets").save(name, cfg_xml(state(defaults_volume=startup_volume)))


def two_identical_refreshes(scene: Scene) -> None:
    scene.client.post("/api/config/refresh")
    scene.client.post("/api/config/refresh")


def a_third_refresh_after_the_startup_volume_moved(scene: Scene) -> None:
    two_identical_refreshes(scene)
    scene.daemon["defaults_volume"] = "-12"
    scene.client.post("/api/config/refresh")


def two_loads_of_one_preset(scene: Scene) -> None:
    seed_preset(scene.tmp_path, "Headphones", "-30")
    scene.client.post("/api/profile/load", json={"name": "Headphones"})
    scene.client.post("/api/profile/load", json={"name": "Headphones"})


# --- 1. which checkpoints repeat, and which only speak when something moved ---


@pytest.mark.parametrize(
    "drive, source, expected",
    [
        (two_identical_refreshes, "config_form", 1),
        (a_third_refresh_after_the_startup_volume_moved, "config_form", 2),
        (two_loads_of_one_preset, "preset.stored", 2),
    ],
)
def test_a_checkpoint_records_every_load_and_records_a_form_again_when_it_moved(
    scene: Scene,
    audit_log: Path,
    *,
    drive: Callable[[Scene], None],
    source: str,
    expected: int,
) -> None:
    # a log that change-tests every source records nothing for the second load,
    # which is precisely the recurrence the file exists to catch; a log that
    # never change-tests the form fills with copies of one reading and never
    # marks the moment the startup volume changed under the user
    drive(scene)
    assert len(observations(audit_log, source)) == expected


# --- 2. what a preset load carried -------------------------------------------


@pytest.mark.parametrize("startup_volume, expected", [("-30", -30.0), ("-12", -12.0)])
def test_a_preset_load_records_the_startup_volume_the_stored_preset_carries(
    audit_client: TestClient, audit_log: Path, tmp_path: Path, *, startup_volume: str, expected: float
) -> None:
    # the checkpoint's name with no volume behind it says a load happened; the
    # question after the bug is what the load carried
    seed_preset(tmp_path, "Headphones", startup_volume)
    audit_client.post("/api/profile/load", json={"name": "Headphones"})
    assert level(last_observation(audit_log, "preset.stored")["fields"]["defaults_volume"]) == expected


# --- 3. the window after an apply that never touched the config file ---------


@pytest.mark.parametrize("staged, expected", [("-18", -18.0), ("-33", -33.0)])
def test_an_apply_that_only_moved_the_live_volume_records_the_volume_after_it(
    dual_lane_client: TestClient, audit_log: Path, *, staged: str, expected: float
) -> None:
    # nothing in this staged set routes to the config file, so the whole batch
    # rides the 4321 lane and the daemon never restarts — the apply that leaves
    # no trace at all unless the post-apply checkpoint runs on it too
    dual_lane_client.post("/api/config/stage", json={"live": {"volume": {"value": staged}}})
    dual_lane_client.post("/api/config/apply")
    assert expected in levels(last_observation(audit_log, "post_apply"))


# --- 4. what came back from a write ------------------------------------------


@pytest.mark.parametrize("enabled, expected", [(True, -24.5), (False, None)])
def test_a_volume_write_records_what_the_engine_reported_back(
    control_client: ClientFactory, audit_log: Path, *, enabled: bool, expected: float | None
) -> None:
    # `result="OK"` is not proof of application and a disabled volume control
    # refuses outright (docs/protocol.md §6), so a record that echoes the level
    # asked for reads as a landed write in both cases
    client = control_client(None if enabled else {"_vol_enabled": "0"})
    client.post("/api/volume", json={"level": POSTED})
    assert level(last_volume_write(audit_log)["readback"]) == expected


# --- 5. who asked for the volume that is there now ----------------------------


@pytest.mark.parametrize("wrote_first, expected", [(False, None), (True, -24.5)])
def test_an_observation_reports_the_last_level_hqptuner_itself_asked_for(
    control_client: ClientFactory,
    audit_log: Path,
    tmp_path: Path,
    *,
    wrote_first: bool,
    expected: float | None,
) -> None:
    # the engine is moved after the write with nothing behind the move, so the
    # level it reports and the level HQPTuner last asked for disagree — which is
    # the whole distinction the field exists to draw
    engine = dict(DEFAULTS)
    client = control_client(control_state=engine)
    seed_preset(tmp_path, "Headphones", "-30")
    if wrote_first:
        client.post("/api/volume", json={"level": POSTED})
        engine["volume"] = MOVED
    client.post("/api/profile/load", json={"name": "Headphones"})
    assert level(last_observation(audit_log, "preset.stored")["last_write"]) == expected


# --- 6. a log that cannot be written -----------------------------------------


def test_an_observation_that_cannot_be_logged_does_not_stop_the_next_one(
    blocked_client: TestClient, audit_client: TestClient, audit_log: Path
) -> None:
    # the same checkpoint runs on the poll, so a write error escaping the
    # emitter does not merely lose one record: it takes the reading with it, for
    # as long as the path stays unwritable
    blocked_client.post("/api/config/refresh")
    audit_client.post("/api/config/refresh")
    assert len(observations(audit_log, "config_form")) == 1
