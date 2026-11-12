"""A stored name is refused when the Windows build cannot make a file or a stream of it.

The Windows build refuses a colon (an NTFS alternate data stream) and a reserved device name in a name being stored,
while the Linux and macOS builds accept both. The platform is handed in, so no test patches ``sys.platform``. Names
already in a store stay readable and deletable on every platform: the checks apply where a name enters a store.
"""

import contextlib
from pathlib import Path, PureWindowsPath

import pytest
from fastapi.testclient import TestClient

from hqptuner.presets import names
from hqptuner.presets.store.live import InvalidSnapshotNameError, LivePresetStore, LiveRecord
from hqptuner.presets.store.presets import InvalidPresetNameError, PresetError, PresetStore

WINDOWS = "win32"
LINUX = "linux"

RECORD = LiveRecord(chain="pcm", fields={"filter": "37"}, names={"filter": "poly-sinc-gauss-long"})


def stored(name: str, platform: str) -> str:
    """What the new-name rule returns for ``name`` on ``platform``."""
    return names.validate_stored_name(name, InvalidPresetNameError, "preset", platform)


@pytest.mark.parametrize("name", ["a:b", "D:foo", "CON", "con", "NUL.txt", "COM1", "LPT¹"])
def test_the_windows_build_refuses_a_colon_or_a_device_name(name: str) -> None:
    with pytest.raises(InvalidPresetNameError):
        stored(name, WINDOWS)


@pytest.mark.parametrize("name", ["a:b", "CON"])
def test_the_linux_build_accepts_a_colon_and_a_device_name(name: str) -> None:
    assert stored(name, LINUX) == name


@pytest.mark.parametrize("name", ["CONSOLE", "COM10"])
def test_the_windows_build_accepts_a_name_that_only_starts_like_a_device(name: str) -> None:
    assert stored(name, WINDOWS) == name


def test_a_windows_refusal_carries_the_name_invalid_code() -> None:
    with pytest.raises(InvalidPresetNameError) as raised:
        stored("a:b", WINDOWS)
    assert raised.value.code == "name_invalid"


@pytest.fixture
def snapshots_with_a_colon_name(tmp_path: Path) -> Path:
    """A live-snapshot file a Linux build saved, holding ``A:B`` and ``keep``."""
    path = tmp_path / "live-presets.json"
    store = LivePresetStore(path, platform=LINUX)
    store.save("A:B", RECORD)
    store.save("keep", RECORD)
    return path


def test_a_windows_store_still_reads_a_colon_name_it_already_holds(snapshots_with_a_colon_name: Path) -> None:
    store = LivePresetStore(snapshots_with_a_colon_name, platform=WINDOWS)
    assert store.read("A:B").chain == RECORD.chain


def test_a_windows_store_still_deletes_a_colon_name_it_already_holds(snapshots_with_a_colon_name: Path) -> None:
    store = LivePresetStore(snapshots_with_a_colon_name, platform=WINDOWS)
    store.delete("A:B")
    assert list(store.all()) == ["keep"]


def test_a_windows_store_refuses_to_save_a_new_colon_name(tmp_path: Path) -> None:
    store = LivePresetStore(tmp_path / "live-presets.json", platform=WINDOWS)
    with pytest.raises(InvalidSnapshotNameError):
        store.save("C:D", RECORD)


def test_a_windows_first_connect_migration_skips_a_colon_name_and_imports_the_rest(tmp_path: Path) -> None:
    store = PresetStore(tmp_path / "presets", platform=WINDOWS)
    assert store.import_missing({"a:b": b"<hqplayerd/>", "ok": b"<hqplayerd/>"}) == ["ok"]


def test_a_preset_saved_under_a_colon_name_on_this_platform_reads_back(http_client: TestClient) -> None:
    http_client.post("/api/profile/save", json={"name": "a:b"})
    assert http_client.get("/api/preset/a:b").status_code == 200


# --- a preset path stays inside its store ---------------------------------------

OUTSIDE = b"<outside/>"
PAYLOAD = b"<hqplayerd/>"


@pytest.fixture
def store_with_a_link_out(tmp_path: Path) -> tuple[PresetStore, Path]:
    """A store whose directory holds ``evil.xml``, a symlink to a file that lies outside the store."""
    outside = tmp_path / "outside.xml"
    outside.write_bytes(OUTSIDE)
    directory = tmp_path / "presets"
    directory.mkdir()
    (directory / "evil.xml").symlink_to(outside)
    return PresetStore(directory), outside


def test_reading_a_preset_that_links_outside_the_store_is_refused(
    store_with_a_link_out: tuple[PresetStore, Path],
) -> None:
    store, _outside = store_with_a_link_out
    with pytest.raises(InvalidPresetNameError):
        store.read("evil")


def test_saving_over_a_preset_that_links_outside_the_store_leaves_the_outside_file_alone(
    store_with_a_link_out: tuple[PresetStore, Path],
) -> None:
    store, outside = store_with_a_link_out
    with contextlib.suppress(PresetError):
        store.save("evil", PAYLOAD)
    assert outside.read_bytes() == OUTSIDE


def test_a_store_reached_through_a_symlinked_directory_still_saves_and_reads(tmp_path: Path) -> None:
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real)
    store = PresetStore(link)
    store.save("Studio", PAYLOAD)
    assert store.read("Studio") == PAYLOAD


@pytest.mark.parametrize(("file", "inside"), [("foo.xml", True), ("D:foo.xml", False)])
def test_a_name_joined_under_windows_lies_inside_the_store_unless_it_names_another_drive(
    file: str, *, inside: bool
) -> None:
    store = PureWindowsPath("C:\\store")
    assert names.lies_inside(store, store / file) is inside
