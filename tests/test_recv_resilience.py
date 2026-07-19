"""Control API receive resilience (docs/testing.md, through the faithful fake).

The daemon emits track <metadata> with unescaped characters during playback,
which strict XML parsing can't handle. The receiver must still deliver the
Status root attributes (active_filter/active_shaper/active_rate) rather than
blocking to timeout — otherwise the signal-path display goes blank mid-track.
"""

from hqptuner.control import ControlClient


async def test_get_status_recovers_root_when_metadata_is_malformed(
    garbled_metadata_client: ControlClient,
) -> None:
    status, _meta = await garbled_metadata_client.get_status()
    assert status["active_filter"] == "poly-sinc-gauss-long"
