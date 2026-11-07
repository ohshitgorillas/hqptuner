"""The drop report ledger."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from hqptuner.core.lifecycle import Outcome

if TYPE_CHECKING:
    from hqptuner.core.readings import Readings
    from hqptuner.lanes.live.dropped import Dropped


class DropLedger:
    """The entries of the drop report, by field."""

    def __init__(self, readings: Readings) -> None:
        """Bind ``readings``, whose ``on_change`` announces each move of the list."""
        self._readings = readings
        self._lock = threading.Lock()
        self._listed: dict[str, Dropped] = {}
        self._owed = False

    def hear(self, outcome: Outcome) -> None:
        """Take the outcome the lifecycle names: a foreign departure owes a report, any other outcome owes none."""
        with self._lock:
            self._owed = outcome is Outcome.FOREIGN_DEPARTURE

    def settle(self) -> bool:
        """Answer whether a report is owed, and owe none from here on."""
        with self._lock:
            owed, self._owed = self._owed, False
        return owed

    def entries(self) -> tuple[Dropped, ...]:
        """Return what is listed, in the order each field was first dropped."""
        with self._lock:
            return tuple(self._listed.values())

    def record(self, report: tuple[Dropped, ...]) -> None:
        """List the entries of ``report``, replacing the entry of any field already listed."""
        with self._lock:
            before = dict(self._listed)
            self._listed.update({entry.field: entry for entry in report})
            moved = self._listed != before
        if moved:
            self._readings.on_change()

    def clear(self) -> None:
        """Forget everything listed."""
        with self._lock:
            moved = bool(self._listed)
            self._listed.clear()
        if moved:
            self._readings.on_change()
