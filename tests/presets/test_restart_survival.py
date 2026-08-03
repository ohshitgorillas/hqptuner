"""The active preset's stored settings survive a restart-shaped write
(docs/testing.md — behavior only, one assertion per test, public API only,
fakes speak the wire protocol).

Output mode, both chains' filters and shapers, adaptive volume and the
per-family rate limits are applied over the 4321 control lane and never reach
hqplayerd's config file. hqplayerd boots from that file, so any write that
restarts it — every persistent apply, which is a ``POST /restore`` by
construction (protocol.md §3.6) — boots the daemon onto a file that never
learned them. The contract asserted here: while a preset is active, a
restore-lane write pushes a config carrying THAT preset's stored values for
exactly those settings, so the daemon comes back running what the user thinks
they saved.

Everything is read back off the fake 8088 daemon, which adopts the uploaded
``hqplayerd.xml`` as its running config — so ``GET /api/config``'s ``file`` view
is the daemon's own truth about what it booted on, not a claim by the lane that
wrote it. The control lane is at a closed port under ``http_client``, so no live
overlay colours that view.

The auto-save checkbox is deliberately absent from this file: it decides whether
the store is UPDATED, never whether the store is HONOURED.
"""

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.conf import presetconf
from hqptuner.presets.presetstore import PresetStore

# What the fake daemon's config file carries before anything is applied
# (tests/support/fake_config_xml.py). Every stored value below differs from it,
# so a fold that never happened is visible as the running value surviving.
RUNNING_MODE = "sdm"
RUNNING_VOLUME_MIN = "-60"

#: Stored value per live-routed setting, each distinct from the running config's.
STORED_LIVE_ROUTED = [
    ("filter1x", "5"),
    ("filter", "25"),
    ("dither", "5"),
    ("oversampling1x", "38"),
    ("oversampling", "23"),
    ("modulator", "3"),
    ("adaptive_volume", "1"),
    ("defaults_samplerate", "384000"),
    ("defaults_bitrate", "49152000"),
]


def _active_preset_carrying(client: TestClient, preset_dir: Path, edits: dict[str, str], name: str = "Kept") -> None:
    """Make ``name`` the active preset and give its stored snapshot values the
    running config does not have.

    Saving over REST stores the running config and makes it active; a second
    ``PresetStore`` on the app's own preset directory then edits that snapshot on
    disk, which is how the store comes to disagree with the daemon (the shape
    ``test_autosave._point_autosave_at`` uses, minus its flag)."""
    client.post("/api/profile/save", json={"name": name})
    store = PresetStore(preset_dir)
    store.save(name, presetconf.apply_edits(store.read(name), edits))


def _booted_config(client: TestClient) -> dict[str, Any]:
    """The config the daemon is now running, as it serves it back."""
    client.post("/api/config/refresh")  # /config only serves once the forms are fetched
    return dict(client.get("/api/config").json()["data"]["file"])


# --- a stored setting the config file never learned rides the restore --------


def test_a_stored_output_mode_is_what_the_daemon_boots_on(http_client: TestClient, tmp_path: Path) -> None:
    # nobody staged a mode and the running file said sdm; the active preset says
    # pcm, and the daemon boots on the preset's answer
    _active_preset_carrying(http_client, tmp_path / "presets", {"mode": "pcm"})
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert _booted_config(http_client)["mode"] == "pcm"


@pytest.mark.parametrize(("field", "stored"), STORED_LIVE_ROUTED)
def test_a_stored_live_routed_setting_is_what_the_daemon_boots_on(
    http_client: TestClient, tmp_path: Path, field: str, stored: str
) -> None:
    _active_preset_carrying(http_client, tmp_path / "presets", {field: stored})
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert _booted_config(http_client)[field] == stored


#: (field, stored, staged) per setting, sampled across the XML elements the fold
#: touches — <pcm>, <sdm>, <mode> and <engine><defaults> — each triple distinct
#: from the running config's value for that field, so only the staged value can
#: be read back by accident. ``mode``'s third value is ``auto`` (readme §1.7:
#: pcm / sdm / auto), running ``sdm``.
STAGED_BEATS_STORED = [
    ("filter", "25", "17"),  # <pcm filter>, running 40
    ("modulator", "3", "7"),  # <sdm modulator>, running 12
    ("mode", "auto", "pcm"),  # <mode value>, running sdm
    ("defaults_samplerate", "384000", "705600"),  # <defaults samplerate>, running 192000
]


@pytest.mark.parametrize(("field", "stored", "staged"), STAGED_BEATS_STORED)
def test_a_staged_edit_beats_the_stored_value_for_the_same_setting(
    http_client: TestClient, tmp_path: Path, field: str, stored: str, staged: str
) -> None:
    _active_preset_carrying(http_client, tmp_path / "presets", {field: stored})
    http_client.post("/api/config/stage", json={"http": {field: staged}})
    http_client.post("/api/config/apply")
    assert _booted_config(http_client)[field] == staged


def test_a_stored_setting_outside_the_set_does_not_overwrite_the_running_one(
    http_client: TestClient, tmp_path: Path
) -> None:
    # applies are incremental against the RUNNING config, never a rebuild from
    # the preset: a rebuild would reset every field the user did not stage
    _active_preset_carrying(http_client, tmp_path / "presets", {"volume_min": "-40"})
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert _booted_config(http_client)["volume_min"] == RUNNING_VOLUME_MIN


# --- nothing to fold: no preset, or an active one with no snapshot ----------


def test_with_no_active_preset_the_running_value_is_what_boots(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert _booted_config(http_client)["mode"] == RUNNING_MODE


def test_an_active_preset_with_no_stored_snapshot_folds_nothing(http_client: TestClient, tmp_path: Path) -> None:
    PresetStore(tmp_path / "presets").set_active("Ghost")
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert _booted_config(http_client)["mode"] == RUNNING_MODE


def test_an_active_preset_with_no_stored_snapshot_still_applies(http_client: TestClient, tmp_path: Path) -> None:
    PresetStore(tmp_path / "presets").set_active("Ghost")
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    report = http_client.post("/api/config/apply").json()
    assert report["persistent"]["applied"] is True


# --- the engine-attribute lane restarts the daemon too ----------------------


# Read straight off the fake daemon's adopted state rather than through
# ``/api/config``: the engine lane answers ``submitted`` and the app's own config
# view is not repopulated by the time the call returns, so the daemon's record of
# what it booted on is the only reading that is not a race.


def test_an_engine_apply_boots_the_daemon_on_the_stored_mode(
    http_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    _active_preset_carrying(http_client, tmp_path / "presets", {"mode": "pcm"})
    http_client.post("/api/engine", json={"overrides": {"cuda": "0"}})
    assert http_daemon["mode"] == "pcm"


def test_an_engine_apply_boots_the_daemon_on_the_stored_modulator(
    http_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    _active_preset_carrying(http_client, tmp_path / "presets", {"modulator": "3"})
    http_client.post("/api/engine", json={"overrides": {"cuda": "0"}})
    assert http_daemon["modulator"] == "3"


# adaptive_volume is the collision-prone case: it is an attribute of the very
# <engine> element POST /api/engine is editing (XML volume_adaptive, readme
# §1.6), so a writer that rebuilds that element from its overrides drops the
# stored value while mode and modulator — in elements of their own — survive.


def test_an_engine_apply_boots_the_daemon_on_the_stored_adaptive_volume(
    http_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    _active_preset_carrying(http_client, tmp_path / "presets", {"adaptive_volume": "1"})
    http_client.post("/api/engine", json={"overrides": {"cuda": "0"}})
    assert http_daemon["volume_adaptive"] == "1"


def test_an_engine_override_still_lands_beside_the_stored_engine_attribute(
    http_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the mirror of the case above: folding a stored sibling attribute must not
    # cost the override the caller actually asked for (running cuda is 1)
    _active_preset_carrying(http_client, tmp_path / "presets", {"adaptive_volume": "1"})
    http_client.post("/api/engine", json={"overrides": {"cuda": "0"}})
    assert http_daemon["cuda"] == "0"


# --- the fold is invisible in the report ------------------------------------


FOLDED = {"mode": "pcm", "modulator": "3", "filter": "25"}


def test_an_apply_that_folds_stored_settings_still_reports_applied(http_client: TestClient, tmp_path: Path) -> None:
    _active_preset_carrying(http_client, tmp_path / "presets", FOLDED)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    report = http_client.post("/api/config/apply").json()
    assert report["persistent"]["applied"] is True


def test_an_apply_that_folds_stored_settings_converges_on_its_first_pass(
    http_client: TestClient, tmp_path: Path
) -> None:
    # the fold changes what is pushed, never what the apply intends: the lane
    # must not read its own folded values back as divergence and re-apply to
    # correct them. `attempts` is the pass count the persistent report carries;
    # a clean apply with nothing to fold converges at 1, and folding must not
    # cost a second pass.
    _active_preset_carrying(http_client, tmp_path / "presets", FOLDED)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    report = http_client.post("/api/config/apply").json()
    assert report["persistent"]["attempts"] == 1
