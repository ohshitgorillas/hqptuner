"""Typed Control API setters and readback verification against the stateful
fake daemon (docs/testing.md — behavior via public API, one assertion each)."""

import pytest

from hqptuner.control import CommandError, ControlClient


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
    await live_client.set_mode("2")
    assert await live_client.verify_state({"mode": "2"}) is None


async def test_verify_state_raises_on_mismatch(live_client: ControlClient) -> None:
    with pytest.raises(CommandError, match="mismatch"):
        await live_client.verify_state({"mode": "9"})
