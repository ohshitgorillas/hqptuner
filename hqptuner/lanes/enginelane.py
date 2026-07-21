"""Write orchestration for the config-file-only engine attributes.

``engineconf`` holds the pure XML/zip editing; this module is the IO around it —
fetch a ``/backup`` archive, edit the ``<engine>`` tag of the right members, push
it through ``POST /restore``, and confirm by reading the attributes back after
the daemon's self-restart. Split out of ``manager`` because the connection
manager owns reachability and polling, not this lane's retry loop.

The hardware-acceleration attributes (``cuda``, ``multicore``, ``ecores``,
``nblocks``, ``cuda_dev``, ``cuda_cdev``) have no ``/config`` form field and no
Control API setter, so this is their only write path (manual §1.2). The restore
restarts the daemon and interrupts playback — the caller idle-gates, not this
module.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ..conf import engineconf
from ..conf.httpconf import HttpConfigClient

# readback attempts after the restore, spaced by `sleep`, before reporting the
# apply unconfirmed — the restore restart measured ~5.6 s on 6.0.4
_VERIFY_ATTEMPTS = 20
_VERIFY_INTERVAL = 0.5

Sleep = Callable[[float], Awaitable[None]]


async def verify(http: HttpConfigClient, overrides: dict[str, str], sleep: Sleep) -> dict[str, Any]:
    """Poll a fresh backup until every override is reflected in its base config's
    ``<engine>`` tag, or the attempts run out. Returns the last-read attributes
    either way, so a caller can report what actually landed."""
    got: dict[str, str] = {}
    for _ in range(_VERIFY_ATTEMPTS):
        await sleep(_VERIFY_INTERVAL)
        try:
            fresh = await http.backup()
        except httpx.HTTPError:
            continue
        if fresh[:4] != b"PK\x03\x04":  # mid-restart: not a zip yet
            continue
        got = engineconf.read_engine_attrs(engineconf.base_config_xml(fresh))
        if all(got.get(key) == want for key, want in overrides.items()):
            return {"applied": True, "engine": got}
    return {"applied": False, "engine": got}


async def apply(
    http: HttpConfigClient,
    backup: bytes,
    overrides: dict[str, str],
    active: str | None,
    all_presets: bool,
    sleep: Sleep,
) -> dict[str, Any]:
    """Edit ``overrides`` into ``backup``'s ``<engine>`` tags and restore it.

    ``all_presets`` edits every snapshot in the archive; otherwise just the base
    config plus the active preset's snapshot. Raises ``httpx.HTTPError`` if the
    restore itself fails; the caller decides how to report that."""
    members = engineconf.config_members(backup, active or None, all_presets)
    modified = engineconf.edit_config_zip(backup, members, overrides)
    await http.restore(modified, scope="system")
    verified = await verify(http, overrides, sleep)
    return {"submitted": True, "verified": verified, "members": members, "backup_bytes": len(backup)}
