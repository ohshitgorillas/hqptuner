"""The table of staged-route fields is built from the register, and fails when a row cannot be routed."""

from dataclasses import replace

import pytest

from hqptuner.fields import query
from hqptuner.lanes.live import routing


def test_building_the_route_table_with_a_staged_route_field_that_has_no_setter_fails() -> None:
    row = query.staged_routes()[0]
    assert row.live is not None
    orphan = replace(row, live=replace(row.live, setter="NoSuchSetter"))
    with pytest.raises(KeyError):
        routing.routable((orphan,))


def test_every_staged_route_field_is_in_the_route_table() -> None:
    assert {row.name for row in query.staged_routes()} == set(routing.ROUTABLE)
