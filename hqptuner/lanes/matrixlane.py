"""Matrix profile operations — the lane behind ``POST /api/matrix/profile``.

One lane, and it is the live one: 4321 ``MatrixSetProfile`` switches the running
matrix with zero engine reload and playback undisturbed. A profile is a whole
matrix context, ``<post_process>`` included (readme §1.11.2), so the switch
installs the profile's own plugin chain along with its rows. Nothing here writes
config. Saving and deleting a profile are staged
``<matrix_profile>`` edits carried by the persistent restore lane instead
because hqplayerd never persists a profile of its own
accord — its ``/matrix/save`` registers a name in memory and the config it
writes in the same breath omits the element.

The form lane (``POST /matrix/{load,save,delete}``) plays no part in profile
work: it costs a ~3 s engine reload per op, and its ``load`` replaces the whole
matrix context with the profile's — crossfeed / DAC correction / loudness
cleared where the profile carries none — forcing a snapshot-and-reapply of
post-process.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager


@dataclass(frozen=True)
class MatrixProfileSwitch:
    """A live matrix-profile switch's readback: the profile now active."""

    active: str


async def switch_profile(mgr: ConnectionManager, name: str) -> MatrixProfileSwitch:
    """Live switch + State readback + form resync. Empty name = ``[Default]``."""
    client = mgr.require_control()
    await client.set_matrix_profile(name)
    mgr.readings.state = await client.get_state()
    await mgr.refresh_http_forms()
    return MatrixProfileSwitch(active=mgr.readings.state.get("matrix_profile", ""))
