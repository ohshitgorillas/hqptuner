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
from conftest import StartManager
from narrow import present

from hqptuner.api.routes.matrix.matrix import matrix as matrix_report
from hqptuner.conf.formparse import parse_matrix_form
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.engine.control import ControlClient
from hqptuner.lanes import matrixlane

REAL_PAGE = (Path(__file__).parent.parent / "support" / "fixtures" / "matrix-6.0.4.html").read_text()

#: A matrix form with no profile input at all.
BARE_PAGE = '<form method="post"><input type="checkbox" name="enabled" value="1"/></form>'

#: The profile datalist as the fake and the captured 6.0.4 page both carry it:
#: the unnamed default first, then the saved profiles.
DATALIST = ["", "Default", "Mch-to-Stereo mixdown"]


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


@pytest.mark.parametrize(
    ("name", "flat"),
    [
        *((control, True) for control in ("enabled", "engine", "expand_hf", "iir2fir")),
        *((row_field, False) for row_field in ("source_0", "gain_0", "process_0")),
    ],
)
async def test_a_global_control_is_a_flat_field_and_a_row_field_is_not(
    matrix_client: HttpConfigClient, name: str, *, flat: bool
) -> None:
    form = await matrix_client.get_matrix()
    assert (name in {f["name"] for f in form["fields"]}) is flat


async def test_profile_datalist_leads_with_the_unnamed_default_then_the_saved_profiles(
    matrix_client: HttpConfigClient,
) -> None:
    form = await matrix_client.get_matrix()
    assert [o["value"] for o in present(form["profiles"])["options"]] == DATALIST


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


def test_real_page_engine_select_reads_current_value() -> None:
    engine = next(f for f in parse_matrix_form(REAL_PAGE)["fields"] if f["name"] == "engine")
    assert engine["value"] == "1"


def _profile_values(page: str) -> list[str] | None:
    """The profile datalist's option values a page carries, or None for a page with no profile input."""
    profiles = parse_matrix_form(page)["profiles"]
    return None if profiles is None else [o["value"] for o in profiles["options"]]


@pytest.mark.parametrize(("page", "values"), [(BARE_PAGE, None), (REAL_PAGE, DATALIST)], ids=["bare", "real"])
def test_only_a_page_with_a_profile_input_yields_its_profiles(page: str, values: list[str] | None) -> None:
    assert _profile_values(page) == values


# --- 4321 live lane ----------------------------------------------------------


async def test_matrix_list_profiles_includes_a_saved_profile(live_client: ControlClient) -> None:
    assert "Mch-to-Stereo mixdown" in await live_client.get_matrix_profiles()


# --- MatrixReport, read off the `matrix` route function directly -------------


async def test_matrix_report_carries_the_daemons_live_profile_names(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    manager = await start_manager(http_daemon["_port"])
    assert matrix_report(manager).data.live_profiles == ["Default", "Mch-to-Stereo mixdown"]


async def test_matrix_report_reads_the_live_active_profile_from_state(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    manager = await start_manager(http_daemon["_port"])
    await matrixlane.switch_profile(manager, "Default")
    assert matrix_report(manager).data.live_active == "Default"


async def test_matrix_report_carries_the_config_files_saved_profiles(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    manager = await start_manager(http_daemon["_port"])
    assert "Stock" in matrix_report(manager).data.file_profiles
