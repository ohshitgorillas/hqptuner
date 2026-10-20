"""What folding the active preset's stored settings into a restore-lane write
must not cost.

Output mode, both chains' filters and shapers, adaptive volume and the
per-family rate limits are applied over the 4321 control lane and never reach
hqplayerd's config file; folding is a restore-lane write, made while a preset
is active, carrying that preset's stored values for them. The cases here
assert that an active preset with no stored snapshot still applies, that an
engine override still lands beside a stored engine attribute, and that an apply
which folds stored settings still reports applied and converges on its first
pass.

The engine override is read back off the fake 8088 daemon, which adopts the
uploaded ``hqplayerd.xml`` as its running config, so its own record is the
daemon's truth about what it booted on, not a claim by the lane that wrote it.

The auto-save checkbox is deliberately absent from this file: it decides whether
the store is UPDATED, never whether the store is HONORED.
"""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from hqptuner.conf import presetconf
from hqptuner.presets.store.presets import PresetStore

#: Restore rows the fake daemon needs to re-read each form field from an
#: uploaded config, beyond the ones it reads unasked: fake state key ->
#: (element tag, attribute). A field with no row would read back as the
#: running value whatever the restore carried.
ADOPTED_BY_FIELD: dict[str, dict[str, tuple[str, str]]] = {
    "modulator": {"modulator": ("sdm", "modulator")},
}


def _active_preset_carrying(client: TestClient, preset_dir: Path, edits: dict[str, str], name: str = "Kept") -> None:
    """Make ``name`` the active preset and give its stored snapshot values the
    running config does not have.

    Saving over REST stores the running config and makes it active; a second
    ``PresetStore`` on the app's own preset directory then edits that snapshot on
    disk, which is how the store comes to disagree with the daemon."""
    client.post("/api/config/apply", json={"switch_to": "", "save": {"name": name}})
    store = PresetStore(preset_dir)
    store.save(name, presetconf.apply_edits(store.read(name), edits))


# --- nothing to fold: no preset, or an active one with no snapshot ----------


def test_an_active_preset_with_no_stored_snapshot_still_applies(http_client: TestClient, tmp_path: Path) -> None:
    PresetStore(tmp_path / "presets").set_active("Ghost")
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    report = http_client.post("/api/config/apply").json()["report"]
    assert report["persistent"]["applied"] is True


# --- the engine-attribute lane restarts the daemon too ----------------------


# Read straight off the fake daemon's adopted state rather than through
# ``/api/config``: the engine lane answers ``submitted`` and the app's own config
# view is not repopulated by the time the call returns, so the daemon's record of
# what it booted on is the only reading that is not a race.


def test_an_engine_override_still_lands_beside_the_stored_engine_attribute(
    http_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # folding a stored sibling attribute must not
    # cost the override the caller actually asked for (running cuda is 1)
    _active_preset_carrying(http_client, tmp_path / "presets", {"adaptive_volume": "1"})
    http_client.post("/api/engine", json={"overrides": {"cuda": "0"}})
    assert http_daemon["cuda"] == "0"


# --- the fold is invisible in the report ------------------------------------


FOLDED = {"mode": "pcm", "modulator": "3", "filter": "25"}

#: The restore rows ``FOLDED`` needs: the restore verify reads every folded
#: field back, and modulator is the one the fake does not re-read unasked.
FOLDED_ADOPTED = ADOPTED_BY_FIELD["modulator"]


def test_an_apply_that_folds_stored_settings_still_reports_applied(
    http_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    http_daemon["_adopts"] = FOLDED_ADOPTED
    _active_preset_carrying(http_client, tmp_path / "presets", FOLDED)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    report = http_client.post("/api/config/apply").json()["report"]
    assert report["persistent"]["applied"] is True


def test_an_apply_that_folds_stored_settings_converges_on_its_first_pass(
    http_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the fold changes what is pushed, never what the apply intends: the lane
    # must not read its own folded values back as divergence and re-apply to
    # correct them. `attempts` is the pass count the persistent report carries;
    # a clean apply with nothing to fold converges at 1, and folding must not
    # cost a second pass.
    http_daemon["_adopts"] = FOLDED_ADOPTED
    _active_preset_carrying(http_client, tmp_path / "presets", FOLDED)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    report = http_client.post("/api/config/apply").json()["report"]
    assert report["persistent"]["attempts"] == 1
