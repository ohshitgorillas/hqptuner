"""Each setter writes exactly the fields whose live setter is that setter's command.

The expected fields are the spec's "Fields with a setter" table, grouped by its
Setter column and keyed by the "Setters" table's setting key for that command.
"""

from enum import Enum

import pytest

from hqptuner.fields import query


class Absent(Enum):
    """What a helper answers when the register holds nothing to ask."""

    SETTER = "the register has no setter under this key"


#: "Setters" setting key to the "Fields with a setter" rows whose Setter is that key's command.
WRITTEN_BY_KEY: dict[str, frozenset[str]] = {
    "mode": frozenset({"mode"}),
    "filter": frozenset({"filter1x", "filter", "oversampling1x", "oversampling"}),
    "shaper": frozenset({"dither", "modulator"}),
    "rate": frozenset({"rate"}),
    "junk_filter": frozenset({"junk_filter"}),
    "adaptive_volume": frozenset({"adaptive_volume"}),
    "volume": frozenset({"volume"}),
}


def field_name(written: object) -> object:
    """A written field as its name, whether the register answers a row or the name itself."""
    return getattr(written, "name", written)


def fields_written_under(key: str) -> frozenset[object] | Absent:
    """The names of the fields the setter under ``key`` writes, or ``Absent.SETTER``."""
    found = [setter for setter in query.setters() if setter.key == key]
    if not found:
        return Absent.SETTER
    return frozenset(field_name(written) for written in query.written_by(found[0]))


@pytest.mark.parametrize(("key", "fields"), WRITTEN_BY_KEY.items())
def test_a_setter_writes_exactly_the_fields_whose_live_setter_is_its_command(key: str, fields: frozenset[str]) -> None:
    assert fields_written_under(key) == fields
