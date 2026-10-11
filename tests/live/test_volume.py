"""Live playback-volume lane (Control API 4321), through the faithful fake
daemon. Volume is a real-time write outside the staged-config
flow: a Volume command changes State.volume immediately, VolumeRange carries the
slider bounds + enabled flag, and a write is rejected when volume control is
disabled."""

import pytest

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import CommandError


async def test_set_volume_is_rejected_when_control_disabled(disabled_volume_client: ControlClient) -> None:
    with pytest.raises(CommandError):
        await disabled_volume_client.set_volume("-20.0")
