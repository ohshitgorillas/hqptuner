"""Matrix profiles (matrix-spec.md "Profiles") through the faithful fake.

Two lanes, and neither is the daemon's own profile CRUD. A load is the live 4321
``MatrixSetProfile``; a save or a delete is a staged ``<matrix_profile>`` config
edit riding the restore lane, because hqplayerd registers a saved profile in
memory only and never writes the element — so a profile saved its way is gone at
the next daemon start (round 5).

The fake adopts and re-renders the profile elements of an uploaded config, which
is the daemon reading its saved profiles back from its config file. It never
interprets the rows, so only a writer producing XML the real daemon would store
round-trips here.
"""

import json
from typing import Any

from hqptuner.control import ControlClient
from hqptuner.manager import ConnectionManager

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "-3", "gainunit": "dB", "mixdown": "1", "process": ""}


def save(name: str, *rows: dict[str, str]) -> dict[str, str]:
    """The staged save field: a name and the rows to store under it."""
    return {"matrix_profile_save": json.dumps({"name": name, "rows": list(rows) or [ROW0]})}


async def saved_profiles(manager: ConnectionManager) -> dict[str, list[dict[str, str]]]:
    """The profiles the running config carries, read back from the daemon."""
    cfg = await manager.load_file_config()
    return json.loads(cfg["matrix_profiles"])


async def test_live_load_reads_back_from_state(live_client: ControlClient) -> None:
    await live_client.set_matrix_profile("Mch-to-Stereo mixdown")
    assert (await live_client.get_state())["matrix_profile"] == "Mch-to-Stereo mixdown"


async def test_saved_profile_reaches_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save("Crossfeed EQ", ROW0, ROW1))
    assert "Crossfeed EQ" in await saved_profiles(http_manager)


async def test_saved_profile_carries_its_rows(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save("Crossfeed EQ", ROW0, ROW1))
    assert (await saved_profiles(http_manager))["Crossfeed EQ"][1]["gain"] == "-3"


async def test_saved_profile_row_count_is_its_own(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save("One row", ROW0))
    assert len((await saved_profiles(http_manager))["One row"]) == 1


async def test_save_reports_applied(http_manager: ConnectionManager) -> None:
    report = await http_manager.apply({}, save("Crossfeed EQ", ROW0))
    assert report["persistent"]["applied"] is True


async def test_save_to_an_existing_name_replaces_it(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save("Stock", {**ROW0, "gain": "-9"}))
    assert (await saved_profiles(http_manager))["Stock"][0]["gain"] == "-9"


async def test_save_to_an_existing_name_does_not_duplicate_it(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save("Stock", ROW0))
    assert len(await saved_profiles(http_manager)) == 1


async def test_save_leaves_the_live_pipelines_untouched(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save("Crossfeed EQ", {**ROW0, "gain": "-9"}, ROW1))
    assert json.loads((await http_manager.load_file_config())["matrix_pipelines"])[0]["gain"] == "0"


async def test_save_leaves_post_process_untouched(http_manager: ConnectionManager, http_daemon: dict[str, Any]) -> None:
    await http_manager.apply({}, save("Crossfeed EQ", ROW0))
    assert http_daemon["post_bauer_enabled"] is True


async def test_delete_removes_the_profile_from_the_running_config(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"matrix_profile_delete": "Stock"})
    assert "Stock" not in await saved_profiles(http_manager)


async def test_deleting_an_unknown_profile_still_applies(http_manager: ConnectionManager) -> None:
    # a profile the daemon holds in memory only has no element to remove, and the
    # edit's whole intent — "not in the config" — is already satisfied
    report = await http_manager.apply({}, {"matrix_profile_delete": "never saved"})
    assert report["persistent"]["applied"] is True


async def test_a_profile_survives_an_unrelated_apply(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save("Crossfeed EQ", ROW0))
    await http_manager.apply({}, {"matrix_engine": "0"})
    assert "Crossfeed EQ" in await saved_profiles(http_manager)


async def test_an_empty_profile_name_is_refused_before_any_write(http_manager: ConnectionManager) -> None:
    report = await http_manager.apply({}, save("   ", ROW0))
    assert report["persistent"]["submitted"] is False


async def test_a_control_character_in_a_profile_name_is_refused(http_manager: ConnectionManager) -> None:
    report = await http_manager.apply({}, save("bad\x07name", ROW0))
    assert report["persistent"]["submitted"] is False


async def test_a_quote_in_a_profile_name_survives_the_round_trip(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, save('12" driver', ROW0))
    assert '12" driver' in await saved_profiles(http_manager)


async def test_an_invalid_row_in_a_save_is_refused_before_any_write(http_manager: ConnectionManager) -> None:
    report = await http_manager.apply({}, save("Crossfeed EQ", {**ROW0, "gain": "loud"}))
    assert report["persistent"]["submitted"] is False
