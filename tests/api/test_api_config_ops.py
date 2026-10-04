"""Persistent-config REST operations end to end through the faithful fake 8088
daemon (conftest `http_client`): backup/restore, engine attributes, preset CRUD,
Apply & Save, speaker apply, filter uploads, device rescan, and the log tail.
A route passes only if the fake daemon adopted (or served) the real wire traffic
— never by inspecting our own internals (docs/testing.md)."""

import io
import zipfile
from typing import Any

import pytest
from conftest import minimal_wave
from fastapi.testclient import TestClient
from narrow import FixtureError

# --- backup / restore ---------------------------------------------------------


def test_backup_is_served_as_a_zip_download(http_client: TestClient) -> None:
    assert http_client.get("/api/backup").headers["content-type"] == "application/zip"


def test_backup_archive_carries_the_working_config(http_client: TestClient) -> None:
    archive = zipfile.ZipFile(io.BytesIO(http_client.get("/api/backup").content))
    assert "hqplayerd.xml" in archive.namelist()


def test_device_rescan_makes_the_config_form_available(http_client: TestClient) -> None:
    # the rescan refetches the forms, so /config serves even though the manager
    # never completed a control-lane connect
    http_client.post("/api/config/refresh")
    assert http_client.get("/api/config").status_code == 200


# --- engine attributes (config-file-only lane) ----------------------------------


def test_engine_read_serves_the_hardware_attrs(http_client: TestClient) -> None:
    assert http_client.get("/api/engine").json()["engine"]["cuda"] == "1"


def test_engine_apply_with_nothing_to_change_is_rejected(http_client: TestClient) -> None:
    assert http_client.post("/api/engine", json={"overrides": {}}).status_code == 400


def test_engine_apply_rejects_an_unknown_attribute(http_client: TestClient) -> None:
    assert http_client.post("/api/engine", json={"overrides": {"bogus": "1"}}).status_code == 422


def test_engine_apply_rejects_a_value_outside_its_domain(http_client: TestClient) -> None:
    assert http_client.post("/api/engine", json={"overrides": {"cuda": "5"}}).status_code == 422


# --- preset CRUD over REST ------------------------------------------------------


def test_profile_save_persists_a_named_preset(http_client: TestClient) -> None:
    assert http_client.post("/api/profile/save", json={"name": "Kept"}).json()["name"] == "Kept"


def test_saved_preset_previews_from_the_store(http_client: TestClient) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    assert http_client.get("/api/preset/Kept").json()["config"]["title"] == "Opal"


def test_previewing_a_missing_preset_is_not_found(http_client: TestClient) -> None:
    assert http_client.get("/api/preset/Nope").status_code == 404


# The picker's "(no preset)" option carries the EMPTY name, so its preview is
# `GET /api/preset/`. Starlette's default path convertor is `[^/]+`, which cannot
# match an empty segment: the request fell past the route into the SPA mount and
# came back as a bare 404, which the browser showed as "Failed: Error: Not
# found". The read lane had always served the empty name — it was unreachable
# over HTTP, so only a request through the app can pin this.


def test_the_no_preset_option_is_readable_over_http(http_client: TestClient) -> None:
    assert http_client.get("/api/preset/").status_code == 200


def test_the_no_preset_option_previews_the_running_config(http_client: TestClient) -> None:
    # nothing is stored under the empty name, so the preview is the config the
    # daemon is running right now — the fake's title
    assert http_client.get("/api/preset/").json()["config"]["title"] == "Opal"


def test_a_preset_name_carrying_a_path_separator_is_refused(http_client: TestClient) -> None:
    # reaching the empty name must not also let a name walk out of the store:
    # store.presets' name validation is what refuses this, and it still does
    assert http_client.get("/api/preset/sub/Kept").status_code == 422


@pytest.mark.parametrize("loaded", ["Kept", "Other"])
def test_profile_load_activates_the_stored_preset(http_client: TestClient, loaded: str) -> None:
    http_client.post("/api/config/refresh")  # /config only serves once the forms are fetched
    http_client.post("/api/profile/save", json={"name": "Kept"})
    http_client.post("/api/profile/save", json={"name": "Other"})
    http_client.post("/api/profile/load", json={"name": loaded})
    assert http_client.get("/api/config").json()["data"]["active"] == loaded


def test_loading_a_missing_preset_is_not_found(http_client: TestClient) -> None:
    assert http_client.post("/api/profile/load", json={"name": "Nope"}).status_code == 404


def test_preset_delete_reports_ok(http_client: TestClient) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    assert http_client.delete("/api/preset/Kept").json()["name"] == "Kept"


def test_deleting_a_missing_preset_is_not_found(http_client: TestClient) -> None:
    assert http_client.delete("/api/preset/Nope").status_code == 404


def test_profile_load_when_the_daemon_goes_down_is_bad_gateway(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    http_daemon["_down"] = True
    assert http_client.post("/api/profile/load", json={"name": "Kept"}).status_code == 502


# --- Apply & Save ---------------------------------------------------------------


def test_apply_and_save_reports_the_saved_preset(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    resp = http_client.post("/api/config/apply", json={"save": {"name": "Kept"}})
    assert resp.json()["saved"]["name"] == "Kept"


def test_apply_and_save_persists_the_applied_edit_into_the_preset(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply", json={"save": {"name": "Kept"}})
    assert http_client.get("/api/preset/Kept").json()["config"]["title"] == "Renamed"


def test_failed_apply_skips_the_save(http_client: TestClient) -> None:
    # the daemon refuses the staged value on restore, so nothing clean exists to
    # persist — a preset snapshot of a failed apply would freeze the wrong config
    http_client.post("/api/config/stage", json={"http": {"title": "REJECT"}})
    resp = http_client.post("/api/config/apply", json={"save": {"name": "Kept"}})
    assert "saved" not in resp.json()


# --- applying "(no preset)": drop the bookmark, leave the daemon alone ---------
#
# HQPlayer runs one settings file whether a preset is active or not, and nobody
# ever stored a before-the-preset copy — so unloading cannot mean "put the old
# settings back". It drops HQPTuner's active-preset bookmark and touches nothing
# else: no restore, no restart, no backup fetch.


def _active(client: TestClient) -> str:
    active: str = client.get("/api/config").json()["data"]["active"]
    return active


@pytest.mark.parametrize("switch_to", ["Kept", ""], ids=["a-preset", "no-preset"])
def test_applying_a_switch_sets_or_clears_the_active_preset(http_client: TestClient, switch_to: str) -> None:
    http_client.post("/api/config/refresh")  # /config only serves once the forms are fetched
    http_client.post("/api/profile/save", json={"name": "Kept"})
    http_client.post("/api/profile/save", json={"name": "Other"})
    if _active(http_client) != "Other":
        raise FixtureError(reason="saving Other did not make it the active preset to switch away from")
    http_client.post("/api/config/apply", json={"switch_to": switch_to})
    assert _active(http_client) == switch_to


def _switch_report(client: TestClient, switch_to: str) -> dict[str, Any]:
    client.post("/api/profile/save", json={"name": "Kept"})
    switched: dict[str, Any] = client.post("/api/config/apply", json={"switch_to": switch_to}).json()["report"][
        "switched"
    ]
    return switched


@pytest.mark.parametrize("switch_to", ["Kept", ""], ids=["a-preset", "no-preset"])
def test_applying_a_switch_reports_the_preset_it_switched_to(http_client: TestClient, switch_to: str) -> None:
    assert _switch_report(http_client, switch_to)["name"] == switch_to


def test_applying_no_preset_sends_no_restore_to_the_daemon(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    # asserted at the wire: the fake counts POST /restore arrivals, and an unload
    # that routed through the load path would restart the daemon mid-playback
    http_client.post("/api/profile/save", json={"name": "Kept"})
    before = http_daemon["_restore_attempts"]
    http_client.post("/api/config/apply", json={"switch_to": ""})
    assert http_daemon["_restore_attempts"] == before


# --- speaker processing apply ---------------------------------------------------


def test_speakers_apply_reports_the_verified_write(http_client: TestClient) -> None:
    resp = http_client.post("/api/speakers", json={"enabled": True, "channels": {"0": {"level": "-3"}}})
    assert resp.json()["report"]["applied"] is True


def test_speakers_apply_rejects_an_out_of_range_level(http_client: TestClient) -> None:
    resp = http_client.post("/api/speakers", json={"channels": {"0": {"level": "999"}}})
    assert resp.status_code == 422


# --- convolution filter uploads --------------------------------------------------


def test_filter_upload_returns_the_daemon_home_path(http_client: TestClient) -> None:
    resp = http_client.post("/api/matrix/filter", files={"file": ("probe.wav", minimal_wave(), "audio/wav")})
    assert resp.json()["path"] == "/x/home/probe.wav"


def test_filter_upload_refuses_a_non_filter_extension(http_client: TestClient) -> None:
    resp = http_client.post("/api/matrix/filter", files={"file": ("payload.exe", b"MZ", "application/x-dos")})
    assert resp.status_code == 422


# --- log tail --------------------------------------------------------------------


def test_log_tail_serves_the_daemons_log(http_client: TestClient) -> None:
    assert http_client.get("/api/log", params={"lines": 5}).json()["lines"][-1] == "log line 60"


def test_log_tail_clamps_the_requested_line_count_to_at_least_one(http_client: TestClient) -> None:
    assert len(http_client.get("/api/log", params={"lines": 0}).json()["lines"]) == 1
