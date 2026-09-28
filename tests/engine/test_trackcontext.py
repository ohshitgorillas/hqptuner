"""``trackcontext.context_from`` — the advisor's view of the engine's current track, built off the manager's
last poll (state, status, enumerations) rather than the wire."""

import pytest

from hqptuner.core.manager import ConnectionManager
from hqptuner.engine import trackcontext


class NoContextError(Exception):
    """``context_from`` answered ``None`` where this test's fixture always carries a reachable poll snapshot."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("expected a TrackContext")


def _context(manager: ConnectionManager) -> trackcontext.TrackContext:
    """``context_from``'s result, narrowed: the manager here always carries a reachable poll snapshot."""
    ctx = trackcontext.context_from(manager)
    if ctx is None:
        raise NoContextError()
    return ctx


def test_an_unparseable_status_attribute_raises_the_typed_error(http_manager: ConnectionManager) -> None:
    http_manager.reachable = True
    http_manager.readings.status = {"state": "not-a-number"}
    http_manager.readings.status_metadata = {}
    with pytest.raises(trackcontext.UnparseableStatusAttributeError):
        trackcontext.context_from(http_manager)


def test_a_junk_filter_index_with_no_matching_enum_reads_as_no_filter_engaged(
    http_manager: ConnectionManager,
) -> None:
    http_manager.reachable = True
    http_manager.readings.status = {}
    http_manager.readings.status_metadata = {}
    http_manager.readings.state = {"filter_junk": "3"}
    http_manager.readings.enums = {"junk_filters": []}
    absent = _context(http_manager).junk_filter
    http_manager.readings.enums = {"junk_filters": [{"index": "3", "name": "junk-three"}]}
    assert (absent, _context(http_manager).junk_filter) == (None, "junk-three")
