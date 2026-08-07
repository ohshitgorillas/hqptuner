"""An apply made while a matrix profile is active materializes that profile.

The active profile is runtime-only state: ``<matrix_profile>`` carries a
``name`` attribute and nothing else (hqplayerd-readme.txt §1.12), so a restarted
daemon always comes up running the live ``<matrix>``. An apply restarts the
daemon, so before anything else the active profile's stored matrix — its
``<pipeline>`` rows AND its own ``<post_process>`` chain (§1.11.2) — is copied
into the live ``<matrix>``, and the staged edits land on top of that.

The snapshots are rendered by the fake daemon's own config renderer, and the
LIVE matrix is read back through the fake's independent adopter (``adopt_cfg``,
which scopes its plugin scan to the ``<matrix>`` body so a stored profile's
chain is never mistaken for the running one) rather than through HQPTuner's own
reader — a writer and a reader sharing one bug would otherwise round-trip green.
Every value a test asserts on is one the fake's own defaults cannot produce —
the live rows sit at gain -2 and the profile's at -7, against a default of 0 —
so "nothing was written" cannot read as a pass in either direction.
"""

import json
import re
from typing import Any

import pytest
from fake_config_xml import adopt_cfg, cfg_xml
from fake_http import state

from hqptuner.conf import matrixconf, presetconf
from hqptuner.conf.xmledit import GroundingError

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}

#: Night's stored rows: one row, at a gain no live matrix in these snapshots has.
NIGHT_ROWS = [{"gain": "-7", "mixdown": "0", "process": "", "source": "1"}]

#: Night's stored chain. Bauer at 300 (the live matrices below sit at 850, the
#: fake's default is 700) and loudness stored OFF at 120 Hz (live: 440 Hz).
NIGHT_PLUGINS = [
    {"type": "bauer", "enabled": "1", "frequency": "300", "preset": "default", "level": "4.5"},
    {
        "type": "loudness",
        "enabled": "0",
        "low_frequency": "120",
        "low_level": "20",
        "low_steepness": "0.5",
        "low_type": "lshelf",
        "high_frequency": "5000",
        "high_level": "10",
        "high_steepness": "1.0",
        "high_type": "hshelf",
        "range_low": "-60",
        "range_high": "-20",
    },
]

#: The live matrix's own rows: two of them, at a gain that is neither the fake's
#: default (0) nor Night's (-7), so "the live rows were kept" is distinguishable
#: from "the live rows were wiped and nothing was written back".
LIVE_ROWS = [
    {"gain": "-2", "mixdown": "0", "process": "", "source": "0"},
    {"gain": "-2", "mixdown": "1", "process": "", "source": "1"},
]

#: The live matrix these cases start from: two rows at gain -2, a bauer stage at
#: 850, loudness off at 440 Hz, and a correction stage Night knows nothing about.
LIVE = {
    "_pipelines": LIVE_ROWS,
    "post_bauer_enabled": True,
    "post_bauer_frequency": "850",
    "post_loudness_enabled": False,
    "post_loudness_lowfreq": "440",
    "post_correction_enabled": True,
    "post_correction_dac0": "live.wav",
}


def cfg(plugins: list[dict[str, str]] | None = None, **overrides: Any) -> bytes:
    """A 6.0.4-shaped snapshot whose live matrix is ``LIVE`` and which carries a
    saved "Night" profile with the given stored chain."""
    profiles = {"Night": {"rows": NIGHT_ROWS, "plugins": NIGHT_PLUGINS if plugins is None else plugins}}
    return cfg_xml(state(_profiles=profiles, **{**LIVE, **overrides}))


def live_state(xml: bytes) -> dict[str, Any]:
    """What a daemon re-reading this config would be running: the fake's own
    adopter, over the ``<matrix>`` element alone."""
    st = state()
    adopt_cfg(st, xml)
    return st


def live_matrix(xml: bytes) -> bytes:
    """The live ``<matrix>`` element's body. ``<matrix_profile>`` does not match
    ``<matrix\\b``, so a stored profile never leaks in here."""
    m = re.search(rb"<matrix\b[^>]*>(.*?)</matrix>", xml, re.S)
    return m.group(1) if m else b""


def stored_element(xml: bytes, name: str) -> bytes:
    """The stored profile element itself, by the documented shape (readme §1.12)."""
    pattern = rb'<matrix_profile\b[^>]*name="' + re.escape(name).encode() + rb'"[^>]*>.*?</matrix_profile>'
    m = re.search(pattern, xml, re.S)
    return m.group(0) if m else b""


def stored_plugin(xml: bytes, name: str, plugin_type: str) -> dict[str, str]:
    """One plugin of a STORED profile's chain, as the fake's adopter reads it back
    (it keeps each profile's own ``<post_process>`` separate from the live one)."""
    plugins: list[dict[str, str]] = live_state(xml)["_profiles"].get(name, {}).get("plugins", [])
    return next((p for p in plugins if p.get("type") == plugin_type), {})


def save_field(name: str) -> dict[str, str]:
    return {"matrix_profile_save": json.dumps({"name": name, "rows": [ROW0]})}


# --- the profile's rows become the live matrix's rows -------------------------


def test_materializing_a_profile_installs_its_rows_as_the_live_rows() -> None:
    assert live_state(matrixconf.materialize_profile(cfg(), "Night"))["_pipelines"][0]["gain"] == "-7"


def test_materializing_a_profile_leaves_only_its_own_rows_live() -> None:
    # the live matrix started with two rows; Night stores one
    assert len(live_state(matrixconf.materialize_profile(cfg(), "Night"))["_pipelines"]) == 1


def test_an_apply_under_an_active_profile_installs_that_profiles_rows() -> None:
    applied = presetconf.apply_edits(cfg(), {"title": "Renamed"}, profile="Night")
    assert live_state(applied)["_pipelines"][0]["gain"] == "-7"


# --- the profile's post-process chain becomes the live chain ------------------


def test_materializing_a_profile_installs_its_plugin_value_as_the_live_one() -> None:
    assert live_state(matrixconf.materialize_profile(cfg(), "Night"))["post_bauer_frequency"] == "300"


def test_materializing_a_profile_installs_its_second_plugins_value_too() -> None:
    assert live_state(matrixconf.materialize_profile(cfg(), "Night"))["post_loudness_lowfreq"] == "120"


def test_an_apply_under_an_active_profile_installs_that_profiles_chain() -> None:
    applied = presetconf.apply_edits(cfg(), {"title": "Renamed"}, profile="Night")
    assert live_state(applied)["post_bauer_frequency"] == "300"


def test_a_live_stage_the_profile_does_not_carry_does_not_survive_adoption() -> None:
    # the live matrix had a correction stage pointed at live.wav; Night's stored
    # chain has no correction plugin at all, so nothing of it may remain
    assert b"live.wav" not in live_matrix(matrixconf.materialize_profile(cfg(), "Night"))


# --- a staged edit lands on top of the adopted chain --------------------------


def test_a_staged_switch_beats_the_adopted_profiles_stored_value() -> None:
    # Night stores loudness OFF and the live matrix has it OFF; only the staged
    # edit can make it read on, and only if adoption ran BEFORE the edit
    applied = presetconf.apply_edits(cfg(), {"post_loudness_enabled": "1"}, profile="Night")
    assert live_state(applied)["post_loudness_enabled"] is True


def test_a_staged_plugin_value_beats_the_adopted_profiles_stored_value() -> None:
    applied = presetconf.apply_edits(cfg(), {"post_bauer_frequency": "555"}, profile="Night")
    assert live_state(applied)["post_bauer_frequency"] == "555"


# --- the stored profile is a snapshot: adoption never edits it ----------------


def test_materializing_leaves_the_stored_profile_element_byte_identical() -> None:
    snapshot = cfg()
    assert stored_element(matrixconf.materialize_profile(snapshot, "Night"), "Night") == stored_element(
        snapshot, "Night"
    )


def test_an_apply_under_an_active_profile_leaves_the_stored_profile_alone() -> None:
    snapshot = cfg()
    applied = presetconf.apply_edits(snapshot, {"post_bauer_frequency": "555"}, profile="Night")
    assert stored_element(applied, "Night") == stored_element(snapshot, "Night")


# --- a profile that stores no chain clears the live one -----------------------


def test_adopting_a_chainless_profile_leaves_no_plugin_in_the_live_matrix() -> None:
    assert b"<plugin" not in live_matrix(matrixconf.materialize_profile(cfg(plugins=[]), "Night"))


# --- no active profile: nothing is adopted ------------------------------------


@pytest.mark.parametrize("profile", [None, ""])
def test_with_no_active_profile_the_live_rows_are_untouched(profile: str | None) -> None:
    applied = presetconf.apply_edits(cfg(), {"title": "Renamed"}, profile=profile)
    assert live_state(applied)["_pipelines"][0]["gain"] == "-2"


@pytest.mark.parametrize("profile", [None, ""])
def test_with_no_active_profile_the_live_chain_is_untouched(profile: str | None) -> None:
    applied = presetconf.apply_edits(cfg(), {"title": "Renamed"}, profile=profile)
    assert live_state(applied)["post_bauer_frequency"] == "850"


@pytest.mark.parametrize("profile", [None, ""])
def test_with_no_active_profile_the_staged_edit_still_lands(profile: str | None) -> None:
    applied = presetconf.apply_edits(cfg(), {"post_bauer_frequency": "555"}, profile=profile)
    assert live_state(applied)["post_bauer_frequency"] == "555"


# --- deleting the active profile in the same apply: nothing to adopt ----------

DELETE_SHAPES = [
    pytest.param("Night", id="plain-name"),
    pytest.param(json.dumps({"name": "Night", "presets": []}), id="targeted-object"),
]


@pytest.mark.parametrize("payload", DELETE_SHAPES)
def test_deleting_the_active_profile_adopts_none_of_its_rows(payload: str) -> None:
    applied = presetconf.apply_edits(cfg(), {"matrix_profile_delete": payload}, profile="Night")
    assert live_state(applied)["_pipelines"][0]["gain"] == "-2"


@pytest.mark.parametrize("payload", DELETE_SHAPES)
def test_deleting_the_active_profile_adopts_none_of_its_chain(payload: str) -> None:
    applied = presetconf.apply_edits(cfg(), {"matrix_profile_delete": payload}, profile="Night")
    assert live_state(applied)["post_bauer_frequency"] == "850"


@pytest.mark.parametrize("payload", DELETE_SHAPES)
def test_deleting_the_active_profile_still_removes_the_element(payload: str) -> None:
    applied = presetconf.apply_edits(cfg(), {"matrix_profile_delete": payload}, profile="Night")
    assert stored_element(applied, "Night") == b""


# --- a profile the config does not carry: loud, never a silent fallback -------


def test_materializing_a_profile_the_config_lacks_names_it_in_the_error() -> None:
    with pytest.raises(GroundingError, match="Ghost"):
        matrixconf.materialize_profile(cfg(), "Ghost")


def test_an_apply_under_a_profile_the_config_lacks_names_it_in_the_error() -> None:
    with pytest.raises(GroundingError, match="Ghost"):
        presetconf.apply_edits(cfg(), {"title": "Renamed"}, profile="Ghost")


# --- a save taken while a profile is active captures the adopted chain --------


def test_a_save_under_an_active_profile_stores_the_adopted_profiles_chain() -> None:
    applied = presetconf.apply_edits(cfg(), save_field("Dusk"), profile="Night")
    assert stored_plugin(applied, "Dusk", "bauer").get("frequency") == "300"
