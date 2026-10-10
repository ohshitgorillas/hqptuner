"""Connect and poll: the two bodies that refill ``core/readings`` from the wire.

Only the supervisor loop in ``core/manager`` calls these. ``connect_and_load`` is
what "reachable" and "ready" mean; ``poll`` is the heartbeat that keeps the last
snapshot current between connects.
"""

import contextlib
import logging
import time
import zipfile
from typing import TYPE_CHECKING

import httpx

from hqptuner import voltrace
from hqptuner.core import engineread
from hqptuner.engine import release
from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import CommandError, ControlError
from hqptuner.lanes.http import forms
from hqptuner.lanes.live import chain, lane
from hqptuner.presets import fileconfig
from hqptuner.presets.store.presets import PresetError

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)


def _held_state(fresh: dict[str, str] | None, held: dict[str, str] | None) -> dict[str, str] | None:
    """Return the State reading to hold: ``fresh``, or ``held`` when the read was refused and gave none."""
    return fresh if fresh is not None else held


async def connect_and_load(mgr: "ConnectionManager") -> None:
    """Open the 4321 lane, take the handshake, and refill every reading from scratch.

    ``reachable`` is published as soon as the handshake answers; ``ready`` turns true only
    once this body has run to its end and the 8088 configuration lane answered inside it.
    """
    cfg = mgr.cfg
    client = ControlClient(cfg.hqp_host, cfg.hqp_control_port, cfg.request_timeout, deadline=mgr.clock)
    await client.connect()
    try:
        info = await _handshake(mgr, client)
    except BaseException:
        # until the handshake attaches it, no `_drop` owns this client, so a failed one closes here
        await client.close()
        raise
    # best-effort and credential-free: /about is not gated, and reachability is
    # already decided above, so a failed lookup here leaves the release blank
    # rather than failing the connect.
    mgr.readings.release = ""
    try:
        mgr.readings.release = release.parse_release(await release.fetch_about(mgr.http_base_url))
    except httpx.HTTPError as exc:
        log.debug("release lookup failed: %s", exc)
    if mgr.http_client is not None:
        await _load_http_lane(mgr)
    # Last statements on purpose: the connect body has run to its end. `ready` is read
    # off this pair, the connect standing and the 8088 lane having answered, so an
    # install whose configuration lane is refused or absent reports itself unready
    # rather than ready on the handshake alone.
    stamp_http_ok(mgr)
    # Both written before `connects`, which is the counter a post-restore wait tests
    # first: once it sees this connect, `http_ok` and `drops_at_connect` already
    # describe THIS connect and not the one before it.
    mgr.drops_at_connect = mgr.drops
    mgr.connects += 1
    mgr.connected.set()
    mgr.changed.set()
    log.info("connected: %s engine %s", info.get("name"), info.get("engine") or info.get("version"))


async def _handshake(mgr: "ConnectionManager", client: ControlClient) -> dict[str, str]:
    """Take the GetInfo handshake and the 4321 readings, attach the client, and publish ``reachable``."""
    info = await client.get_info()  # the handshake — this defines "reachable"
    license_info = await client.get_license()  # static; licensee + valid flag
    active_config = await client.get_active_config()  # active preset name
    state = await client.state_unless_refused()  # refused: unknown, never a reading from before this connect
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


def stamp_http_ok(mgr: "ConnectionManager") -> None:
    """Record whether the 8088 configuration lane just answered.

    Called at the end of each of the two lifecycle refreshes, the connect body's and
    the poll's, and nowhere else: ``forms.refresh`` has off-lifecycle callers that run
    mid-apply, and a stamp inside it would report the app unready while a write is in
    flight. ``/config`` is the lane's own verdict — ``config_error`` is None only when it
    answered and parsed, and an install with no client never asks at all.
    """
    mgr.readings.http_ok = mgr.http_client is not None and mgr.readings.config_error is None


async def _load_http_lane(mgr: "ConnectionManager") -> None:
    """Fill the 8088 half of a connect: forms, device capability, file config, preset migration.

    Best-effort throughout — a failure here must not undo the 4321 connect.

    The forms are refreshed without ``refresh_http_forms``, whose own unforced capability read would
    fetch the whole log a second time ahead of the forced one a connect owes. The settings archive is
    fetched once and handed to both readers of it.
    """
    # forms.refresh populates config/matrix/speakers (+ their *_error).
    await forms.refresh(mgr)
    await engineread.refresh_device_caps(mgr, force=True)
    backup: bytes | None = None
    try:
        backup = await mgr.require_http().backup()
        await fileconfig.load_file_config(mgr, backup=backup)
    except (httpx.HTTPError, ControlError) as exc:
        # the form still carries every field; only the lossy ones degrade.
        # A corrupt archive is not in this set on purpose: engineconf.base_config_xml
        # raises UnreadableArchiveError on unreadable bytes, caught inside the load.
        log.warning("file-config read failed: %s", exc)
    try:
        # an archive the read above could not fetch is fetched again here, as the migration always did
        await mgr.presetops.migrate_once(mgr.readings.active_config, backup=backup)
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
    client = mgr.require_control()
    readings = mgr.readings
    # Taken from the previous tick's readings before State is read: they are the
    # trace's memory for the volume comparison, so a volume that is not moving
    # writes nothing at all, and the chain the engine had loaded is the one the
    # chain-entered check compares against.
    known = readings.state is not None
    previous = readings.state or {}
    before = chain.active_chain(mgr)
    state = _held_state(await client.state_unless_refused(), readings.state)
    current = state or {}
    # Stored before any further await: a live write that lands while this tick
    # waits on the engine stores its own read-back State, which a later
    # assignment of this earlier read would overwrite.
    readings.state = state
    voltrace.observe_change(mgr, "state", {"volume": current.get("volume")}, {"volume": previous.get("volume")})
    # A mode switch swaps the lists wholesale (architecture §3.3), and playback
    # state moves the rate list: what fills that one is the transport as well
    # as the mode (manual p.18 §4.4), so an idle network backend answers
    # GetRates with auto alone where the same daemon serves thirteen PCM tiers
    # once asked again (verified live on 6.0.4) — and the page grayed every tier.
    moved = known and any(current.get(a) != previous.get(a) for a in ("mode", "state"))
    if moved:
        log.info("engine moved (mode %s, state %s), re-enumerating", current.get("mode"), current.get("state"))
        readings.enums = await client.get_all_enumerations()
    readings.status, readings.status_metadata = await client.get_status()
    # The re-assert is a live-setter batch like any other: its State readback
    # verifies its own SetFilter only while no other batch's write lands first.
    async with mgr.live_writes:
        await lane.chain_entered(mgr, client, before, reenumerated=moved)
    readings.volume_range = await client.get_volume_range()
    with contextlib.suppress(CommandError):  # profile saves/deletes land without an apply
        readings.matrix_profiles = await client.get_matrix_profiles()
    # external changes (preset loads, the DAC changing, HQPlayer's own UI)
    # rewrite the http forms without any HQPTuner apply — refetch each poll so
    # the config/matrix snapshots track reality instead of only connect-time.
    await mgr.refresh_http_forms()
    stamp_http_ok(mgr)
    # The 8088 lane can come back a poll after the control lane did, and a wait for both
    # lanes sleeps on `changed`. Without an edge here that wait would be satisfied in
    # fact and slept through to its deadline.
    mgr.changed.set()
    readings.loaded_at = time.time()


async def poll_status(mgr: "ConnectionManager") -> None:
    """Read Status alone between heartbeats: store it as the heartbeat does, and raise the same edge.

    In ``[source]`` mode Status is what says which chain the engine has loaded, so this read can be the first to
    see the chain change. It handles the change exactly as the heartbeat would: the chain taken before the store is
    the baseline, and once this read has stored the new Status the heartbeat's own baseline already names the new
    chain and would see no change left to handle.
    """
    client = mgr.require_control()
    readings = mgr.readings
    before = chain.active_chain(mgr)
    readings.status, readings.status_metadata = await client.get_status()
    async with mgr.live_writes:
        await lane.chain_entered(mgr, client, before, reenumerated=False)
    mgr.changed.set()
