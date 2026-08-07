"""Typed Control API setters and readback verification against the stateful
fake daemon (docs/testing.md — behavior via public API, one assertion each)."""

import pytest

from hqptuner.engine.control import CommandError, ControlClient


async def test_filter_value_alone_sets_both_1x_and_nx(live_client: ControlClient) -> None:
    await live_client.set_filter("6")
    assert (await live_client.get_state())["filter1x"] == "6"


async def test_filter_value1x_splits_the_two(live_client: ControlClient) -> None:
    await live_client.set_filter("6", "3")
    assert (await live_client.get_state())["filter1x"] == "3"


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


async def test_verify_state_raises_on_mismatch(live_client: ControlClient) -> None:
    with pytest.raises(CommandError, match="mismatch"):
        await live_client.verify_state({"mode": "9"})
