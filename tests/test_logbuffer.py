"""``RingHandler`` — a logging handler that keeps the most recent records it
handled, rendered by its formatter, and hands them back oldest first.

Records are emitted through a dedicated non-propagating logger so nothing in
these tests reaches the root logger or any other handler.
"""

import logging
from collections.abc import Iterator

import pytest

from hqptuner.logbuffer import RingHandler

CAPACITY = 3
OVERFLOW = 2
PLAIN_FORMAT = "%(message)s"
DISTINCT_FORMAT = "LOGBUF|%(levelname)s|%(name)s|%(message)s"
LOGGER_NAME = "tests.logbuffer.ring"
PROBE_MESSAGE = "probe"


@pytest.fixture
def ring_logger() -> Iterator[tuple[logging.Logger, RingHandler]]:
    logger = logging.getLogger(LOGGER_NAME)
    saved_level, saved_propagate = logger.level, logger.propagate
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    handler = RingHandler(CAPACITY)
    logger.addHandler(handler)
    yield logger, handler
    logger.removeHandler(handler)
    logger.setLevel(saved_level)
    logger.propagate = saved_propagate


def test_lines_keeps_only_the_last_capacity_records_oldest_first(
    ring_logger: tuple[logging.Logger, RingHandler],
) -> None:
    logger, handler = ring_logger
    handler.setFormatter(logging.Formatter(PLAIN_FORMAT))
    for index in range(CAPACITY + OVERFLOW):
        logger.info("m%d", index)
    assert handler.lines() == ["m2", "m3", "m4"]


def test_each_line_is_the_record_as_the_formatter_renders_it(
    ring_logger: tuple[logging.Logger, RingHandler],
) -> None:
    logger, handler = ring_logger
    handler.setFormatter(logging.Formatter(DISTINCT_FORMAT))
    logger.warning(PROBE_MESSAGE)
    assert handler.lines() == [f"LOGBUF|WARNING|{LOGGER_NAME}|{PROBE_MESSAGE}"]
