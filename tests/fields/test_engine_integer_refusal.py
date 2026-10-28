"""An `<engine>` integer attribute refuses what is not an integer.

An integer here is an optional leading ``-`` and then ASCII digits, nothing
else, so a doubled sign and digits from other scripts are both refused with the
integer refusal before anything is written.
"""

import pytest

from hqptuner.conf.engineconf import NotAnIntegerAttributeError, validate_overrides

#: The `<engine>` hardware attributes whose domain is an integer.
INTEGER_ATTRIBUTES = ["nblocks", "cuda_dev", "cuda_cdev"]

#: A leading sign given twice.
DOUBLED_SIGN = "--1"

#: Sixteen in Arabic-Indic digits: digits, but not ASCII ones.
ARABIC_INDIC_SIXTEEN = "١٦"


@pytest.mark.parametrize("attribute", INTEGER_ATTRIBUTES)
def test_an_integer_attribute_refuses_a_doubled_sign(attribute: str) -> None:
    with pytest.raises(NotAnIntegerAttributeError):
        validate_overrides({attribute: DOUBLED_SIGN})


@pytest.mark.parametrize("attribute", INTEGER_ATTRIBUTES)
def test_an_integer_attribute_refuses_non_ascii_digits(attribute: str) -> None:
    with pytest.raises(NotAnIntegerAttributeError):
        validate_overrides({attribute: ARABIC_INDIC_SIXTEEN})
