"""The settings backup and restore flows: the daemon's archive carrying this install's profile descriptions.

A backup is the daemon's own ``/backup`` archive with the description store riding along as one extra member
(``presetzip.DESCRIPTIONS_MEMBER``). A restore takes that member back out, folds it into the store, and hands the
daemon everything else exactly as it was uploaded. Wire and lane errors propagate for the caller to report.
"""

import logging
from typing import TYPE_CHECKING

from hqptuner.conf import presetzip
from hqptuner.lanes import settle
from hqptuner.presets.store.descriptions import DescriptionError, DescriptionStore

if TYPE_CHECKING:
    from hqptuner.presets import PresetManager

log = logging.getLogger(__name__)


async def backup(mgr: "PresetManager", store: DescriptionStore) -> bytes:
    """Return the daemon's settings archive with the store's descriptions embedded.

    Every daemon member is copied byte-for-byte, so the archive still restores anywhere; a store with nothing in it
    adds no member. ``httpx.HTTPError`` and ``ControlError`` from the fetch propagate.
    """
    data = await mgr.presetops.backup()
    try:
        data = presetzip.embed_descriptions(data, store.export_bytes())
    except DescriptionError as exc:
        # An unreadable store is not a reason to withhold the daemon's own backup.
        log.warning("descriptions not carried in backup: %s", exc)
    return data


def split_upload(upload: bytes) -> tuple[bytes, bytes | None]:
    """Return what a restore hands the daemon, and the descriptions member it carried or None.

    A bare XML upload is not an archive and carries no descriptions: checked, not caught. An archive whose members
    cannot be read raises ``UnreadableArchiveError``.
    """
    if not presetzip.is_archive(upload):
        return upload, None
    return presetzip.take_descriptions(upload)


async def restore(mgr: "PresetManager", store: DescriptionStore, upload: bytes) -> int:
    """Push an uploaded settings archive to the daemon and wait for it to come back; return the bytes pushed.

    The carried descriptions member is merged into ``store`` and never handed to hqplayerd. The daemon self-restarts
    on the push, so this returns only once both lanes are back, or the alarm window has passed.
    ``UnreadableArchiveError`` from the split, and ``httpx.HTTPError`` and ``ControlError`` from the push, propagate.
    """
    data, carried = split_upload(upload)
    if carried is not None:
        try:
            store.merge(carried)
        except DescriptionError as exc:
            # A restore is about the daemon's config; descriptions we cannot read are a note in the log, not a
            # refusal of the user's restore.
            log.warning("carried descriptions not restored: %s", exc)
    mark = await settle.restart(mgr, lambda: mgr.require_http().restore(data))
    # The restore restarted the daemon under us. Returning here would report a restore done while both lanes are
    # still down, and the page would read Unreachable a moment after being told it succeeded.
    await settle.await_ready(mgr, mark)
    return len(data)
