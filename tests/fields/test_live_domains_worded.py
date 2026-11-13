"""Every value a live field's domain refuses is refused with a worded cause.

A live write and a live resolve both ask ``out_of_domain`` whether a field's domain takes a value. Its answer is
either acceptance or a refusal carrying a cause, and ``says`` words that cause. A domain type with no cause makes
``out_of_domain`` raise ``KeyError`` instead, which would crash the request that asked. So every register row with
live facts is asked about strings that every bounded domain refuses: its answer is acceptance where its domain
takes the string, and a worded refusal everywhere else.
"""

from enum import Enum

import pytest

from hqptuner.engine.view import out_of_domain, says
from hqptuner.fields.model import Field
from hqptuner.fields.register import FIELDS


class Answer(Enum):
    """How ``out_of_domain`` answers for one value of one field."""

    ACCEPTED = "the domain takes the value"
    WORDED = "the domain refuses the value with a worded cause"
    UNWORDED = "the domain refuses the value and no cause is worded for it"


#: Every register row with live facts, by name.
LIVE_ROWS = [pytest.param(row, id=row.name) for row in FIELDS if row.live is not None]

#: Strings outside every bounded domain: no flag, no number, no integer, and no plausible listed choice.
PROBES = [
    pytest.param("", id="empty"),
    pytest.param("not a value", id="words"),
    pytest.param("1.2.3", id="two-points"),
]


def answer(row: Field, value: str) -> Answer:
    """How ``out_of_domain`` answers for ``value`` of ``row``, worded through ``says``."""
    try:
        refusal = out_of_domain(row, value)
        if refusal is None:
            return Answer.ACCEPTED
        says(refusal)
    except KeyError:
        return Answer.UNWORDED
    return Answer.WORDED


def expected(row: Field, value: str) -> Answer:
    """The answer the invariant owes: acceptance where the domain takes ``value``, a worded refusal elsewhere."""
    return Answer.ACCEPTED if row.domain.accepts(value) else Answer.WORDED


@pytest.mark.parametrize("value", PROBES)
@pytest.mark.parametrize("row", LIVE_ROWS)
def test_a_live_field_refuses_a_value_outside_its_domain_with_a_worded_cause(row: Field, value: str) -> None:
    assert answer(row, value) == expected(row, value)
