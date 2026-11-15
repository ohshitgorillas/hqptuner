"""``hqp_section`` and ``hqp_page`` read only files that live inside the manual directory.

The manual directory is built by ``make manual``, so each test lays out its own
docs root under ``tmp_path`` and hands it to the tool. A row that names a file
outside the directory is an escape; each escaping case is set up with the
outside file present and holding a sentinel line.
"""

from pathlib import Path

import hqpdoc_tools
import pytest
from hqpdoc_errors import ToolError

SENTINEL = "OUTSIDE-FILE-SENTINEL"
INSIDE_TEXT = "inside section text"


@pytest.fixture
def manual(tmp_path: Path) -> Path:
    """An empty manual directory under the docs root `tmp_path`."""
    directory = tmp_path / "docs" / "official" / "manual"
    directory.mkdir(parents=True)
    return directory


def index_row(filename: str) -> str:
    return f"| 4.6 | Filter selection | 27 | `{filename}` |\n"


def escaping_name(kind: str, manual: Path) -> str:
    """Create the outside file holding the sentinel and return the INDEX name that reaches it."""
    outside = manual.parent / "outside.txt"
    outside.write_text(SENTINEL + "\n", encoding="utf-8")
    if kind == "parent":
        return "../outside.txt"
    if kind == "absolute":
        return str(outside)
    (manual / "link.txt").symlink_to(outside)
    return "link.txt"


@pytest.mark.parametrize("kind", ["parent", "absolute", "symlink"])
def test_section_row_naming_a_file_outside_the_manual_is_refused(tmp_path: Path, manual: Path, kind: str) -> None:
    (manual / "INDEX.md").write_text(index_row(escaping_name(kind, manual)), encoding="utf-8")
    with pytest.raises(ToolError):
        hqpdoc_tools.tool_hqp_section("4.6", root=tmp_path)


def test_section_row_naming_a_file_inside_the_manual_reads_that_file(tmp_path: Path, manual: Path) -> None:
    (manual / "04-06-filter.txt").write_text(INSIDE_TEXT, encoding="utf-8")
    (manual / "INDEX.md").write_text(index_row("04-06-filter.txt"), encoding="utf-8")
    assert hqpdoc_tools.tool_hqp_section("4.6", root=tmp_path) == INSIDE_TEXT


def test_page_text_is_not_read_from_a_symlink_pointing_outside_the_manual(tmp_path: Path, manual: Path) -> None:
    outside = manual.parent / "outside.txt"
    outside.write_text(f"[page 7]\n{SENTINEL}\n", encoding="utf-8")
    (manual / "link.txt").symlink_to(outside)
    (manual / "INDEX.md").write_text("", encoding="utf-8")
    with pytest.raises(ToolError):
        hqpdoc_tools.tool_hqp_page(7, root=tmp_path)
