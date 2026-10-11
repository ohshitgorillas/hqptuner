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
from typing import Any

from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.conf import matrixprofiles
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import fileconfig

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "-3", "gainunit": "dB", "mixdown": "1", "process": ""}


def cfg(**overrides: object) -> bytes:
    """A full config snapshot from the fake's renderer, with no saved profiles
    unless a case asks for one."""
    return cfg_xml(state(_profiles={}, **overrides))


def save_value(name: str, *rows: dict[str, str]) -> str:
    """The save payload: the name plus the rows the user is looking at."""
    return json.dumps({"name": name, "rows": list(rows) or [ROW0]})


def staged_save(name: str, *rows: dict[str, str]) -> dict[str, str]:
    return {matrixprofiles.MATRIX_PROFILE_SAVE: save_value(name, *rows)}


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


# --- writing onto a name that is taken: whole replacement ---------------------


def test_rewriting_a_taken_name_leaves_exactly_one_profile_of_that_name() -> None:
    once = matrixprofiles.write_profile(cfg(), save_value("Night", ROW0, ROW1))
    twice = matrixprofiles.write_profile(once, save_value("Night", ROW0))
    assert twice.count(b'<matrix_profile name="Night"') == 1


# --- writing: every other byte preserved --------------------------------------


def test_writing_a_profile_leaves_every_other_byte_of_the_snapshot_alone() -> None:
    snapshot = cfg(post_bauer_frequency="850")
    written = matrixprofiles.write_profile(snapshot, save_value("Night", ROW0))
    assert without_profile(written, "Night") == snapshot


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
