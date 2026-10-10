"""``GET /api/metadata`` serves a settings entry's ``more`` prose, the part of a
control's paragraph held behind "see more", exactly as ``settings.json`` gave it.

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

#: The short paragraph a control shows before "see more".
TOOLTIP = "invented short paragraph"

#: The rest of the paragraph, held behind "see more".
MORE = "invented longer paragraph held behind see more"

#: An entry carrying both halves of its paragraph.
WITH_MORE = "fixture-control-with-more"

#: An entry carrying only its short paragraph.
WITHOUT_MORE = "fixture-control-without-more"

SETTINGS = {
    "output": {
        WITH_MORE: {"tooltip": TOOLTIP, "more": MORE},
        WITHOUT_MORE: {"tooltip": TOOLTIP},
    }
}


@pytest.fixture
def served_output(tmp_path: Path) -> dict[str, Any]:
    """The ``settings.output`` table ``/api/metadata`` serves off ``SETTINGS``."""
    data_dir = tmp_path / "metadata"
    shutil.copytree(METADATA_MIN, data_dir)
    (data_dir / "settings.json").write_text(json.dumps(SETTINGS), encoding="utf-8")
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=closed_port(), data_dir=data_dir)
    with TestClient(create_app(cfg, VirtualClock())) as client:
        table: dict[str, Any] = client.get("/api/metadata").json()["settings"]["output"]
    return table


def test_metadata_serves_a_settings_entrys_more_prose_unchanged(served_output: dict[str, Any]) -> None:
    assert served_output[WITH_MORE].get("more") == MORE


def test_metadata_serves_a_settings_entry_without_more_with_no_more_field(served_output: dict[str, Any]) -> None:
    assert served_output[WITHOUT_MORE] == {"tooltip": TOOLTIP}
