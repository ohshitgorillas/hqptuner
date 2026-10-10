"""apply_live orchestration: ordering, readback verification, and per-setting
outcome reporting against the stateful fake daemon."""

from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import LiveWriteFailed, LiveWriteOutcome, apply_live


async def test_successful_edit_reports_ok(live_client: ControlClient) -> None:
    report = await apply_live(live_client, {"shaper": {"value": "5"}})
    assert report[0].outcome is LiveWriteOutcome.OK


async def test_readback_mismatch_reports_failure(live_client: ControlClient) -> None:
    # value 999 = daemon answers OK but does not apply
    report = await apply_live(live_client, {"shaper": {"value": "999"}})
    assert report[0].outcome is LiveWriteOutcome.FAILED


async def test_setter_error_reports_failure(live_client: ControlClient) -> None:
    report = await apply_live(live_client, {"shaper": {"value": "err"}})
    assert isinstance(report[0], LiveWriteFailed)
    assert report[0].code == "daemon_refused"


async def test_one_failure_does_not_abort_the_rest(live_client: ControlClient) -> None:
    report = await apply_live(live_client, {"shaper": {"value": "err"}, "junk_filter": {"value": "1"}})
    assert next(r for r in report if r.setting == "junk_filter").outcome is LiveWriteOutcome.OK
