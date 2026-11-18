"""``GET /api/metadata`` serves a settings entry's recorded factory ``default``,
the engine option HQPlayer starts on, exactly as ``settings.json`` gave it.

The app loads a copy of the shared minimal metadata fixture whose
``settings.json`` is replaced with entries invented here, and the route serves
them with no daemon behind it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from apps import served_settings

if TYPE_CHECKING:
    from pathlib import Path

#: Two settings, each recording a different invented engine option as its default.
DEFAULTS = {
    "fixture-filter-setting": "fixture-default-filter",
    "fixture-shaper-setting": "fixture-default-modulator",
}

SETTINGS = {
    "dsp": {
        key: {
            "label": f"invented label for {key}",
            "tooltip": "invented tooltip",
            "source": "hqptuner",
            "default": option,
        }
        for key, option in DEFAULTS.items()
    }
}


@pytest.fixture
def served_dsp(tmp_path: Path) -> dict[str, Any]:
    """The ``settings.dsp`` table ``/api/metadata`` serves off ``SETTINGS``."""
    return served_settings(tmp_path, SETTINGS, "dsp")


@pytest.mark.parametrize("key", sorted(DEFAULTS))
def test_metadata_serves_each_settings_entrys_recorded_default_unchanged(served_dsp: dict[str, Any], key: str) -> None:
    assert served_dsp[key].get("default") == DEFAULTS[key]
