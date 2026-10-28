"""The XML editor's table exception leaves enumeration iteration governed."""

import re
from pathlib import Path

import pytest
from check_field_structure import main

FIXTURE = Path(__file__).resolve().parents[1] / "support/fixtures/field_structure/xml_parent_and_loop.txt"
XML_EDITOR = "hqptuner/conf/xmledit.py"
OTHER_EDITOR = "hqptuner/lanes/xmledit.py"
TABLE_LINE = 1
LOOP_LINE = 5


@pytest.mark.parametrize(
    ("relative", "expected_lines"),
    [(XML_EDITOR, [LOOP_LINE]), (OTHER_EDITOR, [TABLE_LINE, LOOP_LINE])],
    ids=["xml-editor", "same-name-elsewhere"],
)
def test_xml_editor_spares_its_table_but_still_reports_enumeration_iteration(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str, expected_lines: list[int]
) -> None:
    """Breaks if the exception skips the entire file or matches only its basename."""
    path = tmp_path / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    main([str(path)])
    captured = capsys.readouterr()
    prefix = re.compile(rf"^{re.escape(str(path))}:(\d+):", re.MULTILINE)
    assert sorted(int(line) for line in prefix.findall(captured.out + captured.err)) == expected_lines
