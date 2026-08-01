"""Matrix read lane: the /matrix form parse (pipeline rows, profiles, active
label, malformed-markup tolerance) and the 4321 Matrix* profile queries.

Two markup sources, deliberately: the HTTP fake renders 6.0.4-shaped pages the
tests can vary (process strings, profile lists), and ``fixtures/matrix-6.0.4.html``
is the page a real 6.0.4 daemon actually served (captured live on Opal,
2026-07-20; owner name scrubbed from the <title> only) — so a transcription
error in the fake cannot silently vouch for the parser."""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from hqptuner.conf.httpconf import HttpConfigClient, parse_matrix_form
from hqptuner.engine.control import ControlClient

REAL_PAGE = (Path(__file__).parent.parent / "support" / "fixtures" / "matrix-6.0.4.html").read_text()


@pytest.fixture
async def matrix_client(http_daemon: dict[str, Any]) -> AsyncIterator[HttpConfigClient]:
    client = HttpConfigClient("127.0.0.1", http_daemon["_port"], "user", "pw")
    yield client
    await client.aclose()


# --- fake-daemon lane (varied state over the wire) ---------------------------


async def test_pipeline_rows_group_indexed_fields_by_row(matrix_client: HttpConfigClient) -> None:
    form = await matrix_client.get_matrix()
    assert form["rows"][1]["source"] == "1"


async def test_pipeline_row_carries_its_process_string(
    matrix_client: HttpConfigClient, http_daemon: dict[str, Any]
) -> None:
    http_daemon["process_0"] = "iir:type=peak;f=1000;q=1;g=-3,impulse.wav"
    form = await matrix_client.get_matrix()
    assert form["rows"][0]["process"] == "iir:type=peak;f=1000;q=1;g=-3,impulse.wav"


async def test_gainunit_survives_daemons_malformed_option_markup(matrix_client: HttpConfigClient) -> None:
    form = await matrix_client.get_matrix()
    assert form["rows"][0]["gainunit"] == "dB"


async def test_row_fields_do_not_leak_into_flat_fields(matrix_client: HttpConfigClient) -> None:
    form = await matrix_client.get_matrix()
    assert not [f for f in form["fields"] if f["name"].startswith(("source_", "gain_", "process_"))]


async def test_global_matrix_controls_stay_flat_fields(matrix_client: HttpConfigClient) -> None:
    form = await matrix_client.get_matrix()
    assert {f["name"] for f in form["fields"]} >= {"enabled", "engine", "expand_hf", "iir2fir"}


async def test_profile_datalist_captures_a_saved_profile_name(matrix_client: HttpConfigClient) -> None:
    form = await matrix_client.get_matrix()
    assert "Mch-to-Stereo mixdown" in [o["value"] for o in form["profiles"]["options"]]


async def test_profile_datalist_leads_with_the_unnamed_default(matrix_client: HttpConfigClient) -> None:
    form = await matrix_client.get_matrix()
    assert form["profiles"]["options"][0]["value"] == ""


async def test_active_profile_label_is_parsed(matrix_client: HttpConfigClient) -> None:
    form = await matrix_client.get_matrix()
    assert form["active"] == "[Default]"


# --- captured-real-page lane (the daemon's actual bytes) ---------------------


def test_real_page_yields_one_row_per_pipeline() -> None:
    assert len(parse_matrix_form(REAL_PAGE)["rows"]) == 2


def test_real_page_row_reads_its_selected_source_channel() -> None:
    assert parse_matrix_form(REAL_PAGE)["rows"][1]["source"] == "1"


def test_real_page_gainunit_parses_despite_malformed_markup() -> None:
    assert parse_matrix_form(REAL_PAGE)["rows"][0]["gainunit"] == "dB"


def test_real_page_active_profile_is_the_default() -> None:
    assert parse_matrix_form(REAL_PAGE)["active"] == "[Default]"


def test_real_page_datalist_carries_the_saved_profile() -> None:
    assert "Mch-to-Stereo mixdown" in [o["value"] for o in parse_matrix_form(REAL_PAGE)["profiles"]["options"]]


def test_real_page_engine_select_reads_current_value() -> None:
    engine = next(f for f in parse_matrix_form(REAL_PAGE)["fields"] if f["name"] == "engine")
    assert engine["value"] == "1"


def test_page_without_profile_input_yields_no_profiles() -> None:
    assert (
        parse_matrix_form('<form method="post"><input type="checkbox" name="enabled" value="1"/></form>')["profiles"]
        is None
    )


# --- 4321 live lane ----------------------------------------------------------


async def test_matrix_list_profiles_includes_a_saved_profile(live_client: ControlClient) -> None:
    assert "Mch-to-Stereo mixdown" in await live_client.get_matrix_profiles()
