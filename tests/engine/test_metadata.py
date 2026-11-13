"""Coverage of ``metadata.py``'s two public producers: ``StaticMetadata.raw`` and
``merge_enumerations``.

Each test reads one field under ``StaticDb``/``MergedEnums`` by key off the value the public
producer returned, on data invented for this fixture. ``merge_enumerations`` is asked of one
Engine view, built from an Engine reading the test writes itself.
"""

from __future__ import annotations

import json
import shutil
from typing import TYPE_CHECKING

from answered_reading import Answered
from conftest import METADATA_MIN as FIXTURE_DIR

from hqptuner.engine.view import EngineView
from hqptuner.metadata import StaticMetadata, merge_enumerations

if TYPE_CHECKING:
    from pathlib import Path

#: The one junk filter the invented Engine reading lists.
JUNK_FILTERS = [{"index": "0", "name": "none"}]


def _dir_with_settings(tmp_path: Path, settings: dict[str, object]) -> Path:
    """Copy the shared minimal fixture, then replace its (empty) ``settings.json`` with ``settings``."""
    target = tmp_path / "metadata"
    shutil.copytree(FIXTURE_DIR, target)
    (target / "settings.json").write_text(json.dumps(settings), encoding="utf-8")
    return target


def test_raw_serves_the_sdm_modulators_overlay_by_name() -> None:
    entry = StaticMetadata(FIXTURE_DIR).raw.shapers.sdm_modulators["fixture-sdm-mod"]
    assert entry["min_rate_hz"] == 2822400


def test_raw_serves_the_pcm_dithers_overlay_by_name() -> None:
    entry = StaticMetadata(FIXTURE_DIR).raw.shapers.pcm_dithers["fixture-pcm-dither"]
    assert entry["min_rate_hz"] == 44100


def test_raw_serves_the_easy_mode_database_verbatim(tmp_path: Path) -> None:
    target = tmp_path / "metadata"
    shutil.copytree(FIXTURE_DIR, target)
    (target / "easy-presets.json").write_text(json.dumps({"fixture-preset": {"emoji": "x"}}), encoding="utf-8")
    assert StaticMetadata(target).raw.easy == {"fixture-preset": {"emoji": "x"}}


def test_raw_serves_the_settings_dsp_table(tmp_path: Path) -> None:
    target = _dir_with_settings(tmp_path, {"dsp": {"apodizing": {"tooltip": "invented dsp prose"}}})
    assert StaticMetadata(target).raw.settings.dsp["apodizing"]["tooltip"] == "invented dsp prose"


def test_raw_serves_the_settings_system_table(tmp_path: Path) -> None:
    target = _dir_with_settings(tmp_path, {"system": {"buffer": {"tooltip": "invented system prose"}}})
    assert StaticMetadata(target).raw.settings.system["buffer"]["tooltip"] == "invented system prose"


def test_merge_enumerations_serves_the_junk_filters_list_of_the_engine_view_it_is_asked() -> None:
    static = StaticMetadata(FIXTURE_DIR)
    view = EngineView.of(Answered(None, None, {"junk_filters": JUNK_FILTERS}, None))
    assert merge_enumerations(view, static, "PCM").junk_filters == JUNK_FILTERS
