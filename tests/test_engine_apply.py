"""Behavior of the hardware-accel engine write path (backup → edit → restore),
verified through the manager's public API against the faithful fake daemon. The
four engine attributes are file-only (no /config field, no live setter), so the
observable contract is: after an apply, a fresh read reflects the new value and
unrelated engine settings survive."""

import io
import zipfile
from pathlib import Path
from typing import Any

import pytest

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.manager import ConnectionManager


@pytest.fixture
async def engine_manager(http_daemon: dict[str, Any], tmp_path: Path) -> Any:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    mgr = ConnectionManager(Config(hqp_host="127.0.0.1", backup_dir=tmp_path), http_client=http)
    yield mgr
    await http.aclose()


def _archive_with_nblocks(value: str) -> bytes:
    xml = f'<config><engine cuda="1" multicore="1" nblocks="{value}"/></config>'.encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("hqplayerd.xml", xml)
    return out.getvalue()


async def test_applied_engine_attribute_is_reflected_in_readback(engine_manager: ConnectionManager) -> None:
    await engine_manager.apply_engine({"cuda": "convolution"})
    assert (await engine_manager.read_engine())["cuda"] == "convolution"


async def test_apply_engine_preserves_unrelated_attribute(engine_manager: ConnectionManager) -> None:
    await engine_manager.apply_engine({"cuda": "0"})
    assert (await engine_manager.read_engine())["multicore"] == "1"


async def test_apply_engine_rejects_out_of_domain_value(engine_manager: ConnectionManager) -> None:
    with pytest.raises(ValueError, match="not in"):
        await engine_manager.apply_engine({"cuda": "maybe"})


async def test_applied_cuda_device_id_is_reflected_in_readback(engine_manager: ConnectionManager) -> None:
    await engine_manager.apply_engine({"cuda_dev": "1"})
    assert (await engine_manager.read_engine())["cuda_dev"] == "1"


async def test_apply_engine_rejects_non_integer_device_id(engine_manager: ConnectionManager) -> None:
    with pytest.raises(ValueError, match="must be an integer"):
        await engine_manager.apply_engine({"cuda_dev": "auto"})


async def test_restored_archive_is_reflected_in_readback(engine_manager: ConnectionManager) -> None:
    await engine_manager.restore_config(_archive_with_nblocks("4"))
    assert (await engine_manager.read_engine())["nblocks"] == "4"
