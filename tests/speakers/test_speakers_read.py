"""Speaker-processing read model (readme §1.9) parsed from the live /speakers
form. Behavior only, one assertion per test (docs/testing.md)."""

from pathlib import Path
from typing import Any

import pytest

from hqptuner.conf.httpconf import parse_speakers_form

_HTML = (Path(__file__).parent.parent / "support" / "fixtures" / "speakers-6.0.4.html").read_text()
_PARSED = parse_speakers_form(_HTML)

_FORM = '<form method="post">{}</form>'


def _speakers(*, enabled: str = "", level0: str = "0", dist0: str = "0") -> dict[str, Any]:
    """Parse a minimal one-channel speakers form with the given field values —
    the fixture is all-zero/disabled, so cases that need live values build here."""
    body = (
        "<h2>Speaker processing</h2>"
        f'<input type="checkbox" name="enabled" value="1"{enabled}/>'
        "<h2>Left</h2>"
        f'<h3>Level (dBFS)</h3><input type="number" name="level_0" value="{level0}" min="-60" max="0" step="0.1"/>'
        f'<h3>Distance (cm)</h3><input type="number" name="distance_0" value="{dist0}" min="0" max="5000"/>'
    )
    return parse_speakers_form(_FORM.format(body))


def test_disabled_switch_parses_false() -> None:
    assert _PARSED["enabled"] is False


def test_enabled_switch_parses_true() -> None:
    assert _speakers(enabled=" checked")["enabled"] is True


@pytest.mark.parametrize("index,name", [(0, "Left"), (2, "Center"), (3, "LFE")])
def test_channel_index_maps_to_daemon_name(index: int, name: str) -> None:
    assert _PARSED["channels"][index]["label"] == name


def test_channel_level_round_trips() -> None:
    assert _speakers(level0="-3")["channels"][0]["level"] == -3


def test_channel_distance_round_trips() -> None:
    assert _speakers(dist0="100")["channels"][0]["distance"] == 100
