"""Connect and poll: the two bodies that refill ``core/readings`` from the wire.

Only the supervisor loop in ``core/manager`` calls these. ``connect_and_load`` is
what "reachable" and "ready" mean; ``poll`` is the heartbeat that keeps the last
snapshot current between connects.
"""

import contextlib
import logging
import time
import zipfile
from typing import TYPE_CHECKING, Any

import httpx

from hqptuner.core import engineread
from hqptuner.engine import release
from hqptuner.engine.control import CommandError, ControlClient, ControlError
from hqptuner.lanes.live import chain, lane
from hqptuner.presets import fileconfig
from hqptuner.presets.store.presets import PresetError

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)


async def connect_and_load(mgr: "ConnectionManager") -> None:
    """Open the 4321 lane, take the handshake, and refill every reading from scratch.

    ``reachable`` is published as soon as the handshake answers; ``ready`` only once this
    body has run to its end, 8088 half included where credentials exist.
    """
    cfg = mgr.cfg
    client = ControlClient(cfg.hqp_host, cfg.hqp_control_port, cfg.request_timeout)
    await client.connect()
    info = await _handshake(mgr, client)
    # best-effort and credential-free: /about is not gated, and fetch_release
    # answers any failure with "" — reachability is already decided above.
    mgr.readings.release = await release.fetch_release(mgr.http_base_url)
    if mgr.http_client is not None:
        await _load_http_lane(mgr)
    # Last statement on purpose: `ready` means this body ran to its end. An install
    # with no credentials has no 8088 lane to wait for and arrives here just the same
    # (architecture §"Authentication"), so it is ready as soon as the handshake is.
    mgr.ready = True
    mgr.connects += 1
    mgr.connected.set()
    log.info("connected: %s engine %s", info.get("name"), info.get("engine") or info.get("version"))


async def _handshake(mgr: "ConnectionManager", client: ControlClient) -> dict[str, Any]:
    """Take the GetInfo handshake and the 4321 readings, attach the client, and publish ``reachable``."""
    info = await client.get_info()  # the handshake — this defines "reachable"
    license_info = await client.get_license()  # static; licensee + valid flag
    active_config = await client.get_active_config()  # active preset name
    state = await client.get_state()
    status, meta = await client.get_status()
    vrange = await client.get_volume_range()
    enums = await client.get_all_enumerations()
    matrix_profiles: list[str] | None = None
    with contextlib.suppress(CommandError):  # older engines may not speak Matrix*
        matrix_profiles = await client.get_matrix_profiles()

    mgr.control = client
    readings = mgr.readings
    readings.info, readings.state, readings.status, readings.status_metadata = info, state, status, meta
    readings.license = license_info
    readings.active_config = active_config
    readings.volume_range = vrange
    readings.enums = enums
    readings.matrix_profiles = matrix_profiles
    readings.live.forget()
    readings.loaded_at = time.time()
    mgr.reachable = True
    mgr.unreachable_since = None
    return info


async def _load_http_lane(mgr: "ConnectionManager") -> None:
    """Fill the 8088 half of a connect: forms, device capability, file config, preset migration.

    Best-effort throughout — a failure here must not undo the 4321 connect.
    """
    # refresh_http_forms populates config/matrix/speakers (+ their *_error).
    await mgr.refresh_http_forms()
    await engineread.refresh_device_caps(mgr, force=True)
    try:
        await fileconfig.load_file_config(mgr)
    except (httpx.HTTPError, ControlError) as exc:
        # the form still carries every field; only the lossy ones degrade.
        # A corrupt archive is not in this set on purpose: engineconf.base_config_xml
        # already answers unreadable bytes with b"", so BadZipFile cannot arrive here.
        log.warning("file-config read failed: %s", exc)
    try:
        await mgr.presetops.migrate_once(mgr.readings.active_config)
    except (httpx.HTTPError, PresetError, OSError, zipfile.BadZipFile) as exc:
        # the daemon's own snapshots stay unimported; the store keeps whatever it had.
        # BadZipFile belongs here and not above: presetzip.snapshot_members opens the
        # archive itself, with no empty-bytes fallback under it.
        log.warning("preset migration skipped: %s", exc)


async def poll(mgr: "ConnectionManager") -> None:
    """Take one heartbeat: refresh State, Status, the volume range, the profiles and the 8088 forms.

    Re-enumerates when the engine's mode or transport state moved, because either swaps
    the lists every later write resolves its indices against.
    """
    client = mgr.control
    if client is None:
        raise ControlError("not connected")
    state = await client.get_state()
    # A mode switch swaps the lists wholesale (architecture §5), and playback
    # state moves the rate list: what fills that one is the transport as well
    # as the mode (manual p.18 §4.4), so an idle network backend answers
    # GetRates with auto alone where the same daemon serves thirteen PCM tiers
    # once asked again (verified live on 6.0.4) — and the page grayed every tier.
    readings = mgr.readings
    previous = readings.state or {}
    moved = readings.state is not None and any(state.get(a) != previous.get(a) for a in ("mode", "state"))
    if moved:
        log.info("engine moved (mode %s, state %s), re-enumerating", state.get("mode"), state.get("state"))
        readings.enums = await client.get_all_enumerations()
    status, meta = await client.get_status()
    before = chain.active_chain(mgr)
    readings.state, readings.status, readings.status_metadata = state, status, meta
    await lane.chain_entered(mgr, client, before, reenumerated=moved)
    readings.volume_range = await client.get_volume_range()
    with contextlib.suppress(CommandError):  # profile saves/deletes land without an apply
        readings.matrix_profiles = await client.get_matrix_profiles()
    # external changes (preset loads, the DAC changing, HQPlayer's own UI)
    # rewrite the http forms without any HQPTuner apply — refetch each poll so
    # the config/matrix snapshots track reality instead of only connect-time.
    await mgr.refresh_http_forms()
    readings.loaded_at = time.time()
