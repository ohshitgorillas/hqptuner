"""``trackcontext.context_from`` — the advisor's view of the engine's current track, built off the manager's
last poll (state, status, enumerations) rather than the wire."""

import pytest

from hqptuner.core.manager import ConnectionManager
from hqptuner.engine import trackcontext


def test_an_unparseable_status_attribute_raises_the_typed_error(http_manager: ConnectionManager) -> None:
    http_manager.reachable = True
    http_manager.readings.status = {"state": "not-a-number"}
    http_manager.readings.status_metadata = {}
    with pytest.raises(trackcontext.UnparseableStatusAttributeError):
        trackcontext.context_from(http_manager)


#: the running enumeration of junk filters, every attribute a string as the daemon sends it
JUNK_FILTERS = [{"index": "0", "name": "none"}, {"index": "1", "name": "20k"}, {"index": "2", "name": "2x"}]
#: an index the enumeration above lists, which State never reports in these cases
STATUS_ONLY_INDEX = "2"
ENGAGED_INDEX = "1"
UNLISTED_INDEX = "7"


@pytest.mark.parametrize(
    ("state_index", "expected"),
    [(ENGAGED_INDEX, "20k"), (UNLISTED_INDEX, None)],
    ids=["listed-index-names-its-filter", "unlisted-index-reads-as-none-engaged"],
)
def test_the_junk_filter_is_states_index_joined_against_the_enumeration(
    http_manager: ConnectionManager, state_index: str, expected: str | None
) -> None:
    http_manager.reachable = True
    http_manager.readings.state = {"filter_junk": state_index}
    http_manager.readings.status = {"filter_junk": STATUS_ONLY_INDEX}
    http_manager.readings.enums = {"junk_filters": JUNK_FILTERS}
    context = trackcontext.context_from(http_manager)
    assert context is not None
    assert context.junk_filter == expected
