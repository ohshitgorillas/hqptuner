"""The config the daemon is running, as the file, the staged edits and the engine say it."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hqptuner.engine.chainfamily import chain_name, status_chain
from hqptuner.lanes.live.routing import DIRECT, ROUTABLE, LiveField, mode_form_value

if TYPE_CHECKING:
    from hqptuner.lanes.live.chain import EnumItems


class EngineReading(Protocol):
    """One Engine reading, as ``core.readings.EngineSnapshot`` carries it."""

    @property
    def state(self) -> dict[str, str] | None:  # engine, list index
        """The ``State`` frame, None when not read yet."""

    @property
    def status(self) -> dict[str, str] | None:  # engine, text
        """The ``Status`` frame, None when not read yet."""

    @property
    def enums(self) -> dict[str, list[dict[str, str]]] | None:  # engine, list index to name and enum ID
        """The enumerations, None when not read yet."""


def _item_at(items: EnumItems, index: str) -> dict[str, str] | None:
    """Return the enumeration item at this list index, None when the list does not carry it."""
    return next((item for item in items if str(item.get("index")) == str(index)), None)


def _loaded_chain(state: dict[str, str], engine: EngineReading) -> str | None:
    """Return the chain the Engine has loaded: its configured mode's, else the one Status reports running."""
    mode = _item_at((engine.enums or {}).get("modes") or [], state.get("mode") or "")
    configured = chain_name(mode.get("name") or "") if mode is not None else None
    return configured if configured is not None else status_chain(engine.status or {})


def _form_value(field: str, spec: LiveField, index: str, engine: EngineReading) -> str | None:
    """Translate one routable field's Engine list index into the enum ID or mode value the File holds."""
    items = (engine.enums or {}).get(spec.enum) or []
    if field == "mode":
        return mode_form_value(items, index)
    item = _item_at(items, index)
    value = None if item is None else item.get("value")
    return None if value is None else str(value)


def _engine_fields(engine: EngineReading | None) -> dict[str, str]:  # engine, enum ID and flag
    """Return the live-domain fields in File terms as the Engine reading answers for them, empty when not read yet."""
    state = engine.state if engine is not None else None
    if engine is None or state is None:
        return {}
    chain = _loaded_chain(state, engine)
    fields: dict[str, str] = {}
    for field, spec in ROUTABLE.items():
        index = state.get(spec.state)
        if index is None or spec.chain not in {None, chain}:
            continue
        value = _form_value(field, spec, index, engine)
        if value is not None:
            fields[field] = value
    fields.update({field: state[attr] for field, attr in DIRECT.items() if state.get(attr) is not None})
    return fields


def realized_config(
    file_config: dict[str, str], staged: dict[str, str], engine: EngineReading | None
) -> dict[str, str]:
    """Return what a restore boots on and a save stores.

    The File as ``/backup`` returned it, the Engine's live-domain fields written in, the Staged edits over both.
    """
    return {**file_config, **_engine_fields(engine), **staged}
