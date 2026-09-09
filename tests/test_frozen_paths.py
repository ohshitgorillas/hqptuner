"""Where a frozen build reads and writes: the per-user store root, the bundled
asset root, the Config defaults built on them, and the entry point that serves
only when a caller asks it to.

PyInstaller's bootloader sets ``sys.frozen`` and points ``sys._MEIPASS`` at the
unpacked bundle; neither exists in a normal interpreter, so every case here sets
and clears both explicitly rather than assuming the state it happens to run in.
"""

import gzip
import importlib
import os
import sys
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
import uvicorn
from conftest import METADATA_MIN
from fastapi.testclient import TestClient

from hqptuner import config as hqp_config
from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The installed package's own directory, the anchor an unfrozen `bundled()`
#: resolves against: `static` and `data` sit beside `hqptuner/config.py`.
PACKAGE_DIR = Path(hqp_config.__file__).parent

#: The home directory every `user_data_dir()` case hands in, so no case reads
#: the machine's own (docs/testing.md rule 16).
HOME = "/home/u"

#: Stand-in for PyInstaller's unpacked-bundle root where the case does not need
#: real files under it.
MEIPASS = "/meipass"

#: The eight stores a user's own actions write, which a frozen build must put
#: under a writable per-user directory rather than beside the executable.
USER_STORES = (
    "backup_dir",
    "preset_dir",
    "live_preset_file",
    "favorites_file",
    "narrowing_file",
    "description_file",
    "matrix_mode_file",
    "autopilot_file",
)

#: A path an operator pins through the environment, which a frozen build must
#: hand back untouched.
OVERRIDE = "/override/fav.json"

#: The path fields, the environment each is read under, and where its value is
#: owed to come from: the user's own directory, the bundle, or the variable.
FROZEN_PATH_CASES = [(name, {}, "user") for name in USER_STORES] + [
    ("data_dir", {}, "bundle"),
    ("favorites_file", {"HQPTUNER_FAVORITES_FILE": OVERRIDE}, "variable"),
]

#: Bytes this suite writes into the bundle it builds, so the assertion on what a
#: route served compares against the test's own input and never the shipped
#: asset (docs/testing.md rule 9).
INDEX_BYTES = b"<h1>bundle</h1>"
AUTOEQ_BYTES = b'{"meta":{"sha":"0123456789abcdef0123456789abcdef01234567"}}'


def _paths() -> ModuleType:
    """The path resolver under test, loaded by name so the cases that do not
    call it still run while the module is absent."""
    return importlib.import_module("hqptuner.paths")


def _freeze(monkeypatch: pytest.MonkeyPatch, bundle: Path | None) -> None:
    """Present the process as PyInstaller's bootloader would, or as a plain
    interpreter when ``bundle`` is None."""
    if bundle is None:
        monkeypatch.delattr(sys, "frozen", raising=False)
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)
        return
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(bundle), raising=False)


def _owed(paths: ModuleType, source: str) -> Path:
    """Where the field's value is owed to come from, in the frozen build's own
    terms."""
    if source == "user":
        return Path(paths.user_data_dir())
    if source == "bundle":
        return Path(paths.bundled("data"))
    return Path(OVERRIDE)


def _clear_hqptuner_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Drop every ``HQPTUNER_*`` variable, the conftest state guard's included,
    so a Config field reads its own default."""
    for name in [name for name in os.environ if name.startswith("HQPTUNER_")]:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def bundle(tmp_path: Path) -> Path:
    """An unpacked bundle carrying the two assets a caller can fetch over HTTP."""
    root = tmp_path / "bundle"
    vendor = root / "static" / "vendor"
    vendor.mkdir(parents=True)
    (root / "static" / "index.html").write_bytes(INDEX_BYTES)
    (vendor / "autoeq.json.gz").write_bytes(gzip.compress(AUTOEQ_BYTES))
    return root


@pytest.fixture
def fresh_entry_point() -> Iterator[None]:
    """Run with ``hqptuner.__main__`` unimported, and leave it that way."""
    sys.modules.pop("hqptuner.__main__", None)
    yield
    sys.modules.pop("hqptuner.__main__", None)


@pytest.mark.parametrize(
    ("platform", "env", "expected"),
    [
        ("win32", {"LOCALAPPDATA": "/c/Users/u/AppData/Local"}, "/c/Users/u/AppData/Local/HQPTuner"),
        ("win32", {}, "/home/u/AppData/Local/HQPTuner"),
        ("darwin", {}, "/home/u/Library/Application Support/HQPTuner"),
        ("linux", {"XDG_DATA_HOME": "/xdg/data"}, "/xdg/data/hqptuner"),
        ("linux", {}, "/home/u/.local/share/hqptuner"),
        ("linux", {"XDG_DATA_HOME": ""}, "/home/u/.local/share/hqptuner"),
        ("linux", {"XDG_DATA_HOME": "sub/dir"}, "/home/u/.local/share/hqptuner"),
    ],
)
def test_user_data_dir_follows_the_platform_and_the_environment_it_runs_in(
    monkeypatch: pytest.MonkeyPatch, platform: str, env: dict[str, str], expected: str
) -> None:
    monkeypatch.setattr(sys, "platform", platform)
    monkeypatch.setenv("HOME", HOME)
    for name in ("LOCALAPPDATA", "APPDATA", "USERPROFILE", "XDG_DATA_HOME"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    assert _paths().user_data_dir() == Path(expected)


@pytest.mark.parametrize(
    ("bundle_root", "part", "expected"),
    [
        (MEIPASS, "static", Path(MEIPASS) / "static"),
        (MEIPASS, "data", Path(MEIPASS) / "data"),
        (None, "static", PACKAGE_DIR / "static"),
        (None, "data", PACKAGE_DIR / "data"),
    ],
)
def test_bundled_asset_sits_under_the_bundle_when_frozen_and_beside_the_package_otherwise(
    monkeypatch: pytest.MonkeyPatch, bundle_root: str | None, part: str, expected: Path
) -> None:
    _freeze(monkeypatch, None if bundle_root is None else Path(bundle_root))

    assert _paths().bundled(part) == expected


@pytest.mark.parametrize(("field", "env", "source"), FROZEN_PATH_CASES)
def test_a_frozen_path_takes_the_environments_value_and_falls_back_to_the_user_dir_or_the_bundle(
    monkeypatch: pytest.MonkeyPatch, field: str, env: dict[str, str], source: str
) -> None:
    paths = _paths()
    _clear_hqptuner_env(monkeypatch)
    _freeze(monkeypatch, Path(MEIPASS))
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    field_value = Path(getattr(Config(), field))
    observed = field_value.parent if source == "user" else field_value

    assert observed == _owed(paths, source)


@pytest.mark.parametrize(("route", "expected"), [("/", INDEX_BYTES), ("/api/autoeq", AUTOEQ_BYTES)])
def test_a_frozen_build_serves_the_asset_bytes_that_sit_in_its_bundle(
    monkeypatch: pytest.MonkeyPatch, bundle: Path, closed_port: int, route: str, expected: bytes
) -> None:
    _freeze(monkeypatch, bundle)
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=closed_port, data_dir=METADATA_MIN)

    with TestClient(create_app(cfg)) as client:
        assert client.get(route).content == expected


@pytest.mark.usefixtures("fresh_entry_point")
def test_importing_the_entry_point_starts_no_server_and_calling_main_starts_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    starts: list[object] = []

    def record(*args: object, **kwargs: object) -> None:
        starts.append((args, kwargs))

    monkeypatch.setattr(uvicorn, "run", record)
    module = importlib.import_module("hqptuner.__main__")
    after_import = len(starts)
    module.main()

    assert (after_import, len(starts)) == (0, 1)
