"""The probe backup directory is user-owned, private, and checked before any read or write.

``scripts/probes/backup_dir.py`` decides where the pristine archive lives and whether that
directory is safe: ``prepare()`` creates it at mode ``0700`` when absent and returns a
``BackupDir`` whose ``safe`` flag says whether the directory may be used and whose
``problem`` names the directory when it may not. ``prepare(uid=...)`` judges ownership
against that uid instead of the process's own.

The probe scripts refuse an unsafe directory before they read credentials, so each case runs
with both ``HQPTUNER_HQP_*`` credential variables removed and ``PROBE_OUT`` inside ``tmp_path``.
Nothing here dials a daemon.
"""

import asyncio
import importlib.util
import os
import stat
import sys
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

PROBES_DIR = Path(__file__).resolve().parents[1] / "scripts" / "probes"

#: every script that reads or writes the archive, relative to the probes directory
SCRIPTS = [
    "restore_pristine.py",
]


def _load_file(monkeypatch: pytest.MonkeyPatch, path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {path}")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def probe_out(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The directory the probes are told to write under, with no daemon credentials in the environment."""
    monkeypatch.setenv("PROBE_OUT", str(tmp_path))
    monkeypatch.delenv("HQPTUNER_HQP_USERNAME", raising=False)
    monkeypatch.delenv("HQPTUNER_HQP_PASSWORD", raising=False)
    return tmp_path / "hqptuner-probe"


@pytest.fixture
def backup_dir(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return _load_file(monkeypatch, PROBES_DIR / "backup_dir.py", "backup_dir_under_test")


def test_absent_directory_is_created_private(probe_out: Path, backup_dir: ModuleType) -> None:
    backup_dir.prepare()
    mode = stat.S_IMODE(probe_out.stat().st_mode) if probe_out.is_dir() else 0
    assert mode == 0o700


def test_private_directory_is_accepted(probe_out: Path, backup_dir: ModuleType) -> None:
    probe_out.mkdir(mode=0o700)
    assert backup_dir.prepare().safe is True


def test_directory_owned_by_another_user_is_refused(probe_out: Path, backup_dir: ModuleType) -> None:
    probe_out.mkdir(mode=0o700)
    assert backup_dir.prepare(uid=os.getuid() + 1).refusal is backup_dir.Refusal.FOREIGN_OWNER


@pytest.mark.parametrize("mode", [0o750, 0o705])
def test_directory_with_a_group_or_other_bit_is_refused(probe_out: Path, backup_dir: ModuleType, mode: int) -> None:
    probe_out.mkdir()
    probe_out.chmod(mode)
    assert backup_dir.prepare().refusal is backup_dir.Refusal.WIDE_MODE


def test_planted_symlink_is_refused(probe_out: Path, tmp_path: Path, backup_dir: ModuleType) -> None:
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir(mode=0o700)
    probe_out.symlink_to(elsewhere)
    assert backup_dir.prepare().refusal is backup_dir.Refusal.NOT_A_DIRECTORY


def test_refusal_names_the_directory(probe_out: Path, backup_dir: ModuleType) -> None:
    probe_out.mkdir()
    probe_out.chmod(0o755)
    assert str(probe_out) in str(backup_dir.prepare().problem)


def _run_against_wide_directory(
    probe_out: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], script: str
) -> tuple[int, str]:
    """Run one script's `main` with a mode 0755 backup directory holding an archive; return its exit code and stderr."""
    probe_out.mkdir()
    probe_out.chmod(0o755)
    (probe_out / "pristine-settings.zip").write_bytes(b"archive")
    monkeypatch.syspath_prepend(str(PROBES_DIR))
    module = _load_file(monkeypatch, PROBES_DIR / script, "probe_script_under_test")
    code: int = asyncio.run(module.main())
    return code, capsys.readouterr().err


@pytest.mark.parametrize("script", SCRIPTS)
def test_script_exits_one_naming_the_wide_directory(
    probe_out: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], script: str
) -> None:
    code, err = _run_against_wide_directory(probe_out, monkeypatch, capsys, script)
    assert (code, str(probe_out) in err) == (1, True)
