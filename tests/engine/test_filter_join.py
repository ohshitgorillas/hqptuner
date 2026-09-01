"""The ``-2s`` leg of the static filter join (filters.json ``_join_rules``).

A ``-2s`` name is HQPlayer's two-stage variant of a base filter and the database
carries no row of its own for it: the join strips the suffix, takes the base
row, and extends that row's description with the shared two-stage note. Stripping
alone would answer with the base entry verbatim and the two-stage fact would
never reach the reader.

The database here is a fixture of invented names and invented prose
(``tests/support/fixtures/metadata_min``), not the shipped one — join mechanics
are the behavior, the owner's wording is not (docs/testing.md rule 9).
"""

import json

from conftest import METADATA_MIN as FIXTURE_DIR
from narrow import present

from hqptuner.metadata import StaticMetadata

_FILTERS = json.loads((FIXTURE_DIR / "filters.json").read_text())
BASE_NAME = "fixture-base-lp"
BASE_DESCRIPTION = _FILTERS["filters"][BASE_NAME]["description"]
TWO_STAGE_NOTE = _FILTERS["two_stage_note"]


def test_a_2s_name_answers_the_base_prose_extended_by_the_two_stage_note() -> None:
    description = present(StaticMetadata(FIXTURE_DIR).filter_entry(f"{BASE_NAME}-2s"))["description"]
    assert BASE_DESCRIPTION in description and TWO_STAGE_NOTE in description
