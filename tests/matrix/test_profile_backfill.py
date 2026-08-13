"""Chain-less saved profiles are backfilled from the live matrix's chain.

``<post_process>`` nests inside ``<matrix>`` (hqplayerd-readme.txt §1.11.2) and
``<matrix_profile>`` is defined by reference to §1.11 (§1.12), so a saved profile
is a whole matrix context: ``<pipeline>`` rows plus a chain of its own. Profiles
saved before HQPTuner stored chains carry none, and loading one installs an empty
chain. The backfill gives every such profile a verbatim copy of the live chain.

Snapshots are built locally here (the fake's renderer always emits a live chain,
and several cases need one that has none) but shaped as 6.0.4 writes them, and
every readback goes through the fake daemon's own adopter — which scopes the live
plugin scan to the ``<matrix>`` body and keeps each profile's chain separate — so
a writer and reader sharing one bug cannot round-trip green. The values asserted
on (bauer at 850, a profile's own at 300) are ones the fake's defaults (700) do
not produce, so "nothing was written" never reads as a pass.
"""

import json
import re
from pathlib import Path
from typing import Any

import pytest
from fake_config_xml import adopt_cfg, cfg_xml
from fake_http import state

from hqptuner.conf import matrixconf, presetconf
from hqptuner.core.manager import ConnectionManager

#: The live matrix's own row, at a gain no profile below carries.
LIVE_ROW = '<pipeline channel="0" gain="-2" mixdown="0" process="" source="0"/>'

#: A saved profile's row, at a gain the live matrix does not carry.
PROFILE_ROW = '<pipeline channel="0" gain="-7" mixdown="0" process="" source="1"/>'

#: The live chain these snapshots start from: two stages, so a backfill that
#: copies only the first is distinguishable from one that copies the chain.
LIVE_CHAIN = (
    "<post_process>"
    '<plugin type="bauer" enabled="1" frequency="850" preset="default" level="4.5"/>'
    '<plugin type="correction" enabled="1" dac0="live.wav"/>'
    "</post_process>"
)

#: A chain a profile already carries: bauer at a frequency the live one is not at.
STORED_CHAIN = (
    '<post_process><plugin type="bauer" enabled="1" frequency="300" preset="default" level="4.5"/></post_process>'
)

#: A live chain whose correction stage carries attributes HQPTuner has no field
#: for: ``dac`` (the non-combo backend spelling) and one outside any plugin map.
ODD_CHAIN = (
    '<post_process><plugin type="correction" enabled="1" dac="Holo Audio Cyan 2" filter_length="65536"/></post_process>'
)

#: A profile as saved before chains were stored, and one saved after.
CHAINLESS = PROFILE_ROW
CHAINED = PROFILE_ROW + STORED_CHAIN


def snapshot(profiles: dict[str, str], live_chain: str = LIVE_CHAIN, *, matrix: bool = True) -> bytes:
    """A 6.0.4-shaped config: the saved profile elements ahead of ``<matrix>``,
    each holding the given body, and a live matrix holding one row and a chain."""
    saved = "".join(f'<matrix_profile name="{name}">{body}</matrix_profile>' for name, body in profiles.items())
    live = f'<matrix enabled="1">{LIVE_ROW}{live_chain}</matrix>' if matrix else ""
    head = '<?xml version="1.0" encoding="UTF-8"?><hqplayerd><engine channels="2">'
    return f"{head}{saved}{live}</engine></hqplayerd>".encode()


def adopted(xml: bytes) -> dict[str, Any]:
    """What a daemon re-reading this config would hold — the fake's own adopter."""
    st = state()
    adopt_cfg(st, xml)
    return st


def profile_plugin(xml: bytes, name: str, plugin_type: str) -> dict[str, str]:
    """One stage of a saved profile's own chain, as raw attributes."""
    profiles: dict[str, Any] = adopted(xml)["_profiles"]
    plugins: list[dict[str, str]] = profiles.get(name, {}).get("plugins", [])
    return next((p for p in plugins if p.get("type") == plugin_type), {})


def profile_rows(xml: bytes, name: str) -> list[dict[str, str]]:
    """A saved profile's ``<pipeline>`` rows, as raw attributes."""
    profiles: dict[str, Any] = adopted(xml)["_profiles"]
    rows: list[dict[str, str]] = profiles.get(name, {}).get("rows", [])
    return rows


def stored_element(xml: bytes, name: str) -> bytes:
    """The saved profile element itself, by the documented shape (readme §1.12)."""
    pattern = rb'<matrix_profile\b[^>]*name="' + re.escape(name).encode() + rb'"[^>]*>.*?</matrix_profile>'
    m = re.search(pattern, xml, re.DOTALL)
    return m.group(0) if m else b""


async def running_profiles(manager: ConnectionManager) -> dict[str, dict[str, Any]]:
    """The saved profiles of the running config, read back from the daemon."""
    cfg_fields = await manager.load_file_config()
    profiles: dict[str, dict[str, Any]] = json.loads(cfg_fields["matrix_profiles"])
    return profiles


# --- a chain-less profile gains a copy of the live chain -----------------------


def test_a_chainless_profile_gains_the_live_chains_plugin_value() -> None:
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Stock": CHAINLESS}))
    assert profile_plugin(backfilled, "Stock", "bauer")["frequency"] == "850"


def test_a_chainless_profile_gains_the_live_chains_second_stage_too() -> None:
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Stock": CHAINLESS}))
    assert profile_plugin(backfilled, "Stock", "correction")["dac0"] == "live.wav"


@pytest.mark.parametrize("name", ["Stock", "Attic"])
def test_every_chainless_profile_gains_the_chain(name: str) -> None:
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Stock": CHAINLESS, "Attic": CHAINLESS}))
    assert profile_plugin(backfilled, name, "bauer")["frequency"] == "850"


def test_a_backfilled_chain_reads_back_as_a_non_empty_post() -> None:
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Stock": CHAINLESS}))
    assert json.loads(matrixconf.read_profiles(backfilled))["Stock"]["post"] != {}


# --- a profile that already carries a chain is left exactly as it was ----------


def test_a_profile_that_already_carries_a_chain_comes_back_byte_identical() -> None:
    xml = snapshot({"Day": CHAINED, "Stock": CHAINLESS})
    assert stored_element(matrixconf.backfill_profile_chains(xml), "Day") == stored_element(xml, "Day")


def test_a_profile_that_already_carries_a_chain_keeps_its_own_plugin_value() -> None:
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Day": CHAINED, "Stock": CHAINLESS}))
    assert profile_plugin(backfilled, "Day", "bauer")["frequency"] == "300"


def test_a_chainless_profile_beside_a_chained_one_is_still_filled() -> None:
    # a backfill that gives up as soon as one profile carries a chain leaves
    # "Stock" empty, and every other case in this file would still pass
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Day": CHAINED, "Stock": CHAINLESS}))
    assert profile_plugin(backfilled, "Stock", "bauer")["frequency"] == "850"


# --- nothing to copy: the snapshot comes back unchanged ------------------------


def test_a_snapshot_whose_live_matrix_has_no_chain_comes_back_unchanged() -> None:
    xml = snapshot({"Stock": CHAINLESS}, live_chain="")
    assert matrixconf.backfill_profile_chains(xml) == xml


#: A live ``<matrix>`` element that is present but carries nothing at all — no
#: rows, no chain. There is still nothing to copy.
EMPTY_MATRIX = (
    '<?xml version="1.0" encoding="UTF-8"?><hqplayerd><engine channels="2">'
    f'<matrix_profile name="Stock">{CHAINLESS}</matrix_profile>'
    '<matrix enabled="1"></matrix></engine></hqplayerd>'
).encode()

UNTOUCHED = [
    pytest.param(snapshot({"Stock": CHAINLESS}, matrix=False), id="no-matrix-element"),
    pytest.param(EMPTY_MATRIX, id="empty-matrix-body"),
    pytest.param(snapshot({}), id="no-saved-profiles"),
    pytest.param(b"<hqplayerd/>", id="bare-root"),
]


@pytest.mark.parametrize("xml", UNTOUCHED)
def test_a_snapshot_with_nothing_to_backfill_comes_back_unchanged(xml: bytes) -> None:
    assert matrixconf.backfill_profile_chains(xml) == xml


# --- the rows are left alone; the chain lands beside them ----------------------


def test_a_backfilled_profile_keeps_its_own_pipeline_rows() -> None:
    xml = snapshot({"Stock": CHAINLESS})
    assert profile_rows(matrixconf.backfill_profile_chains(xml), "Stock") == profile_rows(xml, "Stock")


def test_a_backfilled_profile_does_not_gain_the_live_matrixs_rows() -> None:
    # the live matrix's only row sits at gain -2, a gain no profile here carries
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Stock": CHAINLESS}))
    assert "-2" not in [row["gain"] for row in profile_rows(backfilled, "Stock")]


# --- the copy is verbatim ------------------------------------------------------


@pytest.mark.parametrize(
    ("attr", "value"), [("dac", "Holo Audio Cyan 2"), ("filter_length", "65536")], ids=["dac", "unknown-attr"]
)
def test_an_attribute_hqptuner_has_no_field_for_survives_into_the_profile(attr: str, value: str) -> None:
    backfilled = matrixconf.backfill_profile_chains(snapshot({"Stock": CHAINLESS}, live_chain=ODD_CHAIN))
    assert profile_plugin(backfilled, "Stock", "correction").get(attr) == value


# --- through a whole apply -----------------------------------------------------


async def test_after_an_apply_every_profile_reads_back_with_a_non_empty_post(
    http_manager: ConnectionManager,
) -> None:
    # the fake daemon ships "Stock", a profile saved before chains were stored
    await http_manager.applyops.apply({}, {"title": "Renamed"})
    assert all(p["post"] for p in (await running_profiles(http_manager)).values())


async def test_an_apply_keeps_every_profile_the_config_carried(http_manager: ConnectionManager) -> None:
    # the non-empty-post case above is vacuous if the apply dropped the profiles
    await http_manager.applyops.apply({}, {"title": "Renamed"})
    assert set(await running_profiles(http_manager)) == {"Stock"}


async def test_after_an_apply_a_backfilled_profile_carries_the_live_chains_value(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["post_bauer_frequency"] = "850"
    await http_manager.applyops.apply({}, {"title": "Renamed"})
    assert (await running_profiles(http_manager))["Stock"]["post"]["post_bauer_frequency"] == "850"


def test_an_apply_under_a_chainless_active_profile_leaves_the_live_chain_intact() -> None:
    # "Stock" ships chain-less; loading it used to install an empty chain
    xml = cfg_xml(state(post_bauer_frequency="850"))
    applied = presetconf.apply_edits(xml, {"title": "Renamed"}, profile="Stock")
    assert adopted(applied)["post_bauer_frequency"] == "850"


# --- stored presets, each from its own live matrix -----------------------------


def preset_xml(bauer: str) -> bytes:
    """A stored preset: a full 6.0.4-shaped snapshot whose live matrix sits at the
    given bauer frequency and whose one saved profile carries no chain."""
    return cfg_xml(state(post_bauer_frequency=bauer, _profiles={"Stock": {"rows": [], "plugins": []}}))


@pytest.mark.parametrize(("preset", "frequency"), [("Office", "850"), ("Den", "300")])
async def test_each_presets_profiles_are_backfilled_from_that_presets_own_chain(
    http_manager: ConnectionManager, preset: str, frequency: str
) -> None:
    http_manager.presetops.store.save("Office", preset_xml("850"))
    http_manager.presetops.store.save("Den", preset_xml("300"))
    http_manager.presetops.backfill_profiles()
    assert profile_plugin(http_manager.presetops.store.read(preset), "Stock", "bauer")["frequency"] == frequency


async def test_a_backfilled_preset_reports_ok(http_manager: ConnectionManager) -> None:
    http_manager.presetops.store.save("Office", preset_xml("850"))
    assert http_manager.presetops.backfill_profiles()["Office"] == "ok"


async def test_a_preset_whose_live_matrix_has_no_chain_keeps_its_bytes(http_manager: ConnectionManager) -> None:
    seeded = snapshot({"Stock": CHAINLESS}, live_chain="")
    http_manager.presetops.store.save("Attic", seeded)
    http_manager.presetops.backfill_profiles()
    assert http_manager.presetops.store.read("Attic") == seeded


async def test_a_preset_whose_live_matrix_has_no_chain_is_absent_from_the_report(
    http_manager: ConnectionManager,
) -> None:
    # the report carries a key only for a preset that was written or that failed
    http_manager.presetops.store.save("Attic", snapshot({"Stock": CHAINLESS}, live_chain=""))
    assert "Attic" not in http_manager.presetops.backfill_profiles()


async def test_a_preset_whose_profiles_all_carry_chains_keeps_its_bytes(http_manager: ConnectionManager) -> None:
    seeded = snapshot({"Day": CHAINED})
    http_manager.presetops.store.save("Den", seeded)
    http_manager.presetops.backfill_profiles()
    assert http_manager.presetops.store.read("Den") == seeded


async def test_a_preset_whose_profiles_all_carry_chains_is_absent_from_the_report(
    http_manager: ConnectionManager,
) -> None:
    http_manager.presetops.store.save("Den", snapshot({"Day": CHAINED}))
    assert "Den" not in http_manager.presetops.backfill_profiles()


# --- a preset that cannot be read ----------------------------------------------


def unreadable(preset_dir: Path, name: str) -> None:
    """Make that stored preset's file unreadable: the entry stays in the store's
    directory under the same name, and reading it raises."""
    path = next(p for p in preset_dir.iterdir() if p.stem == name)
    path.unlink()
    path.mkdir()


async def test_a_preset_that_cannot_be_read_does_not_report_ok(http_manager: ConnectionManager, tmp_path: Path) -> None:
    http_manager.presetops.store.save("Broken", preset_xml("850"))
    unreadable(tmp_path / "presets", "Broken")
    assert http_manager.presetops.backfill_profiles()["Broken"] != "ok"


async def test_a_preset_that_cannot_be_read_does_not_block_a_healthy_one(
    http_manager: ConnectionManager, tmp_path: Path
) -> None:
    http_manager.presetops.store.save("Broken", preset_xml("850"))
    http_manager.presetops.store.save("Office", preset_xml("850"))
    unreadable(tmp_path / "presets", "Broken")
    assert http_manager.presetops.backfill_profiles()["Office"] == "ok"
