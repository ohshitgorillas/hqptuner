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
from pathlib import Path

import authority

Locate = Callable[["authority.Hit"], "tuple[list[str], int] | None"]

README_CAP = 200

# A dotted heading number, optionally trailing-dotted, at the start of a line:
# "1.12 Element "matrix_profile""  "3.8 HQPLAYER_IDLE_TIME"  "1. CONFIGURATION GUIDE"
HEADING_LINE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$")
ELEMENT_TITLE = re.compile(r'^(Element|Sub-element)\s+"(.+)"$')
ALLCAPS_TITLE = re.compile(r"^[A-Z][A-Z0-9 _/,()\-]*$")

OTHER_LICENSES_MARKER = re.compile(r"^4\.\s+OTHER LICENSES\s*$")


def _worktree_common_dir(git_file: Path, candidate: Path) -> Path | None:
    """Resolve a worktree's `.git` file (`gitdir: ...`) to the main checkout's common dir.

    That directory's own `commondir` file holds the (usually relative) path
    back to the main checkout's `.git`, which is what makes a worktree see
    the main checkout's gitignored files.
    """
    try:
        content = git_file.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not content.startswith("gitdir:"):
        return None
    gitdir = Path(content.split(":", 1)[1].strip())
    if not gitdir.is_absolute():
        gitdir = (candidate / gitdir).resolve()
    commondir_file = gitdir / "commondir"
    if not commondir_file.is_file():
        return gitdir
    try:
        relative = commondir_file.read_text(encoding="utf-8").strip()
    except OSError:
        return gitdir
    return (gitdir / relative).resolve()


def git_common_dir(start: Path) -> Path | None:
    """Return the same path `git rev-parse --path-format=absolute --git-common-dir` would, or None.

    Walks up from `start` looking for `.git`. A plain checkout's `.git` is a
    directory and is its own common dir; a worktree's `.git` is a file,
    resolved by `_worktree_common_dir`. Reads the same on-disk layout git
    itself does, without shelling out.
    """
    for candidate in (start, *start.parents):
        git_path = candidate / ".git"
        if git_path.is_dir():
            return git_path
        if git_path.is_file():
            return _worktree_common_dir(git_path, candidate)
    return None


def resolve_docs_root() -> Path:
    """Return the checkout that holds the gitignored docs sources.

    A `.claude/worktrees/*` checkout shares its `.git` with the main
    checkout but not the gitignored manual/readme copies, so the docs root
    is the parent of the git common dir, not this script's own directory.
    Falls back to this script's own repo root when no `.git` is found.
    """
    common_dir = git_common_dir(Path(__file__).resolve().parent)
    if common_dir is not None:
        return common_dir.parent
    return Path(__file__).resolve().parent.parent


ROOT = resolve_docs_root()
MANUAL = ROOT / "docs" / "vendor" / "manual"
INDEX = MANUAL / "INDEX.md"
README = ROOT / "hqplayerd-readme.txt"
MANUAL_PDF = ROOT / "hqplayer6desktop-manual.pdf"

INDEX_ROW = re.compile(r"^\|\s*([\d.]+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|")


class ToolError(Exception):
    """A tool-level failure: reported as isError true, never as a protocol error."""


def read_lines(path: Path) -> list[str]:
    """Return the file's lines with trailing newlines stripped, or an empty list when it is absent."""
    if not path.is_file():
        return []
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


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
    return None


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
    if not term:
        raise ToolError("hqp_find needs a non-empty term.")
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


def readme_headings() -> list[tuple[str, str, int, int]]:
    """Parse (number, title, depth, line_index0) for every readme heading before OTHER LICENSES."""
    headings: list[tuple[str, str, int, int]] = []
    for index0, line in enumerate(read_lines(README)):
        if OTHER_LICENSES_MARKER.match(line):
            break
        match = HEADING_LINE.match(line)
        if not match:
            continue
        number, rest = match.group(1), match.group(2)
        if ELEMENT_TITLE.match(rest) or ALLCAPS_TITLE.match(rest):
            title = rest
        else:
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
    for number, title, depth, index0 in readme_headings():
        readme_lines.append(f"{'  ' * (depth - 1)}{number} {title}  (line {index0 + 1})")

    return section_table + "\n\n" + "\n".join(readme_lines)


def tool_hqp_section(number: str) -> str:
    """Print the one docs/vendor/manual/ section file whose INDEX.md row carries `number`."""
    require_manual()
    for line in read_lines(INDEX):
        row = INDEX_ROW.match(line)
        if row and row.group(1) == number:
            filename = row.group(4)
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


def _find_readme_heading(key: str, headings: list[tuple[str, str, int, int]]) -> tuple[str, str, int, int]:
    """Resolve `key` to one (number, title, depth, line_index0) heading, by number then by name."""
    if re.match(r"^\d+(\.\d+)*\.?$", key):
        number = key.rstrip(".")
        for heading in headings:
            if heading[0] == number:
                return heading
        raise ToolError(f"no readme heading numbered {key!r}.")

    needle = key.lower()
    for number, title, depth, index0 in headings:
        element = ELEMENT_TITLE.match(title)
        name = element.group(2) if element else title
        if name.lower() == needle:
            return (number, title, depth, index0)
    for number, title, depth, index0 in headings:
        if needle in title.lower():
            return (number, title, depth, index0)
    raise ToolError(f"no readme heading matching {key!r}.")


def tool_hqp_readme(key: str) -> str:
    """Print one readme heading block, through to the next heading of equal or shallower depth."""
    if not key:
        raise ToolError("hqp_readme needs a non-empty key.")
    headings = readme_headings()
    if not headings:
        raise ToolError(f"{README.relative_to(ROOT)} is missing or has no headings.")
    _number, _title, depth, start0 = _find_readme_heading(key, headings)

    end0 = len(read_lines(README))
    for _other_number, _other_title, other_depth, other_index0 in headings:
        if other_index0 <= start0:
            continue
        if other_depth <= depth:
            end0 = other_index0
            break

    lines = read_lines(README)
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
