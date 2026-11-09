"""A start probes the container-host alias only inside the HQPTuner image (docs/testing.md).

The alias name resolves nowhere else, and a lookup of it from a laptop or a bare-metal host is a request to whatever
a network's resolver makes of it. The image says it is the image through one variable in its ``ENV`` block, read as
``Config.in_image``; a start with no saved host asks the alias only where that is on. The alias is a counting fake on
the in-process network, so the count is of dials made to it.
"""

import asyncio
import dataclasses
import functools
from pathlib import Path

import fake_network
import pytest
from apps import METADATA_MIN
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

ALIAS_HOST = "127.0.0.3"


async def _count_dial(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, dials: list[None]) -> None:
    """Stream fake that answers nothing and records that it was dialed."""
    dials.append(None)
    writer.close()
    await writer.wait_closed()


def _config(tmp_path: Path, control_port: int) -> Config:
    """A config with no host chosen anywhere, whose alias is the counting fake's address."""
    return Config(
        metering_enabled=False,
        data_dir=METADATA_MIN,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
        connection_file=tmp_path / "connection.json",
        hqp_control_port=control_port,
        container_host_alias=ALIAS_HOST,
    )


def _start_asks_alias(tmp_path: Path, *, marked: bool | None) -> bool:
    """Whether a start with no record and no pinned host dials the alias; ``marked`` None leaves the marker alone."""
    dials: list[None] = []
    with fake_network.serving(functools.partial(_count_dial, dials=dials), host=ALIAS_HOST) as control:
        cfg = _config(tmp_path, control)
        if marked is not None:
            cfg = dataclasses.replace(cfg, in_image=marked)
        with TestClient(create_app(cfg, VirtualClock(), fake_network.NETWORK)):
            pass
    return bool(dials)


@pytest.mark.parametrize(("marked", "asked"), [(None, False), (True, True)], ids=["outside-the-image", "in-the-image"])
def test_a_start_dials_the_alias_only_in_the_image(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, marked: bool | None, asked: bool
) -> None:
    monkeypatch.delenv("HQPTUNER_HQP_HOST", raising=False)
    monkeypatch.delenv("HQPTUNER_IN_IMAGE", raising=False)
    assert _start_asks_alias(tmp_path, marked=marked) is asked


def test_the_marker_is_read_from_the_variable_the_image_sets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HQPTUNER_IN_IMAGE", "1")
    assert Config().in_image is True
