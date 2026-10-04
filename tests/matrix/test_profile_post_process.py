"""A saved matrix profile carries its post-process chain.

``<post_process>`` nests inside ``<matrix>`` (hqplayerd-readme.txt §1.11.2), so
the plugin chain is part of a matrix profile rather than a global setting: a
profile that stored only its ``<pipeline>`` rows hands back less than the user
saved. These tests pin what a save stores, what a read hands back, and where in
an apply the captured values come from.

The XML snapshots are rendered by the fake daemon's own config renderer, so the
writer is exercised against 6.0.4-shaped documents, and the whole-apply cases
run through the faithful HTTP fake. Post-process values are asserted as the raw
XML attribute strings HQPTuner's own config reader yields for a plugin field
(``tests/apply/test_absent_targets.py`` pins that round-trip for every field in
``PLUGIN_MAP``).
"""

import json
import re
from collections.abc import Callable
from typing import Any

import pytest
from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.conf import matrixconf, matrixprofiles, presetconf
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import fileconfig

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "-3", "gainunit": "dB", "mixdown": "1", "process": ""}

#: Nothing but a bare root: no matrix, no chain, no profile.
BARE = b"<hqplayerd/>"

#: A 6.0.4-shaped config whose matrix has rows but no plugin chain at all — the
#: ordinary state of a config whose owner has never used crossfeed or correction.
NO_CHAIN = (
    b'<hqplayerd><engine channels="2"><matrix enabled="1">'
    b'<pipeline channel="0" gain="0" mixdown="0" process="" source="0"/>'
    b"</matrix></engine></hqplayerd>"
)


def cfg(**overrides: object) -> bytes:
    """A full config snapshot from the fake's renderer, with no saved profiles
    unless a case asks for one."""
    return cfg_xml(state(_profiles={}, **overrides))


def save_value(name: str, *rows: dict[str, str]) -> str:
    """The save payload: the name plus the rows the user is looking at."""
    return json.dumps({"name": name, "rows": list(rows) or [ROW0]})


def staged_save(name: str, *rows: dict[str, str]) -> dict[str, str]:
    return {matrixprofiles.MATRIX_PROFILE_SAVE: save_value(name, *rows)}


def profiles_of(xml: bytes) -> dict[str, dict[str, Any]]:
    profiles: dict[str, dict[str, Any]] = json.loads(matrixprofiles.read_profiles(xml))
    return profiles


def post_of(xml: bytes, name: str) -> dict[str, str]:
    post: dict[str, str] = profiles_of(xml)[name]["post"]
    return post


def rows_of(xml: bytes, name: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = profiles_of(xml)[name]["rows"]
    return rows


def without_profile(xml: bytes, name: str) -> bytes:
    """The snapshot with that profile's element excised, by the documented element
    shape (readme §1.12) — what a write must have left byte-identical."""
    pattern = rb'<matrix_profile\b[^>]*name="' + re.escape(name).encode() + rb'"[^>]*>.*?</matrix_profile>'
    return re.sub(pattern, b"", xml, flags=re.DOTALL)


async def running_profiles(manager: ConnectionManager) -> dict[str, dict[str, Any]]:
    """The saved profiles of the running config, read back from the daemon."""
    cfg_fields = await fileconfig.load_file_config(manager)
    profiles: dict[str, dict[str, Any]] = json.loads(cfg_fields["matrix_profiles"])
    return profiles


# --- writing: the chain that was live at save time ----------------------------


def test_a_written_profile_carries_a_switch_that_was_off_as_off() -> None:
    written = matrixprofiles.write_profile(cfg(post_loudness_enabled=False), save_value("Night", ROW0))
    assert post_of(written, "Night")["post_loudness_enabled"] == "0"


def test_a_profile_written_from_a_matrix_with_no_chain_stores_the_profile() -> None:
    assert "Night" in profiles_of(matrixprofiles.write_profile(NO_CHAIN, save_value("Night", ROW0)))


#: The post fields the fake's rendered chain supplies, sorted: its correction
#: stage (enabled, dac0), its bauer stage (enabled, frequency, preset, level) and
#: its loudness stage (enabled and its ten band attributes).
FIXTURE_CHAIN_FIELDS = [
    "post_bauer_enabled",
    "post_bauer_frequency",
    "post_bauer_level",
    "post_bauer_preset",
    "post_correction_dac0",
    "post_correction_enabled",
    "post_loudness_enabled",
    "post_loudness_highfreq",
    "post_loudness_highlevel",
    "post_loudness_highsteep",
    "post_loudness_hightype",
    "post_loudness_lowfreq",
    "post_loudness_lowlevel",
    "post_loudness_lowsteep",
    "post_loudness_lowtype",
    "post_loudness_rangehigh",
    "post_loudness_rangelow",
]

#: A live chain with bauer at 850, a frequency the fake's default (700) is not.
BAUER_850 = cfg(post_bauer_frequency="850")

#: A live chain with loudness switched on, which the fake's default is not.
LOUDNESS_ON = cfg(post_loudness_enabled=True)


def written_post(snapshot: bytes) -> dict[str, str]:
    """The post settings of a "Night" profile written over ``snapshot``."""
    return post_of(matrixprofiles.write_profile(snapshot, save_value("Night", ROW0)), "Night")


#: The post fields a written profile carries: none from a matrix with no chain,
#: every field of the live chain from a matrix that has one.
CHAIN_CAPTURE = [
    pytest.param(NO_CHAIN, [], id="no-chain"),
    pytest.param(BAUER_850, FIXTURE_CHAIN_FIELDS, id="live-chain"),
]


@pytest.mark.parametrize(("snapshot", "expected"), CHAIN_CAPTURE)
def test_a_written_profile_carries_the_fields_of_the_chain_it_was_saved_from(
    snapshot: bytes, expected: list[str]
) -> None:
    assert sorted(written_post(snapshot)) == expected


def test_a_written_profile_carries_the_live_chains_plugin_value() -> None:
    assert written_post(BAUER_850)["post_bauer_frequency"] == "850"


#: The post fields a written profile carries: none from a config with no matrix,
#: every field of the live chain from a matrix whose switch is on.
SWITCH_CAPTURE = [
    pytest.param(BARE, [], id="no-matrix"),
    pytest.param(LOUDNESS_ON, FIXTURE_CHAIN_FIELDS, id="switched-on"),
]


@pytest.mark.parametrize(("snapshot", "expected"), SWITCH_CAPTURE)
def test_a_written_profile_carries_the_fields_of_the_matrix_it_was_saved_from(
    snapshot: bytes, expected: list[str]
) -> None:
    assert sorted(written_post(snapshot)) == expected


def test_a_written_profile_carries_a_switch_that_was_on_as_on() -> None:
    assert written_post(LOUDNESS_ON)["post_loudness_enabled"] == "1"


# --- writing: the rows are the payload's, not the live matrix's ---------------


def test_a_written_profile_carries_the_payloads_rows_not_the_live_ones() -> None:
    # the live matrix in this snapshot holds two rows at gain 0; the user is
    # looking at one staged row at -3
    written = matrixprofiles.write_profile(cfg(), save_value("Night", ROW1))
    assert rows_of(written, "Night")[0]["gain"] == "-3"


def test_a_written_profile_holds_only_the_payloads_rows() -> None:
    written = matrixprofiles.write_profile(cfg(), save_value("Night", ROW1))
    assert len(rows_of(written, "Night")) == 1


# --- writing onto a name that is taken: whole replacement ---------------------


def test_rewriting_a_taken_name_leaves_exactly_one_profile_of_that_name() -> None:
    once = matrixprofiles.write_profile(cfg(), save_value("Night", ROW0, ROW1))
    twice = matrixprofiles.write_profile(once, save_value("Night", ROW0))
    assert twice.count(b'<matrix_profile name="Night"') == 1


def test_rewriting_a_taken_name_drops_the_replaced_copys_rows() -> None:
    once = matrixprofiles.write_profile(cfg(), save_value("Night", ROW0, ROW1))
    twice = matrixprofiles.write_profile(once, save_value("Night", ROW0))
    assert len(rows_of(twice, "Night")) == 1


def test_rewriting_a_taken_name_drops_the_replaced_copys_plugin_settings() -> None:
    once = matrixprofiles.write_profile(cfg(post_bauer_frequency="850"), save_value("Night", ROW0))
    retuned = presetconf.apply_edits(once, {"post_bauer_frequency": "300"})
    twice = matrixprofiles.write_profile(retuned, save_value("Night", ROW0))
    assert post_of(twice, "Night")["post_bauer_frequency"] == "300"


# --- writing: every other byte preserved --------------------------------------


def test_writing_a_profile_leaves_every_other_byte_of_the_snapshot_alone() -> None:
    snapshot = cfg(post_bauer_frequency="850")
    written = matrixprofiles.write_profile(snapshot, save_value("Night", ROW0))
    assert without_profile(written, "Night") == snapshot


def test_writing_a_profile_leaves_the_live_chain_reading_as_it_did() -> None:
    written = matrixprofiles.write_profile(cfg(post_bauer_frequency="850"), save_value("Night", ROW0))
    assert presetconf.read_config(written)["post_bauer_frequency"] == "850"


# --- reading back --------------------------------------------------------------


def test_the_readback_names_every_saved_profile() -> None:
    once = matrixprofiles.write_profile(cfg(), save_value("Night", ROW0))
    twice = matrixprofiles.write_profile(once, save_value("Day", ROW1))
    assert set(profiles_of(twice)) == {"Night", "Day"}


def test_each_profile_reads_back_with_its_own_rows() -> None:
    once = matrixprofiles.write_profile(cfg(), save_value("Night", ROW0))
    twice = matrixprofiles.write_profile(once, save_value("Day", ROW1))
    assert rows_of(twice, "Day")[0]["source"] == "1"


def stock_as_shipped() -> bytes:
    """The fake's config as shipped: "Stock" is a profile element with rows and no
    ``<post_process>``, saved before chains were stored."""
    return cfg_xml(state())


def stock_resaved_with_a_chain() -> bytes:
    """The same "Stock" saved again over a live chain with bauer at 850."""
    return matrixprofiles.write_profile(cfg_xml(state(post_bauer_frequency="850")), save_value("Stock", ROW0))


#: Nothing migrates a chainless profile, and reading it is not an error: it
#: reads back with no post fields until it is resaved over a chain.
LEGACY_READBACK = [
    pytest.param(stock_as_shipped, [], id="as-shipped"),
    pytest.param(stock_resaved_with_a_chain, FIXTURE_CHAIN_FIELDS, id="resaved"),
]


@pytest.mark.parametrize(("snapshot", "expected"), LEGACY_READBACK)
def test_a_profile_saved_before_chains_were_stored_reads_back_a_chain_only_once_resaved_with_one(
    snapshot: Callable[[], bytes], expected: list[str]
) -> None:
    assert sorted(post_of(snapshot(), "Stock")) == expected


def test_a_profile_saved_before_chains_were_stored_reads_back_the_chains_value_once_resaved() -> None:
    assert post_of(stock_resaved_with_a_chain(), "Stock")["post_bauer_frequency"] == "850"


def test_post_settings_read_back_under_hqptuners_own_form_field_names() -> None:
    written = matrixprofiles.write_profile(cfg(), save_value("Night", ROW0))
    assert set(post_of(written, "Night")) <= set(matrixconf.PLUGIN_MAP)


def test_a_profiles_post_settings_can_be_staged_straight_back_as_config_edits() -> None:
    written = matrixprofiles.write_profile(cfg(post_bauer_frequency="850"), save_value("Night", ROW0))
    post = post_of(written, "Night")
    staged = presetconf.read_config(presetconf.apply_edits(BARE, post))
    assert {field: staged[field] for field in post} == post


# --- ordering through a whole apply --------------------------------------------


async def test_an_apply_that_switches_correction_on_saves_the_profile_with_it_on(
    http_manager: ConnectionManager,
) -> None:
    edits = {"post_correction_enabled": "1", **staged_save("Night", ROW0)}
    await http_manager.applyops.apply({}, edits)
    assert (await running_profiles(http_manager))["Night"]["post"]["post_correction_enabled"] == "1"


async def test_an_apply_that_switches_correction_off_saves_the_profile_with_it_off(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["post_correction_enabled"] = True
    edits = {"post_correction_enabled": "0", **staged_save("Night", ROW0)}
    await http_manager.applyops.apply({}, edits)
    assert (await running_profiles(http_manager))["Night"]["post"]["post_correction_enabled"] == "0"


async def test_a_save_with_no_post_edits_staged_captures_what_the_config_held(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["post_bauer_frequency"] = "850"
    await http_manager.applyops.apply({}, staged_save("Night", ROW0))
    assert (await running_profiles(http_manager))["Night"]["post"]["post_bauer_frequency"] == "850"


async def test_saving_a_profile_leaves_the_live_chain_playing_as_it_was(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["post_bauer_frequency"] = "850"
    await http_manager.applyops.apply({}, staged_save("Night", ROW0))
    assert http_daemon["post_bauer_frequency"] == "850"


async def test_saving_a_profile_does_not_switch_the_live_correction(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["post_correction_enabled"] = True
    await http_manager.applyops.apply({}, staged_save("Night", ROW0))
    assert http_daemon["post_correction_enabled"] is True
