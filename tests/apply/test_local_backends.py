"""A staged setting of the ASIO or WASAPI backend lands on that backend's own config element.

A Windows hqplayerd carries the six settings of a local output backend once per backend, each on an element named
for it. Every case reads the edited config back with a plain XML parse, independent of the reader under test.
"""

import pytest
from defusedxml.ElementTree import fromstring

from hqptuner.conf import presetconf

# Nothing but the root: the backend's element is absent until the edit places it.
BARE = b"<hqplayerd/>"
VALUE = "7"

#: form-field suffix, and the attribute a setting of that suffix writes
ATTRIBUTES = [
    ("device", "device"),
    ("bits", "dac_bits"),
    ("period", "period_time"),
    ("offset", "channel_offset"),
    ("anydsd", "any_dsd"),
    ("dop", "pack_sdm"),
]
CASES = [
    pytest.param(f"{tag}_{suffix}", tag, attr, id=f"{tag}_{suffix}")
    for tag in ("asio", "wasapi")
    for suffix, attr in ATTRIBUTES
]


def _attribute(xml: bytes, tag: str, attr: str) -> str | None:
    """One attribute of the first ``tag`` element, or None where the element or the attribute is absent."""
    element = fromstring(xml).find(f".//{tag}")
    return None if element is None else element.get(attr)


@pytest.mark.parametrize(("field", "tag", "attr"), CASES)
def test_a_local_backend_setting_lands_on_its_own_element(field: str, tag: str, attr: str) -> None:
    assert _attribute(presetconf.apply_edits(BARE, {field: VALUE}), tag, attr) == VALUE
