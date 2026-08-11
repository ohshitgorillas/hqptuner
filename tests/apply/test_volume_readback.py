"""Volume is the one live setting verified with a TOLERANCE, not for equality.

The live lane sends `Volume` and reads `State` back (protocol.md §6). The level
is a double, so the readback is compared within 0.05 dB — a daemon that answers
-20.02 to a -20.0 write has applied it, and a comparison for equality would call
that a failure. Beyond the tolerance, and for a `State` frame carrying no volume
at all, the lane raises and `apply_live` reports the setting failed with the
level it wanted and the level it got.

Characterization of existing behavior (docs/testing.md §8 exemption): the daemons
here are `deaf_volume_client`, whose `Volume` answers OK without applying, so the
readback is whatever the case named."""

from fixtures_daemons import DeafVolumeClient

from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import apply_live


async def test_volume_read_back_exactly_applies(live_client: ControlClient) -> None:
    report = await apply_live(live_client, {"volume": {"value": "-20.0"}})
    assert report[0]["ok"] is True


async def test_volume_read_back_inside_the_tolerance_applies(deaf_volume_client: DeafVolumeClient) -> None:
    client = await deaf_volume_client("-20.02")  # 0.02 dB off the -20.0 asked for
    report = await apply_live(client, {"volume": {"value": "-20.0"}})
    assert report[0]["ok"] is True


async def test_volume_read_back_at_the_tolerance_boundary_applies(deaf_volume_client: DeafVolumeClient) -> None:
    # exactly 0.05 dB apart, and 0.05 is not "more than 0.05": still applied.
    # -0.05 against 0.0 keeps the difference exact in binary, so the boundary is
    # the boundary rather than a float artifact either side of it.
    client = await deaf_volume_client("0.0")
    report = await apply_live(client, {"volume": {"value": "-0.05"}})
    assert report[0]["ok"] is True


async def test_volume_read_back_beyond_the_tolerance_fails(deaf_volume_client: DeafVolumeClient) -> None:
    client = await deaf_volume_client("-14.0")
    report = await apply_live(client, {"volume": {"value": "-20.0"}})
    assert report[0]["ok"] is False


async def test_volume_mismatch_names_the_level_asked_for_and_the_one_reported(
    deaf_volume_client: DeafVolumeClient,
) -> None:
    client = await deaf_volume_client("-14.0")
    report = await apply_live(client, {"volume": {"value": "-20.0"}})
    assert report[0]["error"] == "Volume readback mismatch: want -20.0 got -14.0"


async def test_volume_absent_from_the_readback_fails_naming_it_none(deaf_volume_client: DeafVolumeClient) -> None:
    client = await deaf_volume_client(None)  # State frame with no volume attribute
    report = await apply_live(client, {"volume": {"value": "-20.0"}})
    assert report[0]["error"] == "Volume readback mismatch: want -20.0 got None"
