"""In-memory ring of the most recent log records, rendered as text.

``RECENT`` is the process-wide instance, attached to the root logger at startup, so the last
``RECENT_CAPACITY`` lines the application logged stay readable without a log file. Older lines fall off
the front as new ones arrive; nothing here touches the disk.
"""

import logging
from collections import deque

#: The line format the root logger writes, shared by every handler on it.
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"

#: How many lines ``RECENT`` keeps.
RECENT_CAPACITY = 2000


class RingHandler(logging.Handler):
    """A handler that keeps the last ``capacity`` records it handled, each as its formatter renders it."""

    def __init__(self, capacity: int) -> None:
        """Hold at most ``capacity`` lines; the oldest is dropped when another arrives at the limit."""
        super().__init__()
        self._lines: deque[str] = deque(maxlen=capacity)

    def emit(self, record: logging.LogRecord) -> None:
        """Render ``record`` with this handler's formatter and append it, under the handler's lock."""
        line = self.format(record)
        self.acquire()
        try:
            self._lines.append(line)
        finally:
            self.release()

    def lines(self) -> list[str]:
        """Return a copy of the kept lines, oldest first."""
        self.acquire()
        try:
            return list(self._lines)
        finally:
            self.release()


RECENT = RingHandler(RECENT_CAPACITY)
