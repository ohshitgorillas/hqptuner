"""Where a frozen build reads and writes: the per-user store root, the bundled
asset root, the Config defaults built on them, and the entry point that serves
only when a caller asks it to.

PyInstaller's bootloader sets ``sys.frozen`` and points ``sys._MEIPASS`` at the
unpacked bundle; neither exists in a normal interpreter, so every case here sets
and clears both explicitly rather than assuming the state it happens to run in.
"""

import gzip
import importlib
import sys
from collections.abc import Iterator, Mapping
from pathlib import Path
from types import MappingProxyType, ModuleType
from typing import NamedTuple

import pytest
from conftest import METADATA_MIN
from fastapi.testclient import TestClient

from hqptuner import config as hqp_config
from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The installed package's own directory, the anchor an unfrozen `bundled()`
#: resolves against: `static` and `data` sit beside `hqptuner/config.py`.
PACKAGE_DIR = Path(hqp_config.__file__).parent

#: The home directory every `user_data_dir()` case hands in, so no case reads
#: the machine's own.
HOME = "/home/u"

#: Stand-in for PyInstaller's unpacked-bundle root where the case does not need
#: real files under it.
MEIPASS = "/meipass"

#: The checkout the package was imported from: an unfrozen store resolves inside it.
REPO_DIR = Path(hqp_config.__file__).resolve().parent.parent

#: The per-user data root every frozen-store case hands in through
#: ``XDG_DATA_HOME``, so no case reads the machine's own home or environment.
XDG_DATA_HOME = "/xdg/data"
USER_DATA_DIR = Path(XDG_DATA_HOME) / "hqptuner"


class Build(NamedTuple):
    """The ``frozen`` and ``bundle`` a ``Config`` is constructed with."""

    frozen: bool
    bundle: Path | None


#: A ``Config`` answering as a frozen build, and as a source checkout. Neither
#: touches ``sys``: the interpreter running the suite is never frozen.
FROZEN_BUILD = Build(frozen=True, bundle=Path(MEIPASS))
SOURCE_CHECKOUT = Build(frozen=False, bundle=None)

#: Each store file a ``Config`` field defaults to, by field, and the file name it is kept under.
STORE_FILES = {
    "connection_file": "connection.json",
    "live_preset_file": "live-presets.json",
    "favorites_file": "favorites.json",
    "narrowing_file": "narrowing.json",
    "description_file": "descriptions.json",
    "matrix_mode_file": "matrixmodes.json",
    "autopilot_file": "autopilot.json",
}

#: Each store directory a ``Config`` field defaults to, by field, and the directory name it is kept under.
STORE_DIRS = {"backup_dir": "backups", "preset_dir": "presets"}

#: Field, the build it is resolved under, and where that build owes it to land.
UNNAMED_PATH_CASES: list[tuple[str, Build, Path]] = [
    *((field, FROZEN_BUILD, USER_DATA_DIR / name) for field, name in {**STORE_FILES, **STORE_DIRS}.items()),
    *((field, SOURCE_CHECKOUT, REPO_DIR / "state" / name) for field, name in STORE_FILES.items()),
    *((field, SOURCE_CHECKOUT, REPO_DIR / name) for field, name in STORE_DIRS.items()),
    ("data_dir", FROZEN_BUILD, Path(MEIPASS) / "data"),
    ("data_dir", SOURCE_CHECKOUT, PACKAGE_DIR / "data"),
]

#: Bytes this suite writes into the bundle it builds, so the assertion on what a
#: route served compares against the test's own input and never the shipped
#: asset.
INDEX_BYTES = b"<h1>bundle</h1>"
AUTOEQ_BYTES = b'{"meta":{"sha":"0123456789abcdef0123456789abcdef01234567"}}'


def _paths() -> ModuleType:
    """The path resolver under test, loaded by name so the cases that do not
    call it still run while the module is absent."""
    return importlib.import_module("hqptuner.paths")


#: What a plain interpreter hands ``bundled()``: no ``bundle`` keyword at all, so
#: it resolves from the live, unfrozen ``sys``.
PLAIN_INTERPRETER: Mapping[str, Path] = MappingProxyType({})


def _freeze(bundle_root: str | None) -> Mapping[str, Path]:
    """The keyword ``bundled()`` takes to answer as PyInstaller's bootloader would, or ``PLAIN_INTERPRETER``."""
    return {"bundle": Path(bundle_root)} if bundle_root is not None else PLAIN_INTERPRETER


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
    monkeypatch.setenv("HOME", HOME)

    assert _paths().user_data_dir(platform=platform, env=env) == Path(expected)


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
    bundle_root: str | None, part: str, expected: Path
) -> None:
    assert _paths().bundled(part, **_freeze(bundle_root)) == expected


@pytest.mark.parametrize(("field", "build", "expected"), UNNAMED_PATH_CASES)
def test_a_path_nobody_named_lands_where_configs_own_frozen_and_bundle_fields_place_it(
    monkeypatch: pytest.MonkeyPatch, field: str, build: Build, expected: Path
) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", XDG_DATA_HOME)
    monkeypatch.delenv(f"HQPTUNER_{field.upper()}", raising=False)

    assert getattr(Config(frozen=build.frozen, bundle=build.bundle), field) == expected


@pytest.mark.parametrize(("route", "expected"), [("/", INDEX_BYTES), ("/api/autoeq", AUTOEQ_BYTES)])
def test_a_frozen_build_serves_the_asset_bytes_that_sit_in_its_bundle(
    bundle: Path, closed_port: int, route: str, expected: bytes
) -> None:
    # api/spa.py and api/routes/matrix/matrix.py now read the bundle root off the
    # app's own `Config` instead of calling `bundled()` bare.
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=closed_port, data_dir=METADATA_MIN, frozen=True, bundle=bundle)

    with TestClient(create_app(cfg)) as client:
        assert client.get(route).content == expected


@pytest.mark.usefixtures("fresh_entry_point")
def test_calling_main_starts_one_server() -> None:
    starts: list[object] = []

    def record(*args: object, **kwargs: object) -> None:
        starts.append((args, kwargs))

    importlib.import_module("hqptuner.__main__").main(run=record)

    assert len(starts) == 1
