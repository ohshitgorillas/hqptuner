"""Which chain the engine has loaded."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hqptuner.engine.chainfamily import chain_name, status_chain

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

EnumItems = list[dict[str, str]]


class EngineReading(Protocol):
    """One Engine reading, as ``core.readings.EngineSnapshot`` and the manager's readings carry it."""

    @property
    def state(self) -> dict[str, str] | None:  # engine, list index
        """The ``State`` frame, None when not read yet."""

    @property
    def status(self) -> dict[str, str] | None:  # engine, text
        """The ``Status`` frame, None when not read yet."""

    @property
    def enums(self) -> dict[str, list[dict[str, str]]] | None:  # engine, list index to name and enum ID
        """The enumerations, None when not read yet."""


def _reading_configured_chain(reading: EngineReading) -> str | None:
    """Return the chain of the mode this reading's State configures, None in auto or when State cannot say."""
    index = (reading.state or {}).get("mode")
    if index is None:
        return None
    for item in (reading.enums or {}).get("modes", []):
        if str(item.get("index")) == str(index):
            return chain_name(item.get("name") or "")
    return None


def configured_chain(mgr: LaneManager) -> str | None:
    """Return the CONFIGURED mode's chain — decisive when it is pcm or sdm, None in auto or when State cannot say."""
    return _reading_configured_chain(mgr.readings)


def loaded_chain(reading: EngineReading) -> str | None:
    """Which filter/shaper chain this Engine reading has loaded.

    The configured mode answers it outright when set to pcm or sdm. In ``auto``
    the engine switches per source (readme §1.7, "Automatic switching"), so the
    configured value cannot say and Status answers instead (``status_chain``).
    None when neither can answer, which keeps the fields on the restore lane
    rather than guessing a chain.

    A rate choice is a different question and does not come here: it goes to the
    config LIMIT slot, not to the loaded chain.
    """
    chain = _reading_configured_chain(reading)
    return chain if chain is not None else status_chain(reading.status or {})


def active_chain(mgr: LaneManager) -> str | None:
    """Which filter/shaper chain the engine currently has loaded, as ``loaded_chain`` reads the manager's readings."""
    return loaded_chain(mgr.readings)
