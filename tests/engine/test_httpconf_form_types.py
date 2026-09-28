"""The /config form parser owns its own result shape (docs/testing.md).

``ConfigForm`` is the TypedDict naming the dict-of-dicts shape
``parse_config_form`` returns.
"""

from pathlib import Path

from hqptuner.conf.formparse import parse_config_form
from hqptuner.conf.httpforms import ConfigForm

FIXTURE = Path(__file__).parent.parent / "support" / "fixtures" / "config-form-6.0.4.html"


def _parsed() -> ConfigForm:
    return parse_config_form(FIXTURE.read_text())


def test_parsed_form_first_field_carries_its_wire_input_type() -> None:
    assert _parsed()["fields"][0]["type"] == "text"
