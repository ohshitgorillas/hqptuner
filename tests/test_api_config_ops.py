"""Persistent-config REST operations end to end through the faithful fake 8088
daemon (conftest `http_client`): backup/restore, engine attributes, preset CRUD,
Apply & Save, speaker apply, filter uploads, device rescan, and the log tail.
A route passes only if the fake daemon adopted (or served) the real wire traffic
— never by inspecting our own internals (docs/testing.md)."""

import io
import zipfile
from typing import Any

from fastapi.testclient import TestClient

# --- backup / restore ---------------------------------------------------------


def test_backup_is_served_as_a_zip_download(http_client: TestClient) -> None:
    assert http_client.get("/api/backup").headers["content-type"] == "application/zip"


def test_backup_archive_carries_the_working_config(http_client: TestClient) -> None:
    archive = zipfile.ZipFile(io.BytesIO(http_client.get("/api/backup").content))
    assert "hqplayerd.xml" in archive.namelist()


def test_restore_reports_the_restored_upload(http_client: TestClient) -> None:
    data = http_client.get("/api/backup").content
    resp = http_client.post("/api/restore", files={"cfgfile": ("settings.zip", data, "application/zip")})
    assert resp.json()["restored"] is True


def test_device_rescan_reports_refreshed(http_client: TestClient) -> None:
    assert http_client.post("/api/config/refresh").json()["refreshed"] is True


def test_device_rescan_makes_the_config_form_available(http_client: TestClient) -> None:
    # the rescan refetches the forms, so /config serves even though the manager
    # never completed a control-lane connect
    http_client.post("/api/config/refresh")
    assert http_client.get("/api/config").status_code == 200


# --- engine attributes (config-file-only lane) ----------------------------------


def test_engine_read_serves_the_hardware_attrs(http_client: TestClient) -> None:
    assert http_client.get("/api/engine").json()["engine"]["cuda"] == "1"


def test_engine_apply_submits_the_override(http_client: TestClient) -> None:
    assert http_client.post("/api/engine", json={"overrides": {"cuda": "0"}}).json()["submitted"] is True


def test_engine_apply_with_nothing_to_change_is_rejected(http_client: TestClient) -> None:
    assert http_client.post("/api/engine", json={"overrides": {}}).status_code == 400


def test_engine_apply_rejects_an_unknown_attribute(http_client: TestClient) -> None:
    assert http_client.post("/api/engine", json={"overrides": {"bogus": "1"}}).status_code == 422


def test_engine_apply_rejects_a_value_outside_its_domain(http_client: TestClient) -> None:
    assert http_client.post("/api/engine", json={"overrides": {"cuda": "5"}}).status_code == 422


# --- preset CRUD over REST ------------------------------------------------------


def test_profile_save_persists_a_named_preset(http_client: TestClient) -> None:
    assert http_client.post("/api/profile/save", json={"name": "Kept"}).json()["ok"] is True


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


def test_a_preset_name_carrying_a_path_separator_is_not_found(http_client: TestClient) -> None:
    # reaching the empty name must not also let a name walk out of the store:
    # presetstore's name validation is what refuses this, and it still does
    assert http_client.get("/api/preset/sub/Kept").status_code == 404


def test_profile_load_activates_the_stored_preset(http_client: TestClient) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    assert http_client.post("/api/profile/load", json={"name": "Kept"}).json()["active"] is True


def test_loading_a_missing_preset_is_not_found(http_client: TestClient) -> None:
    assert http_client.post("/api/profile/load", json={"name": "Nope"}).status_code == 404


def test_preset_delete_reports_ok(http_client: TestClient) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    assert http_client.delete("/api/preset/Kept").json()["ok"] is True


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
    assert resp.json()["saved"]["ok"] is True


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


def test_apply_switches_to_the_previewed_preset(http_client: TestClient) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    resp = http_client.post("/api/config/apply", json={"switch_to": "Kept"})
    assert resp.json()["switched"]["active"] is True


# --- applying "(no preset)": drop the bookmark, leave the daemon alone ---------
#
# HQPlayer runs one settings file whether a preset is active or not, and nobody
# ever stored a before-the-preset copy — so unloading cannot mean "put the old
# settings back". It drops HQPTuner's active-preset bookmark and touches nothing
# else: no restore, no restart, no backup fetch.


def test_applying_no_preset_clears_the_active_preset(http_client: TestClient) -> None:
    http_client.post("/api/config/refresh")  # /config only serves once the forms are fetched
    http_client.post("/api/profile/save", json={"name": "Kept"})
    http_client.post("/api/config/apply", json={"switch_to": ""})
    assert http_client.get("/api/config").json()["data"]["active"] == ""


def test_applying_no_preset_reports_the_switch_as_taken(http_client: TestClient) -> None:
    # the report is what keeps the staging buffer: a switch that reads as not
    # taken makes the apply a soft failure and the picker snaps back
    http_client.post("/api/profile/save", json={"name": "Kept"})
    switched = http_client.post("/api/config/apply", json={"switch_to": ""}).json()["switched"]
    assert (switched["name"], switched["active"]) == ("", True)


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
    assert resp.json()["applied"] is True


def test_speakers_apply_rejects_an_out_of_range_level(http_client: TestClient) -> None:
    resp = http_client.post("/api/speakers", json={"channels": {"0": {"level": "999"}}})
    assert resp.status_code == 422


# --- convolution filter uploads --------------------------------------------------


def test_filter_upload_returns_the_daemon_home_path(http_client: TestClient) -> None:
    resp = http_client.post("/api/matrix/filter", files={"file": ("probe.wav", b"RIFF", "audio/wav")})
    assert resp.json()["path"] == "/x/home/probe.wav"


def test_filter_upload_refuses_a_non_filter_extension(http_client: TestClient) -> None:
    resp = http_client.post("/api/matrix/filter", files={"file": ("payload.exe", b"MZ", "application/x-dos")})
    assert resp.status_code == 422


# --- log tail --------------------------------------------------------------------


def test_log_tail_serves_the_daemons_log(http_client: TestClient) -> None:
    assert http_client.get("/api/log", params={"lines": 5}).json()["lines"][-1] == "log line 60"


def test_log_tail_clamps_the_requested_line_count_to_at_least_one(http_client: TestClient) -> None:
    assert len(http_client.get("/api/log", params={"lines": 0}).json()["lines"]) == 1
