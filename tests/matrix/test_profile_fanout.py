"""Matrix profile fan-out to selected stored presets.

A save or delete staged with a ``presets`` list also lands (or removes) the
``<matrix_profile>`` element in each named stored preset's XML — a pure file
edit on the HQPTuner-owned store, no daemon traffic (matrix-spec.md
"Profiles"). The old payload shapes (no ``presets`` key; a plain name string
for delete) keep their exact old behaviour: running config only, stored
presets untouched. Stored preset XML here is rendered by the fake daemon's own
config renderer, so the writer is exercised against 6.0.4-shaped documents,
and readback goes through an independent regex over the documented element
shape (hqplayerd-readme.txt §1.12), never through the writer.
"""

import json
import re
from pathlib import Path
from typing import Any

import pytest
from fake_config_xml import cfg_xml
from fake_http import state
from fastapi.testclient import TestClient

from hqptuner.core.manager import ConnectionManager
from hqptuner.presets.presetstore import PresetStore

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


def preset_xml(profiles: dict[str, list[dict[str, str]]] | None = None) -> bytes:
    """A stored preset: a full 6.0.4-shaped config XML snapshot carrying the
    given saved profiles and a title the fan-out must not disturb."""
    stored = {name: {"rows": rows, "plugins": []} for name, rows in (profiles or {}).items()}
    return cfg_xml(state(title="Office desk", _profiles=stored))


def stored_profiles(xml: bytes) -> dict[str, list[dict[str, str]]]:
    """The ``<matrix_profile>`` elements of a stored preset, read back by the
    documented element shape — independently of the writer under test."""
    return {
        m.group(1).decode(): [
            {k.decode(): v.decode() for k, v in re.findall(rb'(\w+)="([^"]*)"', pm.group(0))}
            for pm in re.finditer(rb"<pipeline\b[^>]*/>", m.group(2))
        ]
        for m in re.finditer(rb'<matrix_profile\b[^>]*name="([^"]*)"[^>]*>(.*?)</matrix_profile>', xml, re.S)
    }


def without_profile(xml: bytes, name: str) -> bytes:
    """The stored XML with that profile's element excised (readme §1.12 shape) —
    what a fan-out must have left byte-identical to the pre-fan-out snapshot."""
    pattern = rb'<matrix_profile\b[^>]*name="' + re.escape(name).encode() + rb'"[^>]*>.*?</matrix_profile>'
    return re.sub(pattern, b"", xml, flags=re.S)


async def running_profiles(manager: ConnectionManager) -> dict[str, dict[str, Any]]:
    """The profiles the running config carries, read back from the daemon: each
    one its rows and its own post-process settings."""
    cfg = await manager.load_file_config()
    return json.loads(cfg["matrix_profiles"])


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


async def test_successful_fanout_target_reports_ok(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    report = await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Office"]))
    assert report["persistent"]["profile_fanout"]["Office"] == "ok"


async def test_fanout_to_a_missing_preset_still_applies(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Ghost"]))
    assert report["persistent"]["applied"] is True


async def test_missing_fanout_target_maps_to_an_error(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Ghost"]))
    assert report["persistent"]["profile_fanout"]["Ghost"] not in ("", "ok")


async def test_a_co_target_still_receives_the_profile_despite_a_missing_one(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0, presets=["Ghost", "Office"]))
    assert "Crossfeed EQ" in stored_profiles(http_manager.presetops.store.read("Office"))


async def test_apply_without_targets_carries_no_fanout_key(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, save("Crossfeed EQ", ROW0))
    assert "profile_fanout" not in report["persistent"]


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


async def test_plain_string_delete_leaves_stored_presets_untouched(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml({"Stock": [FILE_ROW]}))
    await http_manager.applyops.apply({}, {"matrix_profile_delete": "Stock"})
    assert "Stock" in stored_profiles(http_manager.presetops.store.read("Office"))


async def test_plain_string_delete_still_removes_from_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"matrix_profile_delete": "Stock"})
    assert "Stock" not in await running_profiles(http_manager)


async def test_delete_targeting_a_preset_without_the_profile_still_applies(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml())
    report = await http_manager.applyops.apply({}, delete_from("Stock", ["Office"]))
    assert report["persistent"]["applied"] is True


async def test_delete_no_op_leaves_the_presets_file_unchanged(http_manager: ConnectionManager) -> None:
    seeded = preset_xml()
    http_manager.presetops.store.save("Office", seeded)
    await http_manager.applyops.apply({}, delete_from("Stock", ["Office"]))
    assert http_manager.presetops.store.read("Office") == seeded


# --- payload validation --------------------------------------------------------


def bad_presets_save(presets: Any) -> dict[str, str]:
    return {"matrix_profile_save": json.dumps({"name": "Crossfeed EQ", "rows": [ROW0], "presets": presets})}


@pytest.mark.parametrize("presets", ["Office", [1]])
async def test_non_list_of_strings_presets_is_refused_naming_the_field(
    http_manager: ConnectionManager, presets: Any
) -> None:
    report = await http_manager.applyops.apply({}, bad_presets_save(presets))
    assert "matrix_profile_save" in report["persistent"]["error"]


async def test_refused_presets_value_leaves_the_stored_preset_unwritten(http_manager: ConnectionManager) -> None:
    seeded = preset_xml()
    http_manager.presetops.store.save("Office", seeded)
    await http_manager.applyops.apply({}, bad_presets_save("Office"))
    assert http_manager.presetops.store.read("Office") == seeded


async def test_refused_presets_value_leaves_the_running_config_unwritten(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, bad_presets_save("Office"))
    assert "Crossfeed EQ" not in await running_profiles(http_manager)


# --- GET /api/matrix: the preset_profiles read model ---------------------------


def test_api_matrix_maps_each_stored_presets_profile_names_sorted(http_client: TestClient, tmp_path: Path) -> None:
    PresetStore(tmp_path / "presets").save("Office", preset_xml({"Zeta": [FILE_ROW], "Alpha": [FILE_ROW]}))
    http_client.post("/api/config/refresh")  # makes the form routes servable
    assert http_client.get("/api/matrix").json()["data"]["preset_profiles"]["Office"] == ["Alpha", "Zeta"]


def test_api_matrix_with_an_empty_preset_store_serves_an_empty_mapping(http_client: TestClient) -> None:
    http_client.post("/api/config/refresh")
    assert http_client.get("/api/matrix").json()["data"]["preset_profiles"] == {}
