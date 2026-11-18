"""The wire facts of one restart scenario, written once for the suites that play it.

A row is a wire fact at a clock reading, beside the instance that put it on the wire. The suites feed the rows to the
phase at the readings the table gives, each from its own start.
"""

from hqptuner.core.lifecycle import Fact

#: The instance that put a fact on the wire: the one the restart kills, and the one that replaces it. A fact
#: HQPTuner observes alone, its own close or a refused dial, comes from neither.
OLD = "old"
NEW = "new"

#: A wire fact at a clock reading, beside the instance that answered it.
Row = tuple[float, Fact, str | None]

#: The old instance answers for a moment after the restart is accepted, then drops, and the new one comes back.
OLD_INSTANCE_ANSWERS_FOR_A_MOMENT: list[Row] = [
    (0.1, Fact.GETINFO_ANSWERED, OLD),
    (0.2, Fact.FORM_ANSWERED, OLD),
    (0.3, Fact.SOCKET_LOST, OLD),
    (0.5, Fact.DIAL_REFUSED, None),
    (3.0, Fact.GETINFO_ANSWERED, NEW),
    (5.0, Fact.FORM_ANSWERED, NEW),
]
