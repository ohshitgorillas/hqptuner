"""Matrix pipeline editing through the faithful fake (matrix-spec §8 step 3).

The pipeline set stages as one atomic ``matrix_pipelines`` JSON field; the
restore lane replaces the ``<matrix>`` element's ``<pipeline>`` children and the
verify step reads them back from the running config. The fake serves adopted
rows verbatim (no interpretation), so only a writer that produces XML the real
daemon would store round-trips."""

import json

from hqptuner.manager import ConnectionManager

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "0", "gainunit": "dB", "mixdown": "1", "process": ""}


def rows_json(*rows: dict[str, str]) -> str:
    return json.dumps(list(rows))


async def applied_rows(http_manager: ConnectionManager) -> list[dict[str, str]]:
    cfg = await http_manager.load_file_config()
    return json.loads(cfg["matrix_pipelines"])


async def test_pipeline_gain_edit_reaches_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-7.8"}, ROW1)})
    assert (await applied_rows(http_manager))[0]["gain"] == "-7.8"


async def test_pipeline_row_add_reaches_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json(ROW0, ROW1, {**ROW1, "mixdown": "0"})})
    assert len(await applied_rows(http_manager)) == 3


async def test_pipeline_row_remove_reaches_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json(ROW0)})
    assert len(await applied_rows(http_manager)) == 1


async def test_linear_gain_unit_round_trips(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply(
        {}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-1", "gainunit": "Lin"}, ROW1)}
    )
    assert (await applied_rows(http_manager))[0]["gainunit"] == "Lin"


async def test_negative_linear_gain_value_survives(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply(
        {}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-1", "gainunit": "Lin"}, ROW1)}
    )
    assert (await applied_rows(http_manager))[0]["gain"] == "-1"


async def test_process_string_with_xml_specials_round_trips(http_manager: ConnectionManager) -> None:
    process = 'iir:type=peak;f=1000;q=1;g=-3,"a & b".wav'
    await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json({**ROW0, "process": process}, ROW1)})
    assert (await applied_rows(http_manager))[0]["process"] == process


async def test_pipeline_apply_reports_applied(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "1.5"}, ROW1)})
    assert report["persistent"]["applied"] is True


async def test_pipeline_apply_leaves_other_settings_untouched(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-3"}, ROW1)})
    assert (await http_manager.load_file_config())["channels"] == "2"


async def test_invalid_gain_is_refused_before_any_write(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "loud"})})
    assert report["persistent"]["submitted"] is False


async def test_out_of_range_channel_is_refused_before_any_write(http_manager: ConnectionManager) -> None:
    report = await http_manager.applyops.apply({}, {"matrix_pipelines": rows_json({**ROW0, "source": "128"})})
    assert report["persistent"]["submitted"] is False


async def test_matrix_engine_field_reaches_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.applyops.apply({}, {"matrix_engine": "0"})
    assert (await http_manager.load_file_config())["matrix_engine"] == "0"
