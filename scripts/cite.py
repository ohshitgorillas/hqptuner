#!/usr/bin/env python3
"""Resolve the citations in a plan against the tree.

A plan's citations are retyped by hand out of a `gauntlet-detective` table, and
nothing checks the retyping. The tree is frozen while a plan is drafted and
reviewed, so a citation that does not resolve is a transcription error and
nothing else: a mistyped path, a grep hit cited instead of the construct, a bare
`:49` inheriting the wrong file, a range off the end, a number typed from
memory. The whole class is decidable without reading a sentence, which is what
makes it a script's job rather than a reviewer's.

A citation is a backticked `path:line` or `path:line-line`. The path may be
omitted -- `:49` -- to continue the nearest preceding full citation. A number in
prose without backticks is not a citation and is never resolved.

    --check DOC   one row per reported citation, exit 1 where any row fails
    --fix DOC     fill a number from its quoted anchor where the anchor is
                  unique in the file, refusing on zero matches or several

The failing rows are `MISSING` (no such path), `RANGE` (a number or span past
the end of the file), `AMBIGUOUS` (a basename more than one path carries),
`ORPHAN` (a bare number with no full citation before it) and `QUOTE` (a number
pointing at a line that does not contain the text quoted beside it).

Two rows print whether or not they fail, and neither sets the exit code.
`INHERITED-FROM` prints on every bare continuation, and `CROSS-REPO` on every
citation resolving outside this checkout. They are the cases where the script
resolved something the author cannot see in the text they wrote. Plans here are
written mostly in continuations, so a screen of `INHERITED-FROM` rows is the
normal output of a clean document, not a warning.

The guarantee is one sentence: the number points at a line containing that
quote. A citation carrying no quoted text is checked for existence only, and
that is the majority shape. A green `--check` says nothing whatever about
whether a cited line supports the sentence around it -- that judgment is the
`gauntlet-prosecutor`'s check (b), and it is untouched by this script.

The checkout root is resolved from this file's own path, never from the cwd, so
a worktree checks its own copy of a document.
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP = {".git", ".venv", ".pytest_cache", "node_modules", "__pycache__"}

_SPAN = re.compile(r"`([^`\n]+)`")
_CITE = re.compile(r"^(?P<path>[^\s`]*):(?P<start>\d+)(?:-(?P<end>\d+))?$")
_QUOTE = re.compile(r'"([^"\n]+)"')

FAILING = ("MISSING", "RANGE", "AMBIGUOUS", "ORPHAN", "QUOTE")


class Citation:
    """One backticked citation, as written and where it sits in the document."""

    def __init__(self, path, start, end, row, col_start, col_end):
        self.path = path            # as written, "" on a bare continuation
        self.start = start
        self.end = end              # == start where the citation names one line
        self.row = row              # 0-based index into the document's lines
        self.col_start = col_start  # offsets of the text inside the backticks
        self.col_end = col_end
        self.anchor = ""            # the quoted text beside it, "" where none
        self.inherited = ""         # the path a bare continuation resolved to
        self.resolved = None        # Path, or None where it did not resolve
        self.verdict = "OK"
        self.detail = ""

    @property
    def text(self):
        span = f"{self.start}" if self.end == self.start else f"{self.start}-{self.end}"
        return f"{self.path}:{span}"

    @property
    def bare(self):
        return self.path == ""

    @property
    def named(self):
        """The path the citation is about: its own, or the one it inherited."""
        return self.path or self.inherited


REACH = 80  # how far from a citation a quote may sit and still be its anchor


def quotes_in(line):
    """The double-quoted spans of one document line, code spans excluded.

    A quote inside backticks is source text a sentence is showing, not text the
    sentence claims a line carries: `sys.exit(... if "--self-test" in argv ...)`
    quotes nothing about the tree.
    """
    code = [(s.start(), s.end()) for s in _SPAN.finditer(line)]
    out = []
    for found in _QUOTE.finditer(line):
        if any(s <= found.start() and found.end() <= e for s, e in code):
            continue
        out.append(found)
    return out


def anchor_pairs(line, cites):
    """Bind each quote on the line to at most one citation, and set anchors.

    A plan writes the quote after the citation -- `docs/plans.md:37` requires
    them, "A claim about the tree carries `file:line`" -- far more often than
    before it, so a following quote is claimed first and a preceding one only
    by a citation that found none. One quote binds once: where two citations
    sit either side of it, the one it follows has already taken it, and the
    second is a citation with no anchor rather than one with the wrong anchor.

    A backtick in the gap ends the reach, and so does a sentence end. A code
    span between the two means the quote is about that span rather than this
    citation, and a quote in the next sentence is about the next sentence: the
    plans here are soft-wrapped, so one document line is a whole paragraph and
    an unbounded reach would pair a citation with a quote several claims away.
    """
    quotes = quotes_in(line)
    taken = set()

    def reachable(gap):
        if len(gap) > REACH or "`" in gap:
            return False
        return not any(end in gap for end in (". ", "; ", "! ", "? "))

    for cite in cites:
        for i, found in enumerate(quotes):
            if i in taken or found.start() < cite.col_end:
                continue
            if reachable(line[cite.col_end + 1:found.start()]):
                cite.anchor = found.group(1)
                taken.add(i)
            break
    for cite in cites:
        if cite.anchor:
            continue
        for i in reversed(range(len(quotes))):
            found = quotes[i]
            if i in taken or found.end() > cite.col_start:
                continue
            if reachable(line[found.end():cite.col_start - 1]):
                cite.anchor = found.group(1)
                taken.add(i)
            break


def parse(text):
    """Every citation in the document, in document order."""
    found = []
    for row, line in enumerate(text.splitlines()):
        here = []
        for span in _SPAN.finditer(line):
            hit = _CITE.match(span.group(1))
            if not hit:
                continue
            start = int(hit.group("start"))
            end = int(hit.group("end")) if hit.group("end") else start
            here.append(
                Citation(hit.group("path"), start, end, row, span.start(1), span.end(1))
            )
        anchor_pairs(line, here)
        found += here
    return found


def candidates(name):
    """Every path in the checkout carrying that basename."""
    hits = []
    for path in ROOT.rglob(name):
        #: relative to ROOT, so a directory name above the checkout decides
        #: nothing: a root that is itself a worktree searches its own tree
        parts = path.relative_to(ROOT).parts
        if any(part in SKIP for part in parts):
            continue
        if "worktrees" in parts:
            continue  # a worktree carries a second copy of every path in the tree
        if path.is_file():
            hits.append(path)
    return sorted(hits)


def resolve(cite):
    """Set `resolved`, and a failing verdict where the path does not land."""
    named = cite.named
    if not named:
        cite.verdict = "ORPHAN"
        return
    path = Path(named)
    if path.is_absolute():
        try:
            path.relative_to(ROOT)
        except ValueError:
            cite.detail = "outside the checkout"
        if not path.is_file():
            cite.verdict = "MISSING"
            return
        cite.resolved = path
        return
    if "/" in named:
        target = ROOT / named
        if not target.is_file():
            cite.verdict = "MISSING"
            return
        cite.resolved = target
        return
    hits = candidates(named)
    if not hits:
        cite.verdict = "MISSING"
    elif len(hits) > 1:
        cite.verdict = "AMBIGUOUS"
        cite.detail = ", ".join(str(h.relative_to(ROOT)) for h in hits)
    else:
        cite.resolved = hits[0]


def lines_of(path):
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def judge(cite):
    """The verdict for one citation whose path resolved."""
    rows = lines_of(cite.resolved)
    if cite.start < 1 or cite.end > len(rows) or cite.end < cite.start:
        cite.verdict = "RANGE"
        cite.detail = f"the file has {len(rows)} lines"
        return
    if not cite.anchor:
        return
    span = rows[cite.start - 1:cite.end]
    if not any(cite.anchor in row for row in span):
        cite.verdict = "QUOTE"
        cite.detail = span[0].strip()


def check(text):
    """Every citation in the document, resolved and judged, in order."""
    cites = parse(text)
    carried = ""
    for cite in cites:
        if cite.bare:
            cite.inherited = carried
        resolve(cite)
        if cite.resolved is not None:
            judge(cite)
        if not cite.bare:
            carried = (
                str(cite.resolved) if cite.resolved is not None else cite.path
            )
        if cite.bare and cite.inherited:
            cite.inherited = str(cite.resolved) if cite.resolved else cite.inherited
    return cites


def shown(path):
    """A resolved path, repo-relative where it is in the checkout."""
    try:
        return str(Path(path).relative_to(ROOT))
    except ValueError:
        return str(path)


def rows_for(cite):
    """The rows one citation prints: its standing rows, then its failure."""
    out = []
    if cite.bare:
        where = shown(cite.inherited) if cite.inherited else "nothing"
        out.append(f"INHERITED-FROM  `{cite.text}`  {where}")
    if cite.resolved is not None and cite.detail == "outside the checkout":
        out.append(f"CROSS-REPO      `{cite.text}`  {cite.resolved}")
    if cite.verdict in FAILING:
        where = shown(cite.resolved) if cite.resolved is not None else cite.named
        row = f"{cite.verdict:<15} `{cite.text}`  {where}"
        if cite.detail and cite.detail != "outside the checkout":
            row += f"  {cite.detail}"
        out.append(row)
    return out


def report(text):
    out = []
    for cite in check(text):
        out += rows_for(cite)
    return out


def fixes(text):
    """One `(citation, number)` per citation this document can fill, and one
    `(citation, None)` per citation whose anchor is not unique in its file."""
    out = []
    for cite in check(text):
        if cite.verdict not in ("QUOTE", "RANGE") or not cite.anchor:
            continue
        if cite.resolved is None:
            continue
        hits = [
            i + 1 for i, row in enumerate(lines_of(cite.resolved))
            if cite.anchor in row
        ]
        out.append((cite, hits[0] if len(hits) == 1 else None))
    return out


def apply_fixes(text):
    """The document with every fillable number filled, and the rows to print."""
    rows, edits = [], []
    for cite, number in fixes(text):
        if number is None:
            rows.append(f"REFUSED         `{cite.text}`  the anchor is not unique")
            continue
        rows.append(f"FIXED           `{cite.text}`  -> `{cite.path}:{number}`")
        edits.append((cite, number))

    lines = text.splitlines(keepends=True)
    for cite, number in sorted(edits, key=lambda e: (e[0].row, e[0].col_start), reverse=True):
        line = lines[cite.row]
        lines[cite.row] = (
            line[:cite.col_start] + f"{cite.path}:{number}" + line[cite.col_end:]
        )
    return "".join(lines), rows


def main(argv):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", metavar="DOC", help="resolve and report, exit 1 on a failing row")
    mode.add_argument("--fix", metavar="DOC", help="fill a number from its unique quoted anchor")
    args = ap.parse_args(argv)

    doc = Path(args.check or args.fix)
    text = doc.read_text(encoding="utf-8")

    if args.check:
        rows = report(text)
        for row in rows:
            print(row)
        return 1 if any(row.split()[0] in FAILING for row in rows) else 0

    fixed, rows = apply_fixes(text)
    for row in rows:
        print(row)
    if fixed != text:
        doc.write_text(fixed, encoding="utf-8")
    return 0


def self_test():
    """Pin the rules of the grammar and the two modes, on a throwaway tree."""
    import tempfile

    global ROOT
    keep = ROOT
    rules = {}
    with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as away:
        tree, elsewhere = Path(tmp), Path(away)
        ROOT = tree
        (tree / "docs").mkdir()
        (tree / "other").mkdir()
        (tree / "docs" / "a.md").write_text("one\ntwo\nthree\n", encoding="utf-8")
        (tree / "docs" / "b.md").write_text("alpha\nbeta\n", encoding="utf-8")
        (tree / "docs" / "twin.md").write_text("x\n", encoding="utf-8")
        (tree / "other" / "twin.md").write_text("x\n", encoding="utf-8")
        (tree / "docs" / "pair.md").write_text("first half\nsecond half\n", encoding="utf-8")
        (tree / "docs" / "twice.md").write_text("same\nsame\n", encoding="utf-8")
        outside = elsewhere / "OUT.md"
        outside.write_text("out one\nout two\n", encoding="utf-8")

        def codes(doc):
            return [row.split()[0] for row in report(doc)]

        rules["1 a path absent from the checkout is MISSING, one present is not"] = (
            codes("`docs/nope.md:1`") == ["MISSING"] and codes("`docs/a.md:1`") == []
        )
        rules["2 a span past the file's last line is RANGE, one ending on it is not"] = (
            codes("`docs/a.md:2-9`") == ["RANGE"] and codes("`docs/a.md:2-3`") == []
        )
        rules["3 a basename two paths carry is AMBIGUOUS, one path carries resolves"] = (
            codes("`twin.md:1`") == ["AMBIGUOUS"] and codes("`pair.md:1`") == []
        )
        rules["4 a bare number with no full citation before it is ORPHAN"] = (
            codes("`:2`") == ["INHERITED-FROM", "ORPHAN"]
            and codes("`docs/a.md:1` and `:2`") == ["INHERITED-FROM"]
        )
        rules["5 INHERITED-FROM prints on a passing continuation and a failing one"] = (
            codes("`docs/a.md:1` `:2`") == ["INHERITED-FROM"]
            and codes("`docs/a.md:1` `:9`") == ["INHERITED-FROM", "RANGE"]
        )
        rules["6 a bare number inherits the nearest preceding path, not the first"] = (
            report("`docs/a.md:1` `docs/b.md:1` `:2`")[-1].endswith("docs/b.md")
            and report("`docs/b.md:1` `docs/a.md:1` `:2`")[-1].endswith("docs/a.md")
        )
        rules["7 an anchor is read on the cited line only, never elsewhere in the file"] = (
            codes('`docs/a.md:2` "two"') == []
            and codes('`docs/a.md:1` "two"') == ["QUOTE"]
        )
        rules["8 an anchor on a span's second line passes, one on neither fails"] = (
            codes('`docs/pair.md:1-2` "second half"') == []
            and codes('`docs/pair.md:1-2` "nowhere"') == ["QUOTE"]
        )
        rules["9 a citation with no anchor is checked for existence only"] = (
            codes("the sentence says something else entirely `docs/a.md:2`") == []
            and codes("the sentence says something else entirely `docs/a.md:9`") == ["RANGE"]
        )
        rules["10 a path outside the checkout resolves, and prints CROSS-REPO"] = (
            codes(f"`{outside}:1`") == ["CROSS-REPO"]
            and codes(f"`{elsewhere / 'gone.md'}:1`") == ["MISSING"]
        )
        rules["11 only a backticked path:line is a citation"] = (
            codes("`docs/a.md:1` and docs/a.md:99 in prose") == []
            and codes("`docs/a.md:1` and `docs/a.md:99`") == ["RANGE"]
        )
        unique, _ = apply_fixes('`docs/a.md:1` "three"')
        several, _ = apply_fixes('`docs/twice.md:9` "same"')
        rules["12 --fix fills from a unique anchor and refuses on several"] = (
            unique == '`docs/a.md:3` "three"'
            and several == '`docs/twice.md:9` "same"'
        )
        both = '`docs/a.md:3` "three" and `docs/a.md:1` "two"'
        rules["13 --fix moves the citation that missed its anchor and no other"] = (
            apply_fixes(both)[0] == '`docs/a.md:3` "three" and `docs/a.md:2` "two"'
        )
    ROOT = keep

    for label, ok in rules.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(rules.values()) else 1


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main(sys.argv[1:]))
