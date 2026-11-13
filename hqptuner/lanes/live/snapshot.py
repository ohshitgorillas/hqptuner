"""The engine's current live settings, as a saveable record.

A live snapshot (``presets/store/live.py``) is a snapshot of what the engine is playing
right now, taken in the same domain ``routing.resolve_live`` accepts back — so
applying a preset is the same batch the live controls would have sent. The display
name rides along because the enumerations are engine-built and can shift under a
preset; the value is what applies, the name is only what the card shows.

A snapshot holds the fields the register marks as snapshot fields; the junk filter follows the
material, so no saved snapshot holds it.

``routing`` turns form fields into setter args; this module reads the result
back out through the Engine view.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.engine.view import EngineView, Reading
from hqptuner.errors import HQPTunerError
from hqptuner.fields import query
from hqptuner.fields.model import Chain, Join

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

MATRIX_PROFILE = "matrix_profile"
DEFAULT_PROFILE_NAME = "[Default]"

_UNKNOWN_CHAIN = {"chain": "the engine's active chain is unknown, so there is no live state to snapshot"}


class ChainUnknownError(HQPTunerError):
    """The engine's active chain cannot be determined, so there is no live state to snapshot.

    ``reasons`` is the per-field detail the API answers with, keyed by the one field it could not fill.
    """

    code = "chain_unknown"

    def __init__(self) -> None:
        """Carry the fixed per-field reasons dict; this template carries no interpolated fact."""
        super().__init__(_UNKNOWN_CHAIN["chain"])
        self.reasons = dict(_UNKNOWN_CHAIN)


def shown(field: str, reading: Reading) -> dict[str, str]:
    """Return a reading as the ``{value, name}`` a snapshot holds, naming the default matrix, whose value is empty."""
    name = reading.name
    if not name and query.live(field).join is Join.PROFILE_NAME:
        name = DEFAULT_PROFILE_NAME
    return {"value": reading.value, "name": name}


@dataclass(frozen=True)
class LiveSnapshot:
    """The chain the engine has loaded, and every setting a snapshot holds that it can report, as ``{value, name}``."""

    chain: Chain
    fields: dict[str, dict[str, str]]


def live_snapshot(mgr: LaneManager) -> LiveSnapshot:
    """Read the settings a saved snapshot holds and the chain they were read on, in one pass.

    ``ChainUnknownError`` when the view cannot say which chain is loaded: the chain
    fields would be missing and the record would claim a chain it never captured, so
    the read is refused rather than half-taken.
    """
    view = EngineView.of(mgr.readings)
    chain = view.loaded_chain()
    if chain is None:
        raise ChainUnknownError
    readings = ((field, view.read(field)) for field in query.snapshot_fields())
    return LiveSnapshot(chain, {field: shown(field, reading) for field, reading in readings if reading is not None})
