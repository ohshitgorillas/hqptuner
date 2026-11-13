"""``GET /api/metadata`` serves a settings entry's recorded factory ``default``,
the engine option HQPlayer starts on, exactly as ``settings.json`` gave it.

The app loads a copy of the shared minimal metadata fixture whose
``settings.json`` is replaced with entries invented here, and the route serves
them with no daemon behind it.
"""

from __future__ import annotations

import json
import shutil
from typing import TYPE_CHECKING, Any

import pytest
from apps import closed_port
from conftest import METADATA_MIN
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

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
    data_dir = tmp_path / "metadata"
    shutil.copytree(METADATA_MIN, data_dir)
    (data_dir / "settings.json").write_text(json.dumps(SETTINGS), encoding="utf-8")
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=closed_port(), data_dir=data_dir)
    with TestClient(create_app(cfg, VirtualClock())) as client:
        table: dict[str, Any] = client.get("/api/metadata").json()["settings"]["dsp"]
    return table


@pytest.mark.parametrize("key", sorted(DEFAULTS))
def test_metadata_serves_each_settings_entrys_recorded_default_unchanged(served_dsp: dict[str, Any], key: str) -> None:
    assert served_dsp[key].get("default") == DEFAULTS[key]
