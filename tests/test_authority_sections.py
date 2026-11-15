"""``authority`` hands callers only section files that live inside the manual directory.

``manual_sections()`` maps the filenames INDEX.md lists to labels, and its callers
open those names. A row naming a file outside the directory is left out, and a
``*.txt`` symlinked out of the directory contributes no hit to ``search_manual``.
Each test lays out its own docs root under ``tmp_path``; the outside file exists
and holds a sentinel line.
"""

from pathlib import Path

import authority
import pytest

SENTINEL = "outside-file-sentinel"


@pytest.fixture
def manual(tmp_path: Path) -> Path:
    """An empty manual directory under the docs root `tmp_path`."""
    directory = tmp_path / "docs" / "official" / "manual"
    directory.mkdir(parents=True)
    return directory


def index_text(*filenames: str) -> str:
    """INDEX.md rows that all carry the same section number and title, one per filename."""
    return "".join(f"| 4.6 | Filter selection | 27 | `{name}` |\n" for name in filenames)


def write_outside_file(manual: Path) -> Path:
    outside = manual.parent / "outside.txt"
    outside.write_text(SENTINEL + "\n", encoding="utf-8")
    return outside


@pytest.mark.parametrize("kind", ["parent", "absolute"])
def test_index_row_naming_a_file_outside_the_manual_is_left_out(tmp_path: Path, manual: Path, kind: str) -> None:
    outside = write_outside_file(manual)
    hostile = "../outside.txt" if kind == "parent" else str(outside)
    (manual / "INDEX.md").write_text(index_text(hostile, "04-06-filter.txt"), encoding="utf-8")
    assert hostile not in authority.manual_sections(tmp_path)


def test_index_row_naming_a_file_inside_the_manual_is_kept(tmp_path: Path, manual: Path) -> None:
    write_outside_file(manual)
    (manual / "INDEX.md").write_text(index_text("../outside.txt", "04-06-filter.txt"), encoding="utf-8")
    assert "04-06-filter.txt" in authority.manual_sections(tmp_path)


def test_symlinked_section_file_pointing_outside_the_manual_yields_no_hit(tmp_path: Path, manual: Path) -> None:
    (manual / "link.txt").symlink_to(write_outside_file(manual))
    (manual / "04-06-filter.txt").write_text(SENTINEL + "\n", encoding="utf-8")
    (manual / "INDEX.md").write_text(index_text("04-06-filter.txt", "link.txt"), encoding="utf-8")
    assert len(authority.search_manual(SENTINEL, tmp_path)) == 1
