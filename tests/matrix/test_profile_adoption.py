"""One rule decides which matrix profile an apply adopts as the live matrix, whichever lane asks."""

import json

from hqptuner.conf.matrixprofiles import profile_to_adopt
from hqptuner.fields.model import Codec
from hqptuner.fields.query import kept_at


def _deleting(name: str) -> dict[str, str]:
    return {kept_at(Codec.PROFILE_DELETE): json.dumps({"name": name})}


def test_an_active_profile_is_adopted_when_the_apply_does_not_delete_it() -> None:
    assert profile_to_adopt({}, "Night") == "Night"


def test_an_active_profile_is_adopted_beside_the_deletion_of_another() -> None:
    assert profile_to_adopt(_deleting("Day"), "Night") == "Night"


def test_only_the_deletion_of_the_active_profile_stops_its_adoption() -> None:
    assert (profile_to_adopt(_deleting("Night"), "Night"), profile_to_adopt(_deleting("Day"), "Night")) == ("", "Night")


def test_the_default_matrix_is_not_a_profile_to_adopt_where_a_named_one_is() -> None:
    assert (profile_to_adopt(_deleting("Day"), ""), profile_to_adopt({}, "Day")) == ("", "Day")
