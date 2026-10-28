"""A field's value is checked against the domain the register gives it.

The `<engine>` hardware attributes take their listed choices or an integer, the
0/1 flag takes the strings ``0`` and ``1`` only (Rules, 5), and the volume takes a
decimal number. A refusal is asked of the register's own rows, so a register
missing the row answers ``Absent`` and never passes for a refusal.
"""

from enum import Enum

import pytest

from hqptuner.fields import query
from hqptuner.fields.model import Choice, Text


class Absent(Enum):
    """What a helper answers when the register holds nothing to ask."""

    ROW = "the register has no row for this field"
    DOMAIN = "the register checks no domain for this attribute"


#: "`<engine>` hardware attributes": every value each attribute's domain lists.
HARDWARE_ACCEPTS = [
    ("cuda", "0"),
    ("cuda", "1"),
    ("cuda", "convolution"),
    ("multicore", "auto"),
    ("multicore", "0"),
    ("multicore", "1"),
    ("ecores", "default"),
    ("ecores", "pool"),
    ("ecores", "filter"),
    ("nblocks", "16"),
    ("nblocks", "-1"),
    ("cuda_dev", "0"),
    ("cuda_cdev", "-2"),
]

#: Values outside each attribute's domain: another attribute's choice, another case, and
#: integers carrying anything but an optional leading ``-`` and digits.
HARDWARE_REFUSES = [
    ("cuda", "pool"),
    ("cuda", "2"),
    ("cuda", "CONVOLUTION"),
    ("multicore", "convolution"),
    ("multicore", ""),
    ("ecores", "auto"),
    ("nblocks", "1.5"),
    ("nblocks", "+3"),
    ("nblocks", "-"),
    ("nblocks", ""),
    ("nblocks", "--1"),
    ("nblocks", "1\n"),
    ("cuda_dev", " 7"),
    ("cuda_cdev", "auto"),
]

#: One value each attribute's domain lists, asked beside each refused value.
HARDWARE_TAKES = {
    "cuda": "convolution",
    "multicore": "auto",
    "ecores": "pool",
    "nblocks": "16",
    "cuda_dev": "0",
    "cuda_cdev": "-2",
}

#: The `<engine>` attributes the engine-attribute path checks.
HARDWARE = frozenset({"cuda", "multicore", "ecores", "nblocks", "cuda_dev", "cuda_cdev"})

#: The 0/1 flag field, the two strings it takes, and strings Rules 5 refuses.
FLAG_FIELD = "adaptive_volume"
FLAG_ACCEPTS = ("0", "1")
FLAG_REFUSES = ("01", "1.5", "2", "", "true")
FLAG_TAKES = "1"

#: The decimal-number field, numbers it takes, and strings that are not one.
DECIMAL_FIELD = "volume"
DECIMAL_ACCEPTS = ("-10.5", "-3", "0")
DECIMAL_REFUSES = ("loud", "", "1.2.3", "-")
DECIMAL_TAKES = "-10.5"


def engine_accepts(attribute: str, value: str) -> bool | Absent:
    """Whether the hardware attribute's domain takes ``value``, or ``Absent.DOMAIN``."""
    domain = query.engine_domains().get(attribute)
    return Absent.DOMAIN if domain is None else domain.accepts(value)


def field_accepts(name: str, value: str) -> bool | Absent:
    """Whether the register's row for ``name`` takes ``value``, or ``Absent.ROW``."""
    row = query.field(name)
    return Absent.ROW if row is None else row.domain.accepts(value)


def test_the_engine_attribute_path_checks_exactly_the_hardware_attributes() -> None:
    assert frozenset(query.engine_domains()) == HARDWARE


@pytest.mark.parametrize(("attribute", "value"), HARDWARE_ACCEPTS)
def test_a_hardware_attribute_takes_a_value_its_domain_lists(attribute: str, value: str) -> None:
    assert engine_accepts(attribute, value) is True


@pytest.mark.parametrize(("attribute", "value"), HARDWARE_REFUSES)
def test_a_hardware_attribute_refuses_a_value_outside_its_domain(attribute: str, value: str) -> None:
    assert (engine_accepts(attribute, HARDWARE_TAKES[attribute]), engine_accepts(attribute, value)) == (True, False)


@pytest.mark.parametrize("value", FLAG_ACCEPTS)
def test_a_flag_field_takes_zero_and_one(value: str) -> None:
    assert field_accepts(FLAG_FIELD, value) is True


@pytest.mark.parametrize("value", FLAG_REFUSES)
def test_a_flag_field_refuses_every_other_string_unparsed(value: str) -> None:
    assert (field_accepts(FLAG_FIELD, FLAG_TAKES), field_accepts(FLAG_FIELD, value)) == (True, False)


@pytest.mark.parametrize("value", DECIMAL_ACCEPTS)
def test_the_volume_takes_a_decimal_number(value: str) -> None:
    assert field_accepts(DECIMAL_FIELD, value) is True


@pytest.mark.parametrize("value", DECIMAL_REFUSES)
def test_the_volume_refuses_a_string_that_is_no_number(value: str) -> None:
    assert (field_accepts(DECIMAL_FIELD, DECIMAL_TAKES), field_accepts(DECIMAL_FIELD, value)) == (True, False)


def test_a_choice_takes_any_of_its_own_values() -> None:
    assert Choice(values=("left", "right")).accepts("right") is True


def test_text_takes_any_string() -> None:
    assert Text().accepts("Living room <2>") is True
