"""``GET /api/metadata`` serves a settings entry's ``more`` prose, the part of a
control's paragraph held behind "see more", exactly as ``settings.json`` gave it.

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
    return served_settings(tmp_path, SETTINGS, "output")


def test_metadata_serves_a_settings_entrys_more_prose_unchanged(served_output: dict[str, Any]) -> None:
    assert served_output[WITH_MORE].get("more") == MORE
