"""Each setter states how its readback is compared with State.

The expected values are the spec's "Setters" table, column "State attributes read
back": a row that names a tolerance compares its numeric readback within it, and
every other row is an exact State match.
"""

from enum import Enum

from hqptuner.fields import query


class Absent(Enum):
    """What a helper answers when the register holds no setter to ask."""

    SETTER = "the register has no setter under this key"


#: "Setters", the one row whose readback names a tolerance: `volume`, "within 0.05".
TOLERANT_KEY = "volume"
VOLUME_TOLERANCE = 0.05


def setter_tolerance(key: str) -> object:
    """The tolerance of the setter written under ``key``, or ``Absent.SETTER``."""
    found = [setter for setter in query.setters() if setter.key == key]
    return found[0].tolerance if found else Absent.SETTER


def test_the_volume_readback_matches_state_within_its_tolerance() -> None:
    assert setter_tolerance(TOLERANT_KEY) == VOLUME_TOLERANCE


def test_only_the_volume_readback_is_compared_within_a_tolerance() -> None:
    assert frozenset(setter.key for setter in query.setters() if setter.tolerance is not None) == {TOLERANT_KEY}
