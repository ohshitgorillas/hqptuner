"""A setter row states whether an edit's ``value`` alone fills an argument the edit omits.

Rule 3 of the field register, "SetFilter takes both halves": ``SetFilter value`` alone
sets both the 1x and the Nx filter. Every other setter in the "Setters" table writes a
single argument, so its ``value`` leaves nothing unwritten to fill.
"""

from hqptuner.fields import query

#: "Setters" table, the setting key of each row whose ``value`` alone also writes an omitted argument.
FILLING_KEYS = frozenset({"filter"})


def test_only_the_filter_setter_fills_an_omitted_argument_from_value_alone() -> None:
    assert frozenset(setter.key for setter in query.setters() if setter.value_fills) == FILLING_KEYS
