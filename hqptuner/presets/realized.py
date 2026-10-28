"""The config the daemon is running, as the file, the staged edits and the engine say it."""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.lanes.live.overrides import reading_overrides

if TYPE_CHECKING:
    from hqptuner.lanes.live.chain import EngineReading


def _engine_fields(engine: EngineReading | None) -> dict[str, str]:  # engine, enum ID and flag
    """Return the live-domain fields in File terms as the Engine reading answers for them, empty when not read yet."""
    return {} if engine is None else reading_overrides(engine)


def realized_config(
    file_config: dict[str, str], staged: dict[str, str], engine: EngineReading | None
) -> dict[str, str]:
    """Return what a restore boots on and a save stores.

    The File as ``/backup`` returned it, the Engine's live-domain fields written in, the Staged edits over both.
    """
    return {**file_config, **_engine_fields(engine), **staged}
