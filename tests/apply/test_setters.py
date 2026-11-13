"""Typed Control API setters and readback verification against the stateful
fake daemon."""

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import CommandError


async def test_volume_setter_applies(live_client: ControlClient) -> None:
    await live_client.set_volume("-20.5")
    assert (await live_client.get_state())["volume"] == "-20.5"


async def test_verify_state_passes_on_match(live_client: ControlClient) -> None:
    await live_client.set_command("SetMode", value="2")
    # verify_state returns nothing, so "passed" is only observable as the absence
    # of the CommandError the mismatch case raises.
    outcome = "raised"
    try:
        await live_client.verify_state({"mode": "2"})
        outcome = "returned"
    except CommandError:
        pass
    assert outcome == "returned"
