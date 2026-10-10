"""The pinned output rate: one LIVE field, `rate`, in Hz, written by `SetRate`.

`SetRate` takes a `RatesItem` index of the running mode's list, index 0 being
auto; `[source]` mode ignores it; the engine holds one pin and `SetMode` drops it.
So the lane joins the Hz value to its index through the
engine's own rate list, refuses a rate that list lacks, refuses in `[source]`,
and refuses `rate` beside any other field, since the mode and the filter both
swap the list the index was resolved against. `"0"` clears the pin.

Everything runs against the stateful fake daemon over a real socket, whose rate
lists are PCM `0 44100 352800 705600 384000` and SDM `0 2822400 5644800
12288000` in index order (`tests/support/fake_control.py`). Assertions are on
what the daemon reports afterwards and on the code the route answers with.
"""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response


def _live(client: TestClient, fields: dict[str, str]) -> Response:
    resp: Response = client.post("/api/config/live", json={"fields": fields})
    return resp


def _rate(client: TestClient) -> str:
    """The rate index the engine's State reports."""
    return str(client.get("/api/state").json()["data"]["rate"])


# --- the pin --------------------------------------------------------------------

#: The configured mode, the rate pinned in Hz, and the index of that rate in the
#: mode's own list. Two families, two indices: a lane that sent the Hz value, or
#: resolved against the other family's list, lands on neither.
PINS = [
    pytest.param("1", "705600", "3", id="pcm"),
    pytest.param("2", "2822400", "1", id="sdm"),
]


@pytest.mark.parametrize(("mode", "hz", "index"), PINS)
def test_a_pinned_rate_reaches_the_engine_as_its_index_in_the_running_list(
    chain_api: Callable[..., TestClient], mode: str, hz: str, index: str
) -> None:
    client = chain_api(mode=mode)
    _live(client, {"rate": hz})
    assert _rate(client) == index


def test_a_rate_of_zero_clears_a_standing_pin(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(mode="1", rate="2")
    _live(client, {"rate": "0"})
    assert _rate(client) == "0"


def test_a_mode_write_leaves_no_pin_behind(chain_api: Callable[..., TestClient]) -> None:
    # The engine drops its pin on every SetMode. The lane keeps no memory of one,
    # so returning to the family it was pinned on does not bring it back.
    client = chain_api(mode="1")
    _live(client, {"rate": "352800"})
    _live(client, {"mode": "sdm"})
    _live(client, {"mode": "pcm"})
    assert _rate(client) == "0"


# --- what is refused --------------------------------------------------------------

#: Each engine situation and batch the lane refuses outright.
#: - a rate the running list lacks, from neither family and from the other one;
#: - `[source]` mode, with the PCM chain loaded and 352800 on its list, so only
#:   the mode refuses it;
#: - `rate` beside another field, a chain field and a flag alike.
REFUSED = [
    pytest.param({"mode": "1"}, {"rate": "48000"}, id="not-on-the-list"),
    pytest.param({"mode": "1"}, {"rate": "2822400"}, id="other-family"),
    pytest.param({"mode": "0", "_active_mode": "PCM"}, {"rate": "352800"}, id="source-mode"),
    pytest.param({"mode": "1"}, {"rate": "352800", "filter": "40"}, id="beside-a-filter"),
    pytest.param({"mode": "1"}, {"rate": "352800", "adaptive_volume": "1"}, id="beside-a-flag"),
]


@pytest.mark.parametrize(("engine", "fields"), REFUSED)
def test_a_rate_the_lane_cannot_pin_is_refused_as_a_route_refusal(
    chain_api: Callable[..., TestClient], engine: dict[str, str], fields: dict[str, str]
) -> None:
    client = chain_api(**engine)
    assert _live(client, fields).json().get("code") == "route_refused"


def test_staging_a_rate_for_the_tabs_view_is_refused(live_api: TestClient) -> None:
    # The pin goes through the LIVE lane alone, which joins Hz to the running
    # list and applies the refusals above; a staged raw index would skip them.
    resp = live_api.post("/api/config/stage", json={"live": {"rate": {"value": "2"}}})
    assert resp.json().get("code") == "fields_unknown"


# --- what never holds a pin -------------------------------------------------------


def test_a_saved_snapshot_holds_the_same_settings_with_a_rate_pinned(chain_api: Callable[..., TestClient]) -> None:
    # The pin is a moment's override that a mode write drops, so a snapshot taken
    # with one standing stores exactly what a snapshot taken without one does.
    client = chain_api(mode="1")
    unpinned = sorted(client.put("/api/livepresets/Before").json()["fields"])
    _live(client, {"rate": "352800"})
    assert sorted(client.put("/api/livepresets/After").json()["fields"]) == unpinned
