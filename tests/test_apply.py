"""apply_live orchestration: ordering, readback verification, and per-setting
outcome reporting against the stateful fake daemon (docs/testing.md)."""

from hqptuner.control import ControlClient
from hqptuner.writer import apply_live


async def test_successful_edit_reports_ok(live_client: ControlClient) -> None:
    report = await apply_live(live_client, {"shaper": {"value": "5"}})
    assert report[0]["ok"] is True


async def test_readback_mismatch_reports_failure(live_client: ControlClient) -> None:
    # value 999 = daemon answers OK but does not apply (protocol.md §6 caveat)
    report = await apply_live(live_client, {"shaper": {"value": "999"}})
    assert report[0]["ok"] is False


async def test_setter_error_reports_failure(live_client: ControlClient) -> None:
    report = await apply_live(live_client, {"shaper": {"value": "err"}})
    assert "error" in report[0]


async def test_mode_applied_before_rate(live_client: ControlClient) -> None:
    # SetMode resets rate to auto; a surviving rate proves mode ran first
    await apply_live(live_client, {"mode": {"value": "2"}, "rate": {"value": "5"}})
    assert (await live_client.get_state())["rate"] == "5"


async def test_one_failure_does_not_abort_the_rest(live_client: ControlClient) -> None:
    report = await apply_live(live_client, {"shaper": {"value": "err"}, "rate": {"value": "5"}})
    assert next(r for r in report if r["setting"] == "rate")["ok"] is True
