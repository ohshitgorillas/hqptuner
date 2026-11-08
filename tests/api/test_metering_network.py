"""The metering reader streams from the daemon through the network it is handed.

Policy: docs/testing.md. The 4322 fake is served only in process, at an address no socket answers on, so a reader
that ignored the opener it was handed would be refused and read nothing.
"""

import contextlib
import functools
from collections.abc import Iterator
from pathlib import Path

import fake_http
import fake_metering
import fake_network
import junkcal_rig
import pytest
from apps import METADATA_MIN, advance_app, advanced, app_manager, closed_port, log_in, wait_for_api
from fake_control import DEFAULTS, serve_shared
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine.metering import IDLE_RECHECK, MeteringReader
from hqptuner.engine.trackcontext import TrackContext

BINS = 1025
BANDWIDTH = 22050.0

#: Poll passes the app gets to fill the bars before a case reads them.
POLLS = 20

FRAME = junkcal_rig.frame(bins=BINS, bandwidth=BANDWIDTH)
PLAYING = TrackContext(playing=True, samplerate=None, sdm=False, junk_filter=None)


@contextlib.contextmanager
def _stream_port(*, served: bool) -> Iterator[int]:
    """A metering port with a stream in process behind it, or one with nothing behind it."""
    if not served:
        yield closed_port()
        return
    with fake_network.serving(functools.partial(fake_metering.serve, frame=FRAME, frames=10)) as port:
        yield port


@pytest.mark.parametrize("served", [True, False])
async def test_a_reader_handed_the_opener_reads_bands_where_a_stream_is_served(*, served: bool) -> None:
    clock = VirtualClock()
    with _stream_port(served=served) as port:
        reader = MeteringReader("127.0.0.1", port, lambda: PLAYING, pace=clock.pace, monotonic=clock.monotonic)
        reader.opener = fake_network.NETWORK.open_stream
        task = clock.spawn(reader.run())
        read = False
        for _ in range(POLLS):
            await advanced(clock, IDLE_RECHECK)
            read = bool(reader.bands())
            if read:
                break
        reader.stop()
        task.cancel()
        with contextlib.suppress(BaseException):
            await task
    assert read is served


@pytest.mark.parametrize("served", [True, False])
def test_an_app_handed_the_network_serves_the_bands_of_the_in_process_stream(tmp_path: Path, *, served: bool) -> None:
    daemon = fake_http.spawn(fake_http.state(), in_process=True)
    http = next(daemon)
    state = {**DEFAULTS, "state": "2"}
    with (
        _stream_port(served=served) as stream,
        fake_network.serving(functools.partial(serve_shared, state=state)) as control,
    ):
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=control,
            hqp_http_port=http["_port"],
            hqp_metering_port=stream,
            hqp_username="u",
            hqp_password="p",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
            advisor_enabled=True,
        )
        with TestClient(create_app(cfg, VirtualClock(), fake_network.NETWORK)) as client:
            log_in(client)
            wait_for_api(client, _status_served)
            bands = _served_bands(client)
    next(daemon, None)
    assert bool(bands) is served


def _status_served(client: TestClient) -> bool:
    """The app answers `/api/status`, whatever the reader has read so far."""
    status: int = client.get("/api/status").status_code
    return status == 200


def _served_bands(client: TestClient) -> list[float]:
    """The bars `/api/status` serves once the reader has filled them, or empty if it never does in ``POLLS`` passes."""
    interval = app_manager(client).cfg.poll_interval
    for _ in range(POLLS):
        bands: list[float] = client.get("/api/status").json()["data"]["bands"]
        if bands:
            return bands
        advance_app(client, interval)
    return []
