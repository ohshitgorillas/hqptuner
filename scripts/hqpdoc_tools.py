#!/usr/bin/env python3
"""The five HQPlayer authority tools `hqpdoc_mcp.py` serves over JSON-RPC, all stdlib-only.

  hqp_find(term, cap=8, context=0)  — search manual-facts.txt, the split
      manual and the readme, reusing scripts/authority.py's own search
      functions; `context` adds surrounding lines around each hit.
  hqp_toc()                         — the section table from
      docs/vendor/manual/INDEX.md plus the heading list of
      hqplayerd-readme.txt.
  hqp_section(number)               — the one docs/vendor/manual/ section
      file whose INDEX.md row carries that number ("4.6").
  hqp_page(page)                    — the text between "[page N]" and the
      next marker, across the section files in filename order.
  hqp_readme(key)                   — one hqplayerd-readme.txt heading
      block, looked up by number ("1.12") or case-insensitive name
      ("matrix_profile", "HQPLAYER_IDLE_TIME"), through to the next heading
      of equal or shallower depth. Lines are prefixed by their readme line
      number, capped at 200 lines, with dropped subheadings listed.

Every tool's result is prefixed with a one-line warning naming `make
manual` when `hqplayer6desktop-manual.pdf` is newer than
docs/vendor/manual/INDEX.md — see `with_warning`.
"""

import re
from collections.abc import Callable

import authority

Locate = Callable[["authority.Hit"], "tuple[list[str], int] | None"]

README_CAP = 200

# A dotted heading number, optionally trailing-dotted, at the start of a line:
# "1.12 Element "matrix_profile""  "3.8 HQPLAYER_IDLE_TIME"  "1. CONFIGURATION GUIDE"
HEADING_LINE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$")
ELEMENT_TITLE = re.compile(r'^(Element|Sub-element)\s+"(.+)"$')
ALLCAPS_TITLE = re.compile(r"^[A-Z][A-Z0-9 _/,()\-]*$")
# "1.0 Provisioning": a single capitalised word, which the prose lines that start with a number are not.
WORD_TITLE = re.compile(r"^[A-Z][a-z]+$")

OTHER_LICENSES_MARKER = re.compile(r"^4\.\s+OTHER LICENSES\s*$")

ROOT = authority.ROOT
MANUAL = authority.MANUAL
INDEX = MANUAL / "INDEX.md"
README = authority.README
MANUAL_PDF = ROOT / "hqplayer6desktop-manual.pdf"

read_lines = authority.read_lines

Heading = tuple[str, str, int, int]


class ToolError(Exception):
    """A tool-level failure: reported as isError true, never as a protocol error."""


def staleness_warning() -> str | None:
    """One line naming `make manual` when the PDF outran the built index, else None."""
    if not MANUAL_PDF.is_file():
        return None
    if not INDEX.is_file():
        return f"warning: {INDEX.relative_to(ROOT)} is missing; run `make manual`."
    if MANUAL_PDF.stat().st_mtime > INDEX.stat().st_mtime:
        return f"warning: {MANUAL_PDF.name} is newer than {INDEX.relative_to(ROOT)}; run `make manual`."
    return None


def with_warning(text: str) -> str:
    """Prefix `text` with the staleness warning line, when there is one."""
    warning = staleness_warning()
    return f"{warning}\n{text}" if warning else text


def require_manual() -> None:
    """Raise a `ToolError` naming `make manual` when docs/vendor/manual/INDEX.md is missing."""
    if not INDEX.is_file():
        raise ToolError(f"{MANUAL.relative_to(ROOT)} is missing; it is gitignored and built by `make manual`.")


def _line_number_from_citation(citation: str) -> int | None:
    match = re.search(r":(\d+)$", citation)
    return int(match.group(1)) if match else None


def _context_block(lines: list[str], index0: int, context: int) -> str:
    """Render `lines[index0]` (0-based) with `context` lines either side, numbered."""
    lo = max(0, index0 - context)
    hi = min(len(lines), index0 + context + 1)
    out = []
    for i in range(lo, hi):
        marker = ">" if i == index0 else " "
        out.append(f"    {marker}{i + 1}: {lines[i]}")
    return "\n".join(out)


def _manual_label_to_file(hit_citation: str, sections: dict[str, str]) -> str | None:
    """Reverse `authority.manual_sections()` (filename -> label) to find the hit's file."""
    label = re.sub(r"\s*\[page \d+\]$", "", hit_citation)
    for filename, section_label in sections.items():
        if section_label == label:
            return filename
    # search_manual labels a section file INDEX.md does not list by its bare filename.
    return label if (MANUAL / label).is_file() else None


def _locate_by_citation(lines: list[str], hit: "authority.Hit") -> tuple[list[str], int] | None:
    """Recover a facts/readme hit's line from the line number its own citation already carries."""
    number = _line_number_from_citation(hit.citation)
    return (lines, number - 1) if number else None


class _ManualLocator:
    """Recovers a manual hit's file and line by replaying that section file in scan order."""

    def __init__(self, sections: dict[str, str]) -> None:
        self._sections = sections
        self._lines: dict[str, list[str]] = {}
        self._cursor: dict[str, int] = {}

    def locate(self, hit: "authority.Hit") -> tuple[list[str], int] | None:
        """Return (file lines, 0-based index) for the next unconsumed occurrence of `hit.text`."""
        filename = _manual_label_to_file(hit.citation, self._sections)
        if filename is None:
            return None
        if filename not in self._lines:
            self._lines[filename] = read_lines(authority.MANUAL / filename)
            self._cursor[filename] = 0
        lines = self._lines[filename]
        for i in range(self._cursor[filename], len(lines)):
            if lines[i].strip() == hit.text:
                self._cursor[filename] = i + 1
                return (lines, i)
        return None


def _render_group(name: str, hits: list["authority.Hit"], cap: int, context: int, locate: Locate) -> str:
    """Render one source group: header, up to `cap` hits, and optional context around each."""
    shown = hits[:cap]
    tail = f", {len(shown)} shown" if len(hits) > cap else ""
    lines = [f"{name} ({len(hits)} hits{tail})"]
    for hit in shown:
        lines.append(f'  {hit.citation}  "{hit.text}"')
        if context > 0:
            located = locate(hit)
            if located is not None:
                file_lines, index0 = located
                lines.append(_context_block(file_lines, index0, context))
    return "\n".join(lines)


def tool_hqp_find(term: str, cap: int = 8, context: int = 0) -> str:
    """Search manual-facts.txt, the split manual and the readme, reusing authority's own search functions."""
    if not term.strip():
        raise ToolError("hqp_find needs a non-empty term.")
    if cap < 1:
        raise ToolError(f"hqp_find cap must be at least 1, not {cap}.")
    if context < 0:
        raise ToolError(f"hqp_find context must be at least 0, not {context}.")
    require_manual()
    needle = term.lower()

    facts_lines = read_lines(authority.FACTS)
    readme_lines = read_lines(authority.README)
    manual_locator = _ManualLocator(authority.manual_sections())

    parts = [
        _render_group(
            authority.FACTS.name,
            authority.search_facts(needle),
            cap,
            context,
            lambda h: _locate_by_citation(facts_lines, h),
        ),
        _render_group(
            str(authority.MANUAL.relative_to(authority.ROOT)),
            authority.search_manual(needle),
            cap,
            context,
            manual_locator.locate,
        ),
        _render_group(
            authority.README.name,
            authority.search_readme(needle),
            cap,
            context,
            lambda h: _locate_by_citation(readme_lines, h),
        ),
    ]
    return "\n\n".join(parts)


def readme_headings(lines: list[str]) -> list[Heading]:
    """Parse (number, title, depth, line_index0) for every readme heading before OTHER LICENSES."""
    headings: list[Heading] = []
    for index0, line in enumerate(lines):
        if OTHER_LICENSES_MARKER.match(line):
            break
        match = HEADING_LINE.match(line)
        if not match:
            continue
        number, title = match.group(1), match.group(2)
        if not (ELEMENT_TITLE.match(title) or ALLCAPS_TITLE.match(title) or WORD_TITLE.match(title)):
            continue
        depth = number.count(".") + 1
        headings.append((number, title, depth, index0))
    return headings


def tool_hqp_toc() -> str:
    """Print the manual's section table plus the hqplayerd-readme.txt heading list."""
    require_manual()
    index_lines = read_lines(INDEX)
    section_lines: list[str] = []
    in_sections = False
    for line in index_lines:
        if line.strip() == "## Sections":
            in_sections = True
            section_lines.append(line)
            continue
        if in_sections and line.startswith("## ") and line.strip() != "## Sections":
            break
        if in_sections:
            section_lines.append(line)
    section_table = "\n".join(section_lines).rstrip()

    readme_lines = ["## hqplayerd-readme.txt headings"]
    for number, title, depth, index0 in readme_headings(read_lines(README)):
        readme_lines.append(f"{'  ' * (depth - 1)}{number} {title}  (line {index0 + 1})")

    return section_table + "\n\n" + "\n".join(readme_lines)


def tool_hqp_section(number: str) -> str:
    """Print the one docs/vendor/manual/ section file whose INDEX.md row carries `number`."""
    require_manual()
    number = number.strip().rstrip(".")
    for line in read_lines(INDEX):
        row = authority.INDEX_ROW.match(line)
        if row and row.group(1).rstrip(".") == number:
            filename = row.group(3)
            path = MANUAL / filename
            if not path.is_file():
                raise ToolError(f"section {number} names {filename}, which is missing from {MANUAL.relative_to(ROOT)}.")
            return path.read_text(encoding="utf-8", errors="replace")
    raise ToolError(f"no section {number!r} in {INDEX.relative_to(ROOT)}.")


def tool_hqp_page(page: int) -> str:
    """Print the manual text between "[page N]" and the next marker, across section files in filename order."""
    require_manual()
    target = str(page)
    out: list[str] = []
    current_page: str | None = None
    for path in sorted(MANUAL.glob("*.txt")):
        if path.name == "manual.txt":
            continue
        for line in read_lines(path):
            marker = authority.PAGE.match(line)
            if marker:
                current_page = marker.group(1)
                continue
            if current_page == target:
                out.append(line)
    if not out:
        raise ToolError(f"page {page} not found in {MANUAL.relative_to(ROOT)}.")
    return "\n".join(out)


def _find_readme_headings(key: str, headings: list[Heading]) -> list[Heading]:
    """Resolve `key` to its headings, by number (every heading carrying it) then by name (exactly one)."""
    if re.match(r"^\d+(\.\d+)*\.?$", key):
        number = key.rstrip(".")
        numbered = [heading for heading in headings if heading[0] == number]
        if not numbered:
            raise ToolError(f"no readme heading numbered {key!r}.")
        return numbered

    needle = key.lower()
    for heading in headings:
        element = ELEMENT_TITLE.match(heading[1])
        name = element.group(2) if element else heading[1]
        if name.lower() == needle:
            return [heading]
    partial = [heading for heading in headings if needle in heading[1].lower()]
    if len(partial) == 1:
        return partial
    if partial:
        candidates = ", ".join(f"{number} {title}" for number, title, _depth, _index0 in partial)
        raise ToolError(f"{key!r} matches several readme headings: {candidates}.")
    raise ToolError(f"no readme heading matching {key!r}.")


def _readme_block(lines: list[str], headings: list[Heading], heading: Heading) -> str:
    """Render one heading's block, through to the next heading of equal or shallower depth."""
    _number, _title, depth, start0 = heading
    end0 = next((i for i, line in enumerate(lines) if OTHER_LICENSES_MARKER.match(line)), len(lines))
    for _other_number, _other_title, other_depth, other_index0 in headings:
        if other_index0 > start0 and other_depth <= depth:
            end0 = other_index0
            break

    block = lines[start0:end0]
    numbered = [f"{start0 + i + 1}: {text}" for i, text in enumerate(block)]

    truncated = len(numbered) > README_CAP
    shown = numbered[:README_CAP]
    dropped: list[str] = []
    if truncated:
        cutoff_line0 = start0 + README_CAP
        for other_number, other_title, other_depth, other_index0 in headings:
            if start0 < other_index0 < end0 and other_depth > depth and other_index0 >= cutoff_line0:
                dropped.append(f"{other_number} {other_title}")

    out = "\n".join(shown)
    if truncated:
        out += f"\n\n[truncated at {README_CAP} lines; dropped subheadings: " + (", ".join(dropped) or "(none)") + "]"
    return out


def tool_hqp_readme(key: str) -> str:
    """Print the readme heading block `key` names; a number two headings share prints both."""
    key = key.strip()
    if not key:
        raise ToolError("hqp_readme needs a non-empty key.")
    lines = read_lines(README)
    headings = readme_headings(lines)
    if not headings:
        raise ToolError(f"{README.relative_to(ROOT)} is missing or has no headings.")
    matches = _find_readme_headings(key, headings)
    return "\n\n".join(_readme_block(lines, headings, heading) for heading in matches)
