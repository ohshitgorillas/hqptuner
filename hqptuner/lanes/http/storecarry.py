"""What the HTTP write lanes carry from the preset store, handed in by a caller above the lanes layer.

The store sits in ``presets``, above every lane, so a lane never reads it off the
manager. Its caller asks the store (``presets/presetfields``) and passes the
answers down in one of these.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable


@dataclass(frozen=True)
class StoreHooks:
    """What a staged restore (``restore.apply``) owes the preset store.

    ``carried`` answers once per apply: the live-domain values the restart has to
    come back on. The other three run on every pass. ``persist_backup`` gets that
    pass's fresh backup before the push, so a crash mid-apply leaves it on disk;
    ``parked_members`` are the parked filter uploads the archive carries; and
    ``mirror`` maps the pass's intended working config to the ``data/cfgs``
    members that bring hqplayerd's own profile list up to the store.
    """

    carried: Callable[[], dict[str, str]]
    persist_backup: Callable[[bytes], object]
    parked_members: Callable[[], dict[str, bytes]]
    mirror: Callable[[bytes], dict[str, bytes]]


@dataclass(frozen=True)
class StoreCarry:
    """What an engine-attribute restore (``engineattrs.apply``) carries from the preset store.

    ``carried`` is the live-domain values the restart has to come back on, and
    ``mirror`` the ``data/cfgs`` members that bring hqplayerd's own profile list up to the store.
    """

    carried: dict[str, str]
    mirror: dict[str, bytes]
