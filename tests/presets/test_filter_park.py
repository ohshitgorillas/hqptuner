"""The filter park's byte ceiling and its handling of a name already parked,
driven through `FilterPark.park` alone and read back as the members an apply
ships."""

from collections.abc import Iterator
from contextlib import suppress
from pathlib import Path

import pytest
from conftest import minimal_wave

from hqptuner.presets.store.filterpark import PARK_MAX_BYTES, FilterPark, ParkAtCapacityError

#: The daemon home the park reports paths against; never read by these cases.
HOME = "/x/home"

#: The one name both uploads carry, so the second always collides with the first.
NAME = "probe.wav"

#: Size of the second upload, in bytes; identical in every case, so only the
#: park's fill decides whether it is kept.
UPLOAD = 1024

#: A first upload that leaves exactly room for the second.
EXACT_FIT = PARK_MAX_BYTES - UPLOAD

#: A first upload that leaves one byte too little room for the second.
ONE_OVER = EXACT_FIT + 1

#: The first upload's size, and the sizes of everything parked once the second has been tried.
CEILING_CASES = [
    pytest.param(EXACT_FIT, [UPLOAD, EXACT_FIT], id="fills-the-park-exactly"),
    pytest.param(ONE_OVER, [ONE_OVER], id="one-byte-over"),
]


@pytest.fixture
def park(tmp_path: Path) -> Iterator[FilterPark]:
    """An empty park under ``tmp_path``, emptied again afterwards so no ceiling-sized file outlives the case."""
    filter_park = FilterPark(tmp_path / "park", HOME)
    yield filter_park
    filter_park.clear()


def _parked_sizes_after_a_colliding_upload(park: FilterPark, first: int) -> list[int]:
    """Park a ``first``-byte file, try an ``UPLOAD``-byte file under the same name, return the parked sizes sorted."""
    park.park(NAME, minimal_wave(first))
    with suppress(ParkAtCapacityError):
        park.park(NAME, minimal_wave(UPLOAD))
    return sorted(len(data) for data in park.members().values())


@pytest.mark.parametrize(("first", "expected"), CEILING_CASES)
def test_a_colliding_upload_is_parked_beside_the_first_only_while_the_park_stays_within_its_ceiling(
    park: FilterPark, first: int, expected: list[int]
) -> None:
    assert _parked_sizes_after_a_colliding_upload(park, first) == expected
