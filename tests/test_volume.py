"""Live playback-volume lane (Control API 4321), through the faithful fake
daemon (docs/testing.md). Volume is a real-time write outside the staged-config
flow: a Volume command changes State.volume immediately, VolumeRange carries the
slider bounds + enabled flag, and a write is rejected when volume control is
disabled."""

import pytest

from hqptuner.engine.control import CommandError, ControlClient


async def test_volume_range_reports_control_enabled(live_client: ControlClient) -> None:
    vr = await live_client.get_volume_range()
    assert vr["enabled"] == "1"


async def test_volume_range_reports_upper_bound(live_client: ControlClient) -> None:
    vr = await live_client.get_volume_range()
    assert vr["max"] == "0"


async def test_set_volume_is_reflected_in_state(live_client: ControlClient) -> None:
    await live_client.set_volume("-20.0")
    assert (await live_client.get_state())["volume"] == "-20.0"


async def test_set_volume_is_rejected_when_control_disabled(disabled_volume_client: ControlClient) -> None:
    with pytest.raises(CommandError):
        await disabled_volume_client.set_volume("-20.0")
