"""The gate that holds every ``Path``-typed config field to a pin in the container image.

``scripts/gates/check_container_env.py`` asks one question of the pair
``hqptuner/config.py`` + ``Dockerfile``: does every ``Path`` field on ``Config``
have a matching ``HQPTUNER_*`` entry in the image's ``ENV`` block, pointing
somewhere under ``/state``? A field nobody pinned falls back to its in-repo
default, which inside the image names a path the container user cannot write,
and the first write surfaces as a 500. Presence alone is not enough: a pin
aimed outside the bind-mounted ``/state`` is the same defect wearing a pin.

Cases drive the seams on literal source strings rather than a fixture repo,
because the two halves the gate reads are text. Observable contract is what a
caller gets: the mappings the parsers return, the list of failure lines, the
int exit code, and what lands on stdout. Nothing here reads the gate's
internals.

Seams are ``path_fields(config_source)``, ``pinned(dockerfile_source)``,
``failures(fields, pins, exempt)`` and ``main(argv)``.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_container_env.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_container_env_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
PATH_FIELDS = GATE.path_fields
PINNED = GATE.pinned
FAILURES = GATE.failures
MAIN = GATE.main

#: A ``Config`` carrying one plain ``Path`` field, one ``Path | None`` field and
#: one field of every scalar type the gate is meant to walk past.
CONFIG_SOURCE = '''
"""A miniature stand-in for hqptuner.config."""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    """Runtime knobs."""

    backup_dir: Path = field(default_factory=lambda: Path(_env("BACKUP_DIR", "./backups")))
    preset_dir: Path = field(default_factory=lambda: Path(_env("PRESET_DIR", "./presets")))
    debug_log: Path | None = field(default_factory=lambda: _optional_path("DEBUG_LOG"))
    host: str = field(default_factory=lambda: _env("HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("PORT", "8090")))
    timeout: float = field(default_factory=lambda: float(_env("TIMEOUT", "2.5")))
    verbose: bool = field(default_factory=lambda: _env("VERBOSE", "") == "1")
'''

#: A ``Config`` carrying exactly the two fields the shipped ``EXEMPT`` table names.
EXEMPT_ONLY_CONFIG_SOURCE = '''
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    """Runtime knobs."""

    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", "./data")))
    debug_log: Path | None = field(default_factory=lambda: _optional_path("DEBUG_LOG"))
'''

#: A ``Config`` a real image could be clean against: two writable path fields to
#: pin, plus a field for every suffix the shipped ``EXEMPT`` table names, so no
#: shipped exemption reads as stale.
SHIPPED_EXEMPT_CONFIG_SOURCE = '''
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    """Runtime knobs."""

    backup_dir: Path = field(default_factory=lambda: Path(_env("BACKUP_DIR", "./backups")))
    preset_dir: Path = field(default_factory=lambda: Path(_env("PRESET_DIR", "./presets")))
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", "./data")))
    debug_log: Path | None = field(default_factory=lambda: _optional_path("DEBUG_LOG"))
    host: str = field(default_factory=lambda: _env("HOST", "127.0.0.1"))
'''

#: A Dockerfile pinning both writable fields of ``CONFIG_SOURCE`` under ``/state``.
CLEAN_DOCKERFILE = """
FROM python:3.13-slim

WORKDIR /app

ENV HQPTUNER_BACKUP_DIR=/state/backups \\
    HQPTUNER_PRESET_DIR=/state/presets

CMD ["python", "-m", "hqptuner"]
"""

#: The same image with ``PRESET_DIR`` never pinned at all.
UNPINNED_DOCKERFILE = """
FROM python:3.13-slim

ENV HQPTUNER_BACKUP_DIR=/state/backups

CMD ["python", "-m", "hqptuner"]
"""

#: An ``ENV`` block whose first line sets a name that is nothing to do with
#: HQPTuner, continued into a real pin. Both are in the image; only one is a pin.
MIXED_ENV_DOCKERFILE = """
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \\
    HQPTUNER_BACKUP_DIR=/state/backups

CMD ["python", "-m", "hqptuner"]
"""

#: A ``config.py`` no image could be clean against: one path field, never pinned.
DECOY_CONFIG_SOURCE = '''
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    """Runtime knobs."""

    preset_dir: Path = field(default_factory=lambda: Path(_env("PRESET_DIR", "./presets")))
'''

#: A ``Dockerfile`` pinning nothing at all, to pair with the decoy config.
DECOY_DOCKERFILE = """
FROM python:3.13-slim

CMD ["python", "-m", "hqptuner"]
"""


def field_source(name: str, annotation: str, suffix: str) -> str:
    """A one-field ``Config`` module, so a case can name the annotation it is about."""
    return (
        "from dataclasses import dataclass, field\n"
        "from pathlib import Path\n\n\n"
        "@dataclass\n"
        "class Config:\n"
        '    """Runtime knobs."""\n\n'
        f'    {name}: {annotation} = field(default_factory=lambda: _env("{suffix}", "x"))\n'
    )


def line_naming(lines: list[str], needle: str) -> str:
    """The first failure line that names ``needle``, or ``""`` when no line does."""
    for line in lines:
        if needle in line:
            return line
    return ""


def write_pair(root: Path, config_source: str, dockerfile_source: str) -> list[str]:
    """Lay the two sources down under ``root`` and return the argv naming them."""
    config = root / "config.py"
    dockerfile = root / "Dockerfile"
    config.write_text(config_source, encoding="utf-8")
    dockerfile.write_text(dockerfile_source, encoding="utf-8")
    return [str(config), str(dockerfile)]


# --- path_fields ------------------------------------------------------------


@pytest.mark.parametrize("annotation", ["Path", "Path | None"])
def test_a_path_annotated_field_is_collected(annotation: str) -> None:
    """Both spellings of a path field name a directory the image has to pin."""
    assert PATH_FIELDS(field_source("backup_dir", annotation, "BACKUP_DIR")) == {"backup_dir": "BACKUP_DIR"}


@pytest.mark.parametrize("annotation", ["str", "int", "float", "bool"])
def test_a_scalar_annotated_field_is_not_collected(annotation: str) -> None:
    """Only paths land on disk, so only paths need a writable location in the image."""
    assert PATH_FIELDS(field_source("host", annotation, "HOST")) == {}


def test_a_path_field_is_mapped_to_the_env_suffix_from_its_default_factory() -> None:
    """The suffix is the string the factory reads the environment with, not the field name upper-cased."""
    source = field_source("backup_dir", "Path", "BACKUPS_LOCATION")
    assert PATH_FIELDS(source)["backup_dir"] == "BACKUPS_LOCATION"


def test_every_path_field_of_a_mixed_config_is_collected() -> None:
    """A config of mixed annotations yields its paths and nothing else."""
    assert PATH_FIELDS(CONFIG_SOURCE) == {
        "backup_dir": "BACKUP_DIR",
        "preset_dir": "PRESET_DIR",
        "debug_log": "DEBUG_LOG",
    }


# --- pinned -----------------------------------------------------------------


@pytest.mark.parametrize("suffix", ["BACKUP_DIR", "PRESET_DIR"])
def test_a_continued_env_block_yields_every_suffix_in_it(suffix: str) -> None:
    """A backslash-continued ``ENV`` is one instruction, and every line of it pins."""
    assert suffix in PINNED(CLEAN_DOCKERFILE)


def test_an_env_line_yields_the_value_it_pins() -> None:
    assert PINNED(CLEAN_DOCKERFILE)["BACKUP_DIR"] == "/state/backups"


def test_a_commented_env_line_pins_nothing() -> None:
    """Commented-out text is not in the image, so it cannot be what makes a field writable."""
    dockerfile = "FROM python:3.13-slim\n# ENV HQPTUNER_BACKUP_DIR=/state/backups\n"
    assert PINNED(dockerfile) == {}


def test_a_non_hqptuner_name_in_the_env_block_is_not_a_pin() -> None:
    """The gate speaks about ``HQPTUNER_*`` only; an image's other environment is not its business."""
    assert "PYTHONUNBUFFERED" not in PINNED(MIXED_ENV_DOCKERFILE)


def test_a_hqptuner_name_continued_after_a_foreign_one_is_still_a_pin() -> None:
    """A foreign first line does not cost the rest of the continued instruction its pins."""
    assert PINNED(MIXED_ENV_DOCKERFILE)["BACKUP_DIR"] == "/state/backups"


# --- failures ---------------------------------------------------------------


def test_a_config_whose_every_path_field_is_pinned_under_state_has_no_failures() -> None:
    fields = {"backup_dir": "BACKUP_DIR", "preset_dir": "PRESET_DIR"}
    pins = {"BACKUP_DIR": "/state/backups", "PRESET_DIR": "/state/presets"}
    assert FAILURES(fields, pins, {}) == []


def test_a_path_field_with_no_pin_is_one_failure() -> None:
    fields = {"backup_dir": "BACKUP_DIR", "preset_dir": "PRESET_DIR"}
    assert len(FAILURES(fields, {"BACKUP_DIR": "/state/backups"}, {})) == 1


def test_an_unpinned_path_field_is_named_in_its_failure() -> None:
    reported = FAILURES({"preset_dir": "PRESET_DIR"}, {}, {})
    assert "preset_dir" in line_naming(reported, "PRESET_DIR")


def test_an_unpinned_path_field_is_shown_the_env_line_it_needs() -> None:
    """The failure carries the fix: the ``HQPTUNER_`` name pointed under ``/state``."""
    reported = FAILURES({"preset_dir": "PRESET_DIR"}, {}, {})
    assert "HQPTUNER_PRESET_DIR=/state" in line_naming(reported, "PRESET_DIR")


def test_a_path_field_pinned_outside_state_is_one_failure() -> None:
    """Presence is not the check: only ``/state`` is bind-mounted and writable."""
    assert len(FAILURES({"backup_dir": "BACKUP_DIR"}, {"BACKUP_DIR": "/app/backups"}, {})) == 1


def test_a_path_field_pinned_outside_state_is_named_in_its_failure() -> None:
    reported = FAILURES({"backup_dir": "BACKUP_DIR"}, {"BACKUP_DIR": "/app/backups"}, {})
    assert "backup_dir" in line_naming(reported, "BACKUP_DIR")


def test_a_path_field_pinned_outside_state_is_shown_the_offending_value() -> None:
    reported = FAILURES({"backup_dir": "BACKUP_DIR"}, {"BACKUP_DIR": "/app/backups"}, {})
    assert "/app/backups" in line_naming(reported, "BACKUP_DIR")


@pytest.mark.parametrize("value", ["/statefoo/backups", "/state-old/presets"])
def test_a_path_field_pinned_to_a_sibling_of_state_is_one_failure(value: str) -> None:
    """Sharing the first six characters is not being under the mount: neither path is writable."""
    assert len(FAILURES({"backup_dir": "BACKUP_DIR"}, {"BACKUP_DIR": value}, {})) == 1


def test_a_path_field_pinned_only_in_a_commented_line_still_fails() -> None:
    """Parsed end to end: the comment pins nothing, so the field is unpinned."""
    dockerfile = "FROM python:3.13-slim\n# ENV HQPTUNER_BACKUP_DIR=/state/backups\n"
    assert len(FAILURES(PATH_FIELDS(field_source("backup_dir", "Path", "BACKUP_DIR")), PINNED(dockerfile), {})) == 1


def test_an_exempt_path_field_needs_no_pin() -> None:
    """An exemption is the written-down reason a field is deliberately left to its default."""
    assert FAILURES({"data_dir": "DATA_DIR"}, {}, {"DATA_DIR": "ships read-only inside the wheel"}) == []


def test_an_exemption_naming_a_suffix_the_config_no_longer_has_is_one_failure() -> None:
    """A stale exemption is drift: it silently excuses a field nobody has any more."""
    assert len(FAILURES({"backup_dir": "BACKUP_DIR"}, {"BACKUP_DIR": "/state/backups"}, {"GONE_DIR": "why"})) == 1


def test_an_exemption_naming_a_suffix_the_config_no_longer_has_names_that_key() -> None:
    reported = FAILURES({"backup_dir": "BACKUP_DIR"}, {"BACKUP_DIR": "/state/backups"}, {"GONE_DIR": "why"})
    assert "GONE_DIR" in "\n".join(reported)


def test_an_exemption_for_a_suffix_that_is_pinned_is_one_failure() -> None:
    """A pinned field needs no excuse, so the excuse left behind is drift."""
    fields = {"backup_dir": "BACKUP_DIR"}
    assert len(FAILURES(fields, {"BACKUP_DIR": "/state/backups"}, {"BACKUP_DIR": "why"})) == 1


def test_an_exemption_for_a_suffix_that_is_pinned_names_that_key() -> None:
    reported = FAILURES({"backup_dir": "BACKUP_DIR"}, {"BACKUP_DIR": "/state/backups"}, {"BACKUP_DIR": "why"})
    assert "BACKUP_DIR" in "\n".join(reported)


def test_several_violations_are_all_counted_not_only_the_first() -> None:
    fields = {"backup_dir": "BACKUP_DIR", "preset_dir": "PRESET_DIR", "log_dir": "LOG_DIR"}
    assert len(FAILURES(fields, {"BACKUP_DIR": "/app/backups"}, {"GONE_DIR": "why"})) == 4


def test_every_violation_is_reported_on_its_own_line() -> None:
    """Four violations, four distinct lines: no line doubles up and none is missing."""
    fields = {"backup_dir": "BACKUP_DIR", "preset_dir": "PRESET_DIR", "log_dir": "LOG_DIR"}
    reported = FAILURES(fields, {"BACKUP_DIR": "/app/backups"}, {"GONE_DIR": "why"})
    named = {line_naming(reported, needle) for needle in ("backup_dir", "preset_dir", "log_dir", "GONE_DIR")}
    assert len(named - {""}) == 4


def test_omitting_the_exemption_table_honors_the_shipped_exemptions() -> None:
    """A caller who passes none gets the module's own table, so its entries excuse their fields."""
    assert FAILURES(PATH_FIELDS(EXEMPT_ONLY_CONFIG_SOURCE), {}) == []


def test_passing_an_empty_exemption_table_excuses_nothing() -> None:
    """An explicit empty table is the caller's own, so the shipped entries do not apply."""
    assert len(FAILURES(PATH_FIELDS(EXEMPT_ONLY_CONFIG_SOURCE), {}, {})) == 2


# --- main -------------------------------------------------------------------


def test_a_violating_pair_of_source_files_exits_nonzero(tmp_path: Path) -> None:
    assert MAIN(write_pair(tmp_path, CONFIG_SOURCE, UNPINNED_DOCKERFILE)) == 1


def test_a_violating_pair_of_source_files_names_the_unpinned_field_on_stdout(tmp_path: Path, capsys: Any) -> None:
    MAIN(write_pair(tmp_path, CONFIG_SOURCE, UNPINNED_DOCKERFILE))
    assert "preset_dir" in capsys.readouterr().out


def test_a_clean_pair_of_source_files_exits_zero(tmp_path: Path) -> None:
    assert MAIN(write_pair(tmp_path, SHIPPED_EXEMPT_CONFIG_SOURCE, CLEAN_DOCKERFILE)) == 0


def test_a_clean_pair_of_source_files_prints_no_failure(tmp_path: Path, capsys: Any) -> None:
    """The same field a violating run names on stdout goes unmentioned when it is pinned."""
    MAIN(write_pair(tmp_path, SHIPPED_EXEMPT_CONFIG_SOURCE, CLEAN_DOCKERFILE))
    assert "preset_dir" not in capsys.readouterr().out


def test_the_shipped_config_and_dockerfile_pass() -> None:
    """The point of the gate: this repo's own image wires every path field into /state."""
    assert MAIN([str(REPO_ROOT / "hqptuner" / "config.py"), str(REPO_ROOT / "Dockerfile")]) == 0


def test_an_empty_argv_checks_the_repos_own_config_and_dockerfile(tmp_path: Path, monkeypatch: Any) -> None:
    """Run with no arguments, the way the Makefile runs it, the gate finds its own two files.

    The working directory holds a decoy pair that would fail, so a green result
    is only reachable by reading the checkout's own ``config.py`` and ``Dockerfile``.
    """
    write_pair(tmp_path, DECOY_CONFIG_SOURCE, DECOY_DOCKERFILE)
    monkeypatch.chdir(tmp_path)
    assert MAIN([]) == 0
