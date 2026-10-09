"""Behavior of the hardware-accel engine write path (backup → edit → restore),
verified through the manager's public API against the faithful fake daemon. The
four engine attributes are file-only (no /config field, no live setter), so the
observable contract is: after an apply, a fresh read reflects the new value and
unrelated engine settings survive."""

import io
import zipfile
from typing import Any

import pytest
from conftest import LiveManager

from hqptuner.conf.httpauth import HttpLaneDeclinedError
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import forms
from hqptuner.presets import fileconfig


def _archive_with_nblocks(value: str) -> bytes:
    xml = f'<config><engine cuda="1" multicore="1" nblocks="{value}"/></config>'.encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("hqplayerd.xml", xml)
    return out.getvalue()


async def test_applied_engine_attribute_is_reflected_in_readback(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply_engine({"cuda": "convolution"})
    assert (await fileconfig.read_engine(http_manager))["cuda"] == "convolution"


#: A named HQPlayer configuration the daemon is running on instead of [default].
NAMED_PROFILE = "Speakers"


async def test_applied_engine_attribute_is_reflected_in_readback_with_a_named_profile_active(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_active_profile"] = NAMED_PROFILE
    await http_manager.applyops.apply_engine({"cuda": "convolution"})
    assert (await fileconfig.read_engine(http_manager))["cuda"] == "convolution"


async def test_apply_engine_preserves_unrelated_attribute(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply_engine({"cuda": "0"})
    assert (await fileconfig.read_engine(http_manager))["multicore"] == "1"


async def test_applied_cuda_device_id_is_reflected_in_readback(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply_engine({"cuda_dev": "1"})
    assert (await fileconfig.read_engine(http_manager))["cuda_dev"] == "1"


async def test_restored_archive_is_reflected_in_readback(http_manager: ConnectionManager) -> None:
    await http_manager.require_http().restore(_archive_with_nblocks("4"))
    assert (await fileconfig.read_engine(http_manager))["nblocks"] == "4"


@pytest.fixture(params=[("refused credential", "no_credentials"), ("no http lane", "no_http_client")], ids=str)
async def declining(
    request: pytest.FixtureRequest,
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    live_manager: LiveManager,
) -> tuple[ConnectionManager, str]:
    """A manager whose http lane cannot be used, and the code its decline carries.

    The refused credential is earned off the wire: the fake 8088 rejects the pair and a forms refresh records what it
    answered. The other manager is built on the control lane alone.
    """
    case, code = request.param
    if case == "refused credential":
        http_daemon["_refuse_auth"] = True
        await forms.refresh(http_manager)
        return http_manager, code
    control_only, _log, _state = await live_manager()
    return control_only, code


async def test_apply_engine_decline_carries_the_code_of_its_cause(declining: tuple[ConnectionManager, str]) -> None:
    manager, code = declining
    with pytest.raises(HttpLaneDeclinedError) as declined:
        await manager.applyops.apply_engine({"cuda": "0"})
    assert declined.value.code == code
