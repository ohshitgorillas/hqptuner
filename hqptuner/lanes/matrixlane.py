"""Matrix profile operations (matrix-spec.md "Profiles") — the lane
logic behind ``manager.matrix_switch_profile``.

One lane, and it is the live one: 4321 ``MatrixSetProfile`` switches the running
matrix with zero engine reload, playback undisturbed, and post-process left
alone. Nothing here writes config. Saving and deleting a profile are staged
``<matrix_profile>`` edits carried by the persistent restore lane instead
(``conf/matrixconf.py``), because hqplayerd never persists a profile of its own
accord — its ``/matrix/save`` registers a name in memory and the config it
writes in the same breath omits the element (round 5).

The form lane (``POST /matrix/{load,save,delete}``) is gone from profile work
entirely. It cost a ~3 s engine reload per op, and ``load`` cost two: the
daemon's own load replaces the whole matrix context, clearing crossfeed / DAC
correction / loudness, so HQPTuner had to snapshot post-process and re-apply it
afterwards. Riding ``MatrixSetProfile`` never disturbs post-process, which
deletes the whole dance.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..engine.control import ControlError

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..core.manager import ConnectionManager


async def switch_profile(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Live switch + State readback + form resync. Empty name = ``[Default]``."""
    client = mgr.control
    if client is None:
        raise ControlError("daemon not connected")
    await client.set_matrix_profile(name)
    mgr.state = await client.get_state()
    await mgr.refresh_http_forms()
    return {"active": mgr.state.get("matrix_profile", "")}
