"""Narrowing a parsed audit row's fields: a recognized key keeps a value of the right shape, anything else is dropped.

A hand-edited or foreign JSONL line must never crash the reader, so every key here is offered a value of the wrong
shape beside one well-formed ``ok``. The row narrows to the keys it narrows to with the wrong-shaped one left out, and
``ok`` is among them. Pure function, no log: the lowest lane that sees it (docs/testing.md rule 15).
"""

import pytest

from hqptuner.audit_narrow import narrow_fields
from hqptuner.audit_types import Json

#: A key from each vocabulary group, with a value of a shape that group does not accept.
WRONG_SHAPES: list[tuple[str, Json]] = [
    ("switch_to", 5),
    ("save", 5),
    ("name", 5),
    ("previous_active", 5),
    ("previous", 5),
    ("source", 5),
    ("host", 5),
    ("username", 5),
    ("remember", "yes"),
    ("want", 5),
    ("engaged", 5),
    ("readback", 5),
    ("fields", {"volume": 5}),
    ("last_write", 5),
]

#: A key from the same groups, with a value of the shape the group accepts.
RIGHT_SHAPES: list[tuple[str, Json]] = [
    ("source", "keypad"),
    ("host", "listener.example"),
    ("username", "operator"),
    ("remember", True),
    ("want", "cutoff"),
    ("fields", {"volume": "-6", "mute": None}),
]


@pytest.mark.parametrize(("key", "right"), RIGHT_SHAPES)
def test_a_value_of_the_right_shape_is_kept_as_it_arrived(key: str, right: Json) -> None:
    assert dict(narrow_fields({key: right}))[key] == right


@pytest.mark.parametrize(("key", "wrong"), WRONG_SHAPES)
def test_a_value_of_the_wrong_shape_drops_its_key_and_leaves_the_rest(key: str, wrong: Json) -> None:
    assert narrow_fields({key: wrong, "ok": True}).keys() == narrow_fields({"ok": True}).keys() - {key}


def test_a_dropped_entry_that_is_not_a_mapping_narrows_as_an_empty_one() -> None:
    assert narrow_fields({"dropped": "volume"}) == narrow_fields({"dropped": {}})
