"""Auto-save to active preset (docs/testing.md — behavior only, one assertion
per test, public API only, fakes speak the wire protocol).

The flag lives in the preset store on disk, not in any browser. With it on and
a preset active, every successful write — staged apply, engine overrides,
speakers, live control-lane write — folds back into that preset's snapshot and
reports ``autosaved``; the mirror ``data/cfgs/<name>.xml`` rides the apply's
own restore archive so auto-save costs no restart of its own. It is
best-effort: a failed fold never fails the write it followed."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

from conftest import wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.presets.store.presets import PresetStore


def _autosave_on_with_active(client: TestClient, name: str = "Kept") -> None:
    """The way in: save the running config as a named preset (which makes it
    active), then flip the store flag over the REST surface."""
    client.post("/api/profile/save", json={"name": name})
    client.post("/api/autosave", json={"enabled": True})


# --- the flag itself --------------------------------------------------------


def test_fresh_store_reports_autosave_off(http_client: TestClient) -> None:
    http_client.post("/api/config/refresh")  # /config only serves once the forms are fetched
    assert http_client.get("/api/config").json()["data"]["autosave"] is False


def test_enabling_autosave_answers_the_new_flag(http_client: TestClient) -> None:
    assert http_client.post("/api/autosave", json={"enabled": True}).json()["autosave"] is True


def test_enabled_autosave_shows_in_the_config_payload(http_client: TestClient) -> None:
    http_client.post("/api/config/refresh")  # /config only serves once the forms are fetched
    http_client.post("/api/autosave", json={"enabled": True})
    assert http_client.get("/api/config").json()["data"]["autosave"] is True


def test_autosave_flag_persists_across_store_instances(tmp_path: Path) -> None:
    PresetStore(tmp_path / "presets").set_autosave(enabled=True)
    assert PresetStore(tmp_path / "presets").autosave is True


def test_autosave_defaults_off_on_an_unwritten_directory(tmp_path: Path) -> None:
    assert PresetStore(tmp_path / "presets").autosave is False


# --- staged apply -----------------------------------------------------------


def test_apply_with_autosave_off_reports_no_autosave(http_client: TestClient) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    assert "autosaved" not in http_client.post("/api/config/apply").json()


def test_apply_with_no_active_preset_reports_no_autosave(http_client: TestClient) -> None:
    http_client.post("/api/autosave", json={"enabled": True})
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    assert "autosaved" not in http_client.post("/api/config/apply").json()


def test_apply_with_no_active_preset_writes_no_preset_file(http_client: TestClient, tmp_path: Path) -> None:
    http_client.post("/api/autosave", json={"enabled": True})
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert list((tmp_path / "presets").glob("*.xml")) == []


def test_apply_with_autosave_on_reports_the_fold_into_the_active_preset(http_client: TestClient) -> None:
    _autosave_on_with_active(http_client)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    autosaved = http_client.post("/api/config/apply").json()["autosaved"]
    assert (autosaved["name"], autosaved["ok"]) == ("Kept", True)


def test_autosaved_apply_lands_the_new_value_in_the_preset_snapshot(http_client: TestClient) -> None:
    _autosave_on_with_active(http_client)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert http_client.get("/api/preset/Kept").json()["config"]["title"] == "Renamed"


def test_apply_with_an_explicit_save_target_skips_the_autosave(http_client: TestClient) -> None:
    # the full save already covered the active preset; a second entry would
    # double-report one write
    _autosave_on_with_active(http_client)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    assert "autosaved" not in http_client.post("/api/config/apply", json={"save": {"name": "Kept"}}).json()


# --- the daemon-side mirror rides the apply's own restore -------------------


def test_autosaved_apply_carries_the_mirror_in_its_restore(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    _autosave_on_with_active(http_client)
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert "data/cfgs/Kept.xml" in http_daemon["_restore_members"]


def test_plain_apply_with_autosave_off_carries_no_mirror(http_client: TestClient, http_daemon: dict[str, Any]) -> None:
    http_client.post("/api/profile/save", json={"name": "Kept"})
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert "data/cfgs/Kept.xml" not in http_daemon["_restore_members"]


# --- the other write routes fold back too -----------------------------------


def test_engine_apply_with_autosave_on_reports_the_fold(http_client: TestClient) -> None:
    _autosave_on_with_active(http_client)
    resp = http_client.post("/api/engine", json={"overrides": {"cuda": "0"}})
    assert resp.json()["autosaved"]["ok"] is True


def test_speakers_apply_with_autosave_on_reports_the_fold(http_client: TestClient) -> None:
    _autosave_on_with_active(http_client)
    resp = http_client.post("/api/speakers", json={"enabled": True, "channels": {"0": {"level": "-3"}}})
    assert resp.json()["autosaved"]["ok"] is True


# --- live writes: never touch the config file, still fold into the preset ---


def _dual_lane_client(control_port: int, http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[TestClient]:
    """Both lanes at once: control on the threaded fake 4321 daemon, http on
    the fake 8088 daemon — the shape a live write needs before its autosave can
    fetch a config archive to fold into (conftest ``_live_app``/``http_client``
    pattern)."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg)) as client:
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        yield client


def test_live_write_with_autosave_on_reports_the_fold(
    threaded_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    for client in _dual_lane_client(threaded_daemon_port, http_daemon, tmp_path):
        _autosave_on_with_active(client)
        report = client.post("/api/config/live", json={"fields": {"filter": "25"}}).json()
    assert report["autosaved"]["ok"] is True


def test_autosaved_live_write_sends_no_restore_to_the_daemon(
    threaded_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # asserted at the wire: the fold rides no restore, so a live write with
    # auto-save on never restarts the daemon (auto-save costs no restart)
    for client in _dual_lane_client(threaded_daemon_port, http_daemon, tmp_path):
        _autosave_on_with_active(client)
        before = http_daemon.get("_restore_attempts", 0)
        client.post("/api/config/live", json={"fields": {"filter": "25"}})
        after = http_daemon.get("_restore_attempts", 0)
    assert after == before


def test_live_preset_apply_with_autosave_on_reports_the_fold(
    threaded_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    for client in _dual_lane_client(threaded_daemon_port, http_daemon, tmp_path):
        _autosave_on_with_active(client)
        client.put("/api/livepresets/Snap")  # snapshot the running engine
        report = client.post("/api/livepresets/Snap/apply").json()
    assert report["autosaved"]["ok"] is True


def test_autosaved_live_write_lands_in_the_preset_snapshot(
    threaded_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # a live write never touches the daemon's config file; the fold is the only
    # thing that keeps the preset from going stale for exactly those settings
    for client in _dual_lane_client(threaded_daemon_port, http_daemon, tmp_path):
        _autosave_on_with_active(client)
        client.post("/api/config/live", json={"fields": {"filter": "25"}})
        saved = client.get("/api/preset/Kept").json()["config"]["filter"]
    assert saved == "25"


# --- best-effort: a failed fold never fails the write it followed -----------


def _point_autosave_at(preset_dir: Path, name: str = "Kept") -> None:
    """Arm auto-save on a credential-less app from outside: the store is a
    per-directory fact, so a second ``PresetStore`` on the app's preset
    directory flips the flag and points the active preset."""
    store = PresetStore(preset_dir)
    store.save(name, b"<hqplayerd/>")
    store.set_active(name)
    store.set_autosave(enabled=True)


def test_live_write_still_succeeds_when_autosave_cannot(live_api: TestClient, tmp_path: Path) -> None:
    # no http credentials, so no config archive can be fetched to fold into
    _point_autosave_at(tmp_path / "presets")
    assert live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}}).status_code == 200


def test_failed_autosave_reports_not_ok(live_api: TestClient, tmp_path: Path) -> None:
    _point_autosave_at(tmp_path / "presets")
    report = live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}}).json()
    assert report["autosaved"]["ok"] is False


def test_failed_autosave_carries_an_error_string(live_api: TestClient, tmp_path: Path) -> None:
    _point_autosave_at(tmp_path / "presets")
    err = live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}}).json()["autosaved"]["error"]
    assert isinstance(err, str) and err
