#!/usr/bin/env python3
"""Look one term up in the HQPlayer authority sources, with citations attached.

Two subcommands:

  find    .venv/bin/python scripts/authority.py find "poly-sinc-gauss" [--cap 8]
  enum    .venv/bin/python scripts/authority.py enum

``find`` searches three sources, cheapest first, and prints every hit as the
quoted line plus the citation a finding can carry:

  1. ``docs/guide/notes/manual-facts.txt`` — cited by numbered heading and line.
  2. ``docs/official/manual/*.txt`` — cited by manual section and the ``[page N]``
     marker the hit falls under. ``manual.txt`` is the unsplit dump and is not
     searched.
  3. ``docs/official/hqplayerd-readme.txt`` — cited by line number, the coordinate ``sed -n``
     takes.

Matching is a case-insensitive substring, not a regex. Each group is capped
(``--cap``, default 8); a group with more hits than that says how many it
dropped, so a term too broad to trust is visible rather than silent.

``docs/official/manual/`` is gitignored and built by ``make manual``; ``find``
says so and exits when it is absent.

``enum`` prints the lists ``GET /api/enumerations`` serves, in wire order, as
names alone — the running engine is the authority for what things are called
and what order they come in, and nothing else here is.
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import httpx
else:
    try:
        import httpx
    except ImportError:
        httpx = None


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

    A `.claude/worktrees/*` checkout shares its `.git` with the main checkout
    but not the gitignored manual/readme copies, so the docs root is the
    parent of the git common dir, not this script's own directory. Falls
    back to this script's own repo root when no `.git` is found, or when the
    common dir is not a checkout's `.git` (a bare or separate git dir, whose
    parent is not a checkout).
    """
    common_dir = git_common_dir(Path(__file__).resolve().parent)
    if common_dir is not None and common_dir.name == ".git":
        return common_dir.parent
    return Path(__file__).resolve().parent.parent


ROOT = resolve_docs_root()
FACTS = ROOT / "docs" / "guide" / "notes" / "manual-facts.txt"
MANUAL = ROOT / "docs" / "official" / "manual"
README = ROOT / "docs" / "official" / "hqplayerd-readme.txt"

DEFAULT_CAP = 8
DEFAULT_URL = "http://127.0.0.1:8090"

# "1. FILTER FAMILIES AND PHASE" — a numbered top-level heading in manual-facts.txt.
HEADING = re.compile(r"^\d+\.\s+[A-Z]")
# "[page 27]" — the citable page marker scripts/build_manual.py leaves in every section file.
PAGE = re.compile(r"^\[page (\d+)\]\s*$")
# "| 4.6 | Filter / Oversampling selection | 27 | `04-06-filter-oversampling-selection.txt` |"
INDEX_ROW = re.compile(r"^\|\s*([\d.]+)\s*\|\s*(.+?)\s*\|\s*\d+\s*\|\s*`([^`]+)`\s*\|")

MISSING_MANUAL = (
    f"{MANUAL.relative_to(ROOT)} is not there: it is gitignored, derived from the manual PDF,\n"
    "and built by `make manual`. Run that first."
)


@dataclass
class Hit:
    """One matching line, with the citation it is quoted under."""

    citation: str
    text: str


def read_lines(path: Path) -> list[str]:
    """Return the file's lines with trailing newlines stripped, or an empty list when it is absent."""
    if not path.is_file():
        return []
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def search_facts(term: str) -> list[Hit]:
    """Search manual-facts.txt, citing each hit by the numbered heading it falls under and its line."""
    heading = "(preamble)"
    hits: list[Hit] = []
    for number, line in enumerate(read_lines(FACTS), start=1):
        if HEADING.match(line):
            heading = line.strip()
        if term in line.lower():
            hits.append(Hit(f"§{heading}:{number}", line.strip()))
    return hits


def manual_sections() -> dict[str, str]:
    """Map each section filename to "§<number> <title>", read out of the generated INDEX.md table."""
    sections: dict[str, str] = {}
    for line in read_lines(MANUAL / "INDEX.md"):
        row = INDEX_ROW.match(line)
        if row:
            sections[row.group(3)] = f"§{row.group(1)} {row.group(2)}"
    return sections


def search_section(path: Path, label: str, term: str) -> list[Hit]:
    """Search one manual section file, citing each hit by its label and the page marker above it."""
    page = ""
    hits: list[Hit] = []
    for line in read_lines(path):
        marker = PAGE.match(line)
        if marker:
            page = f" [page {marker.group(1)}]"
            continue
        if term in line.lower():
            hits.append(Hit(f"{label}{page}", line.strip()))
    return hits


def search_manual(term: str) -> list[Hit]:
    """Search every split manual section in section order, skipping the unsplit dump and the front matter."""
    sections = manual_sections()
    hits: list[Hit] = []
    for path in sorted(MANUAL.glob("*.txt")):
        if path.name in ("manual.txt", "00-00-front-matter.txt"):
            continue
        hits.extend(search_section(path, sections.get(path.name, path.name), term))
    return hits


def search_readme(term: str) -> list[Hit]:
    """Search hqplayerd-readme.txt, citing each hit by the line number sed -n takes."""
    return [
        Hit(f"{README.name}:{number}", line.strip())
        for number, line in enumerate(read_lines(README), start=1)
        if term in line.lower()
    ]


def print_group(name: str, hits: list[Hit], cap: int) -> None:
    """Print one source group: its header, then up to ``cap`` hits, saying how many were dropped."""
    shown = hits[:cap]
    tail = f", {len(shown)} shown" if len(hits) > cap else ""
    print(f"{name} ({len(hits)} hits{tail})")
    for hit in shown:
        print(f'  {hit.citation}  "{hit.text}"')
    print()


def cmd_find(term: str, cap: int) -> int:
    """Run the three searches in ladder order, or explain the missing manual build and stop."""
    if not (MANUAL / "INDEX.md").is_file():
        print(MISSING_MANUAL, file=sys.stderr)
        return 1
    needle = term.lower()
    print_group(FACTS.name, search_facts(needle), cap)
    print_group(str(MANUAL.relative_to(ROOT)), search_manual(needle), cap)
    print_group(README.name, search_readme(needle), cap)
    return 0


def fetch_enumerations(url: str) -> dict[str, Any] | None:
    """GET /api/enumerations, returning the decoded body or None after reporting why it failed."""
    if httpx is None:
        print("httpx is not installed; run this from .venv/bin/python for `enum`.", file=sys.stderr)
        return None
    try:
        response = httpx.get(f"{url}/api/enumerations", timeout=10.0)
        response.raise_for_status()
        body: dict[str, Any] = response.json()
    except (httpx.HTTPError, OSError, json.JSONDecodeError) as exc:
        print(f"{url}/api/enumerations: {exc}", file=sys.stderr)
        return None
    return body


def entry_name(entry: dict[str, Any]) -> str:
    """Return an entry's name, falling back to the rate it carries instead (the rates list has no name)."""
    return str(entry.get("name", entry.get("rate", "")))


def print_enumerations(body: dict[str, Any]) -> None:
    """Print every served list in wire order as index and name, then the current mode and staleness."""
    data = body.get("data", {})
    for key, value in data.items():
        if not isinstance(value, list):
            continue
        print(f"{key} ({len(value)})")
        for entry in value:
            print(f"  {entry.get('index', '')}  {entry_name(entry)}")
        print()
    mode = data.get("mode")
    if isinstance(mode, dict):
        print(f"mode: {mode.get('index', '')} {entry_name(mode)}")
    print(f"stale: {json.dumps(body.get('stale'))}")


def cmd_enum(url: str) -> int:
    """Print the enumeration lists the running engine serves, or fail with the reason."""
    body = fetch_enumerations(url)
    if body is None:
        return 1
    print_enumerations(body)
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the CLI arguments for both subcommands, requiring one of them."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = ap.add_subparsers(dest="command", required=True)
    find = subs.add_parser("find", help="search the manual facts, the split manual and the readme")
    find.add_argument("term")
    cap_help = f"hits per group (default {DEFAULT_CAP})"
    find.add_argument("--cap", type=int, default=DEFAULT_CAP, metavar="N", help=cap_help)
    enum = subs.add_parser("enum", help="print the enumeration lists the running engine serves")
    enum.add_argument("--url", default=DEFAULT_URL, help=f"HQPTuner base URL (default {DEFAULT_URL})")
    return ap.parse_args(argv)


def main(argv: list[str]) -> int:
    """Dispatch to the requested subcommand."""
    args = parse_args(argv)
    if args.command == "find":
        return cmd_find(args.term, args.cap)
    return cmd_enum(args.url)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
