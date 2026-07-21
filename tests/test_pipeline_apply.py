"""Matrix pipeline editing through the faithful fake (matrix-spec §8 step 3).

The pipeline set stages as one atomic ``matrix_pipelines`` JSON field; the
restore lane replaces the ``<matrix>`` element's ``<pipeline>`` children and the
verify step reads them back from the running config. The fake serves adopted
rows verbatim (no interpretation), so only a writer that produces XML the real
daemon would store round-trips."""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from hqptuner.config import Config
from hqptuner.manager import ConnectionManager

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "0", "gainunit": "dB", "mixdown": "1", "process": ""}


@pytest.fixture
async def manager(http_daemon: dict[str, Any], tmp_path: Path) -> AsyncIterator[ConnectionManager]:
    from hqptuner.conf.httpconf import HttpConfigClient

    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    mgr = ConnectionManager(Config(alarm_threshold=1.0, backup_dir=tmp_path), http)
    yield mgr
    await http.aclose()


def rows_json(*rows: dict[str, str]) -> str:
    return json.dumps(list(rows))


async def applied_rows(manager: ConnectionManager) -> list[dict[str, str]]:
    cfg = await manager.load_file_config()
    return json.loads(cfg["matrix_pipelines"])


async def test_pipeline_gain_edit_reaches_the_running_config(manager: ConnectionManager) -> None:
    await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-7.8"}, ROW1)})
    assert (await applied_rows(manager))[0]["gain"] == "-7.8"


async def test_pipeline_row_add_reaches_the_running_config(manager: ConnectionManager) -> None:
    await manager.apply({}, {"matrix_pipelines": rows_json(ROW0, ROW1, {**ROW1, "mixdown": "0"})})
    assert len(await applied_rows(manager)) == 3


async def test_pipeline_row_remove_reaches_the_running_config(manager: ConnectionManager) -> None:
    await manager.apply({}, {"matrix_pipelines": rows_json(ROW0)})
    assert len(await applied_rows(manager)) == 1


async def test_linear_gain_unit_round_trips(manager: ConnectionManager) -> None:
    await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-1", "gainunit": "Lin"}, ROW1)})
    assert (await applied_rows(manager))[0]["gainunit"] == "Lin"


async def test_negative_linear_gain_value_survives(manager: ConnectionManager) -> None:
    await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-1", "gainunit": "Lin"}, ROW1)})
    assert (await applied_rows(manager))[0]["gain"] == "-1"


async def test_process_string_with_xml_specials_round_trips(manager: ConnectionManager) -> None:
    process = 'iir:type=peak;f=1000;q=1;g=-3,"a & b".wav'
    await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "process": process}, ROW1)})
    assert (await applied_rows(manager))[0]["process"] == process


async def test_pipeline_apply_reports_applied(manager: ConnectionManager) -> None:
    report = await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "1.5"}, ROW1)})
    assert report["persistent"]["applied"] is True


async def test_pipeline_apply_leaves_other_settings_untouched(manager: ConnectionManager) -> None:
    await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "-3"}, ROW1)})
    assert (await manager.load_file_config())["channels"] == "2"


async def test_invalid_gain_is_refused_before_any_write(manager: ConnectionManager) -> None:
    report = await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "gain": "loud"})})
    assert report["persistent"]["submitted"] is False


async def test_out_of_range_channel_is_refused_before_any_write(manager: ConnectionManager) -> None:
    report = await manager.apply({}, {"matrix_pipelines": rows_json({**ROW0, "source": "128"})})
    assert report["persistent"]["submitted"] is False


async def test_matrix_engine_field_reaches_the_running_config(manager: ConnectionManager) -> None:
    await manager.apply({}, {"matrix_engine": "0"})
    assert (await manager.load_file_config())["matrix_engine"] == "0"
