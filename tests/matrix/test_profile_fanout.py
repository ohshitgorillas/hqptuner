"""Matrix profile fan-out to selected stored presets.

A save or delete staged with a ``presets`` list also lands (or removes) the
``<matrix_profile>`` element in each named stored preset's XML — a pure file
edit on the HQPTuner-owned store, no daemon traffic.
The untargeted payload shape (no ``presets`` key for a save, an
empty ``presets`` list for a delete) writes the running config only and
leaves stored presets untouched. Stored preset XML here is rendered by
the fake daemon's own config renderer, so the writer is exercised against 6.0.4-shaped documents,
and readback goes through an independent regex over the documented element
shape (hqplayerd-readme.txt §1.12), never through the writer.
"""

import json
import re
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, Any

import pytest
from fake_config_xml import cfg_xml
from fake_http import state
from fastapi.testclient import TestClient
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import restore
from hqptuner.lanes.http.restore import RestoreOutcome
from hqptuner.presets import fileconfig
from hqptuner.presets.store.presets import PresetNotFoundError, PresetStore

if TYPE_CHECKING:
    from hqptuner.core.applyops import ApplyReport

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "-3", "gainunit": "dB", "mixdown": "1", "process": ""}

#: A stored-preset pipeline row as the config file carries it (raw attrs).
FILE_ROW = {"gain": "0", "mixdown": "0", "process": "", "source": "0"}


def save(name: str, *rows: dict[str, str], presets: list[str] | None = None) -> dict[str, str]:
    """The staged save field; ``presets`` names the fan-out targets."""
    payload: dict[str, Any] = {"name": name, "rows": list(rows) or [ROW0]}
    if presets is not None:
        payload["presets"] = presets
    return {"matrix_profile_save": json.dumps(payload)}


def delete_from(name: str, presets: list[str]) -> dict[str, str]:
    """The staged delete field in its targeted (JSON object) shape."""
    return {"matrix_profile_delete": json.dumps({"name": name, "presets": presets})}


def preset_xml(profiles: Mapping[str, list[dict[str, str]]] = MappingProxyType({})) -> bytes:
    """A stored preset: a full 6.0.4-shaped config XML snapshot carrying the
    given saved profiles and a title the fan-out must not disturb."""
    stored = {name: {"rows": rows, "plugins": []} for name, rows in profiles.items()}
    return cfg_xml(state(title="Office desk", _profiles=stored))


def stored_profiles(xml: bytes) -> dict[str, list[dict[str, str]]]:
    """The ``<matrix_profile>`` elements of a stored preset, read back by the
    documented element shape — independently of the writer under test."""
    return {
        m.group(1).decode(): [
            {k.decode(): v.decode() for k, v in re.findall(rb'(\w+)="([^"]*)"', pm.group(0))}
            for pm in re.finditer(rb"<pipeline\b[^>]*/>", m.group(2))
        ]
        for m in re.finditer(rb'<matrix_profile\b[^>]*name="([^"]*)"[^>]*>(.*?)</matrix_profile>', xml, re.DOTALL)
    }


def without_profile(xml: bytes, name: str) -> bytes:
    """The stored XML with that profile's element excised (readme §1.12 shape) —
    what a fan-out must have left byte-identical to the pre-fan-out snapshot."""
    pattern = rb'<matrix_profile\b[^>]*name="' + re.escape(name).encode() + rb'"[^>]*>.*?</matrix_profile>'
    return re.sub(pattern, b"", xml, flags=re.DOTALL)


async def running_profiles(manager: ConnectionManager) -> dict[str, dict[str, Any]]:
    """The profiles the running config carries, read back from the daemon: each
    one its rows and its own post-process settings."""
    cfg = await fileconfig.load_file_config(manager)
    profiles: dict[str, dict[str, Any]] = json.loads(cfg["matrix_profiles"])
    return profiles


# --- save without targets: the old shape, byte for byte ----------------------


async def test_save_without_presets_key_still_reaches_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, ROW1))
    assert "Crossfeed EQ" in await running_profiles(http_manager)


async def test_save_without_presets_key_leaves_stored_presets_untouched(http_manager: ConnectionManager) -> None:
    seeded = preset_xml()
    http_manager.presetops.store.save("Office", seeded)
    await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0))
    assert http_manager.presetops.store.read("Office") == seeded


# --- save fan-out into stored presets ----------------------------------------


async def test_fanout_writes_the_profile_into_the_targeted_preset(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, ROW1, presets=["Office"]))
    assert "Crossfeed EQ" in stored_profiles(http_manager.presetops.store.read("Office"))


async def test_fanned_out_profile_carries_the_saved_rows(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, ROW1, presets=["Office"]))
    rows = stored_profiles(http_manager.presetops.store.read("Office"))["Crossfeed EQ"]
    assert rows[1]["gain"] == "-3"


async def test_fanout_preserves_the_presets_other_settings(http_manager: ConnectionManager) -> None:
    seeded = preset_xml()
    http_manager.presetops.store.save("Office", seeded)
    await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Office"]))
    assert without_profile(http_manager.presetops.store.read("Office"), "Crossfeed EQ") == seeded


async def test_fanout_to_a_missing_preset_still_applies(http_manager: ConnectionManager) -> None:
    assert (
        await restore.apply(http_manager, save("Crossfeed EQ", ROW0, presets=["Ghost"]))
    ).outcome is RestoreOutcome.APPLIED


async def test_missing_fanout_target_maps_to_an_error(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Ghost"]))
    assert report.aftermath.fanout["Ghost"] == PresetNotFoundError.code


async def test_a_fanout_target_with_no_root_element_maps_to_invalid_input(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Rootless", b'<title value="Office desk"/>')
    report = await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Rootless"]))
    assert report.aftermath.fanout["Rootless"] == "invalid_input"


async def test_a_co_target_still_receives_the_profile_despite_a_missing_one(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Ghost", "Office"]))
    assert "Crossfeed EQ" in stored_profiles(http_manager.presetops.store.read("Office"))


@pytest.mark.parametrize(
    ("presets", "fanout"), [(None, {}), (["Office"], {"Office": "ok"})], ids=["untargeted", "targeted"]
)
async def test_the_aftermath_reports_one_fanout_entry_per_targeted_preset(
    http_manager: ConnectionManager, presets: list[str] | None, fanout: dict[str, str]
) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    report: ApplyReport = await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=presets))
    assert report.aftermath.fanout == fanout


@pytest.mark.parametrize(("title", "landed"), [("Renamed", True), ("REJECT", False)], ids=["converged", "unconverged"])
async def test_only_a_converged_restore_lands_the_profile_in_the_targeted_preset(
    http_manager: ConnectionManager, title: str, *, landed: bool
) -> None:
    # the fake refuses a `title` of REJECT on restore, so that apply never converges
    http_manager.presetops.store.save("Office", preset_xml())
    await http_manager.applyops.apply({}, {"title": title, **save("Crossfeed EQ", ROW0, presets=["Office"])})
    assert ("Crossfeed EQ" in stored_profiles(http_manager.presetops.store.read("Office"))) is landed


# --- delete: targeted (object) shape vs the old plain-string shape ------------


async def test_targeted_delete_removes_the_profile_from_the_stored_preset(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml({"Stock": [FILE_ROW]}))
    await http_manager.applyops.apply({}, delete_from("Stock", ["Office"]))
    assert "Stock" not in stored_profiles(http_manager.presetops.store.read("Office"))


async def test_targeted_delete_also_removes_the_profile_from_the_running_config(
    http_manager: ConnectionManager,
) -> None:
    http_manager.presetops.store.save("Office", preset_xml({"Stock": [FILE_ROW]}))
    await http_manager.applyops.apply({}, delete_from("Stock", ["Office"]))
    assert "Stock" not in await running_profiles(http_manager)


async def test_targeted_delete_reaches_the_second_named_preset(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml({"Stock": [FILE_ROW]}))
    http_manager.presetops.store.save("Den", preset_xml({"Stock": [FILE_ROW]}))
    await http_manager.applyops.apply({}, delete_from("Stock", ["Office", "Den"]))
    assert "Stock" not in stored_profiles(http_manager.presetops.store.read("Den"))


async def test_an_untargeted_delete_leaves_stored_presets_untouched(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml({"Stock": [FILE_ROW]}))
    await http_manager.applyops.apply({}, delete_from("Stock", []))
    assert "Stock" in stored_profiles(http_manager.presetops.store.read("Office"))


async def test_an_untargeted_delete_still_removes_from_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, delete_from("Stock", []))
    assert "Stock" not in await running_profiles(http_manager)


async def test_delete_targeting_a_preset_without_the_profile_still_applies(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    assert (await restore.apply(http_manager, delete_from("Stock", ["Office"]))).outcome is RestoreOutcome.APPLIED


async def test_delete_no_op_leaves_the_presets_file_unchanged(http_manager: ConnectionManager) -> None:
    seeded = preset_xml()
    http_manager.presetops.store.save("Office", seeded)
    await http_manager.applyops.apply({}, delete_from("Stock", ["Office"]))
    assert http_manager.presetops.store.read("Office") == seeded


# --- payload validation --------------------------------------------------------


def bad_presets_save(presets: object) -> dict[str, str]:
    return {"matrix_profile_save": json.dumps({"name": "Crossfeed EQ", "rows": [ROW0], "presets": presets})}


def staged_apply(client: TestClient, field: dict[str, str]) -> dict[str, Any]:
    """Stage that field through the REST surface and apply it; the apply's response body."""
    client.post("/api/config/stage", json={"http": field})
    body: dict[str, Any] = client.post("/api/config/apply").json()
    return body


def arrange_apply(client: TestClient, field: dict[str, str], code: str | None) -> None:
    """Stage and apply that field, refusing to go on unless the apply came back with ``code`` (None: not refused)."""
    got = staged_apply(client, field).get("code")
    if got != code:
        raise FixtureError(reason=f"the staged apply was meant to answer code {code!r}, got {got!r}")


@pytest.mark.parametrize("presets", ["Office", [1]])
def test_non_list_of_strings_presets_is_refused_as_invalid_input(http_client: TestClient, presets: object) -> None:
    assert staged_apply(http_client, bad_presets_save(presets))["code"] == "invalid_input"


#: A save whose presets value is refused, beside one that is accepted and so
#: proves the readback can see a write.
PRESETS_OUTCOMES = [
    pytest.param(bad_presets_save("Office"), "invalid_input", False, id="refused"),
    pytest.param(save("Crossfeed EQ", ROW0, presets=["Office"]), None, True, id="accepted"),
]


@pytest.mark.parametrize(("field", "code", "landed"), PRESETS_OUTCOMES)
def test_only_an_accepted_presets_value_lands_the_profile_in_the_stored_preset(
    http_manager: ConnectionManager,
    http_client: TestClient,
    field: dict[str, str],
    code: str | None,
    *,
    landed: bool,
) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    arrange_apply(http_client, field, code)
    assert ("Crossfeed EQ" in stored_profiles(http_manager.presetops.store.read("Office"))) is landed


@pytest.mark.parametrize(("field", "code", "landed"), PRESETS_OUTCOMES)
async def test_only_an_accepted_presets_value_lands_the_profile_in_the_running_config(
    http_manager: ConnectionManager,
    http_client: TestClient,
    field: dict[str, str],
    code: str | None,
    *,
    landed: bool,
) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    arrange_apply(http_client, field, code)
    assert ("Crossfeed EQ" in await running_profiles(http_manager)) is landed


# --- GET /api/matrix: the preset_profiles read model ---------------------------


def seed_presets(preset_dir: Path, presets: Mapping[str, Mapping[str, list[dict[str, str]]]]) -> None:
    """Save each named stored preset carrying the given saved profiles."""
    store = PresetStore(preset_dir)
    for name, profiles in presets.items():
        store.save(name, preset_xml(profiles))


PRESET_PROFILES = [
    pytest.param({}, {}, id="empty-store"),
    pytest.param(
        {"Office": {"Zeta": [FILE_ROW], "Alpha": [FILE_ROW]}}, {"Office": ["Alpha", "Zeta"]}, id="one-stored-preset"
    ),
]


@pytest.mark.parametrize(("presets", "expected"), PRESET_PROFILES)
def test_api_matrix_serves_each_stored_presets_profile_names_sorted(
    http_client: TestClient,
    tmp_path: Path,
    presets: Mapping[str, Mapping[str, list[dict[str, str]]]],
    expected: dict[str, list[str]],
) -> None:
    seed_presets(tmp_path / "presets", presets)
    http_client.post("/api/config/refresh")  # makes the form routes servable
    assert http_client.get("/api/matrix").json()["data"]["preset_profiles"] == expected


def offline_manager(tmp_path: Path) -> ConnectionManager:
    """A manager with no daemon lane, its preset store under ``tmp_path``."""
    return ConnectionManager(Config(backup_dir=tmp_path, preset_dir=tmp_path / "presets"), clock=VirtualClock())


def test_preset_profiles_serves_an_unchanged_presets_list_without_rebuilding_it(tmp_path: Path) -> None:
    seed_presets(tmp_path / "presets", {"Office": {"Alpha": [FILE_ROW]}})
    ops = offline_manager(tmp_path).presetops
    first = ops.preset_profiles()["Office"]
    assert ops.preset_profiles()["Office"] is first


def test_preset_profiles_follows_a_save_of_that_preset_with_another_profile_set(tmp_path: Path) -> None:
    seed_presets(tmp_path / "presets", {"Office": {"Alpha": [FILE_ROW]}})
    ops = offline_manager(tmp_path).presetops
    ops.preset_profiles()
    ops.store.save("Office", preset_xml({"Bravo Two": [FILE_ROW]}))
    assert ops.preset_profiles()["Office"] == ["Bravo Two"]
