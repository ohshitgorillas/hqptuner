#!/usr/bin/env python3
"""Gate: a test never asserts a string it did not put on the wire itself (docs/testing.md rule 9).

A sentence inside an ``assert`` or a ``pytest.raises(match=...)`` is copy unless
the tests themselves seeded it: a fixture body, a fake's reply, a request
payload. Copy is owner-owned data, reworded at will, and a test pinning it goes
red on a rewording and green on a broken behavior. The mechanical shape caught
here is a literal of two or more words in an assertion position; the principle
behind it is what review checks.

What counts as seeded, for a literal the assert compares against:

* it appears verbatim somewhere in the test file outside an assertion, in any
  ``*.py`` under the suite's ``tests/support/``, or as an argument the assert
  line itself hands to a plain function (``assert WORDS("alpha beta") == 2`` is
  counting the sentence, not looking for it);
* it lies inside a longer seeded string or inside a file under
  ``tests/support/fixtures/``;
* it is composed entirely of seeded strings joined by whitespace or punctuation;
* it fully matches an f-string a fake wrote, holes standing for anything.

An argument to a *method* on the value under test (``body.count("...")``) is not
input; it is the test searching output for wording, and stays reported. The
``tests`` root is the nearest ancestor directory of that name; a file with none
has no shared pool.

Usage: ``check_no_copy_assertions.py [--report] <test files>``. ``--report``
prints the findings and a count per category and exits 0, for sizing; without
it any finding fails the gate.
"""

from __future__ import annotations

import ast
import re
import sys
from collections import Counter
from functools import cache
from pathlib import Path
from typing import NamedTuple

#: Two alphabetic words separated by a space: the shape of prose, not of an identifier.
PROSE = re.compile(r"[A-Za-z]{2,} [A-Za-z]{2,}")
#: Wire shapes that happen to contain spaces: XML frames, key=value, JSON bodies.
WIRE = re.compile(r"[<=>{}]")
#: What may sit between two seeded pieces of a composed literal.
GLUE = re.compile(r"[\s\W]*")


class Pool(NamedTuple):
    """Everything the tests are known to have written."""

    seeds: frozenset[str]
    texts: tuple[str, ...]
    skeletons: tuple[re.Pattern[str], ...]


def _is_prose(text: str) -> bool:
    return bool(PROSE.search(text)) and not WIRE.search(text)


def _strings(node: ast.AST) -> list[ast.Constant]:
    return [n for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _skeleton(node: ast.JoinedStr) -> re.Pattern[str] | None:
    """Turn an f-string into an anchored pattern, holes as ``.*``; None when no part is prose."""
    parts = [
        re.escape(v.value) if isinstance(v, ast.Constant) and isinstance(v.value, str) else ".*" for v in node.values
    ]
    literal = [v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str)]
    if not any(_is_prose(text) for text in literal):
        return None
    return re.compile("".join(parts), re.DOTALL)


def _skeletons(tree: ast.AST) -> list[re.Pattern[str]]:
    found = (_skeleton(n) for n in ast.walk(tree) if isinstance(n, ast.JoinedStr))
    return [p for p in found if p is not None]


def _raises_match(node: ast.Call) -> ast.expr | None:
    if not (isinstance(node.func, ast.Attribute) and node.func.attr == "raises"):
        return None
    return next((kw.value for kw in node.keywords if kw.arg == "match"), None)


def _split(node: ast.AST, asserted: list[ast.Constant], handed: list[ast.Constant]) -> None:
    """Sort the strings under an assertion into compared literals and plain-call inputs."""
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
            handed.extend(s for arg in child.args for s in _strings(arg))
            handed.extend(s for kw in child.keywords for s in _strings(kw.value))
        elif isinstance(child, ast.Constant) and isinstance(child.value, str):
            asserted.append(child)
        else:
            _split(child, asserted, handed)


def _targets(tree: ast.Module) -> list[tuple[str, ast.AST]]:
    targets: list[tuple[str, ast.AST]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assert):
            targets.append(("assert-literal", node.test))
        elif isinstance(node, ast.Call) and (match := _raises_match(node)) is not None:
            targets.append(("raises-match", match))
    return targets


def _asserted(tree: ast.Module) -> tuple[list[tuple[int, str, str]], set[int], list[str]]:
    """Return the compared literals as (lineno, category, text), their node ids, and the handed-over inputs."""
    found: list[tuple[int, str, str]] = []
    seen: set[int] = set()
    handed: list[ast.Constant] = []
    for category, target in _targets(tree):
        compared: list[ast.Constant] = []
        if isinstance(target, ast.Constant) and isinstance(target.value, str):
            compared.append(target)
        else:
            _split(target, compared, handed)
        for sub in compared:
            seen.add(id(sub))
            found.append((sub.lineno, category, str(sub.value)))
    return found, seen, [str(s.value) for s in handed]


def _tests_root(path: Path) -> Path | None:
    return next((parent for parent in path.resolve().parents if parent.name == "tests"), None)


@cache
def _shared_pool(root: Path | None) -> Pool:
    """Gather what ``tests/support`` wrote: literals and f-strings of its modules, bytes of its fixtures."""
    if root is None:
        return Pool(frozenset(), (), ())
    seeds: set[str] = set()
    skeletons: list[re.Pattern[str]] = []
    for module in sorted((root / "support").rglob("*.py")):
        tree = ast.parse(module.read_text(), filename=str(module))
        seeds.update(str(n.value) for n in _strings(tree))
        skeletons.extend(_skeletons(tree))
    fixtures = root / "support" / "fixtures"
    texts = tuple(f.read_text(errors="ignore") for f in sorted(fixtures.rglob("*")) if f.is_file())
    for text in texts:  # a fixture file is a literal too: whole, and line by line
        seeds.update(line.strip() for line in (text, *text.splitlines()))
    return Pool(frozenset(seeds), texts, tuple(skeletons))


def _composed(text: str, seeds: frozenset[str], pos: int = 0) -> bool:
    """Tell whether ``text[pos:]`` is seeded pieces with only glue between them."""
    glue = GLUE.match(text, pos)
    pos = glue.end() if glue else pos
    if pos == len(text):
        return True
    return any(text.startswith(seed, pos) and _composed(text, seeds, pos + len(seed)) for seed in seeds)


def _covered(text: str, pool: Pool) -> bool:
    if text in pool.seeds or any(text in t for t in pool.texts):
        return True
    if any(p.fullmatch(text) for p in pool.skeletons):
        return True
    return _composed(text, pool.seeds)


def _file_pool(tree: ast.Module, seen: set[int], handed: list[str], shared: Pool) -> Pool:
    own = {str(n.value) for n in _strings(tree) if id(n) not in seen} | set(handed)
    seeds = frozenset(s for s in own | shared.seeds if PROSE.search(s))
    return Pool(seeds, shared.texts + tuple(own), shared.skeletons + tuple(_skeletons(tree)))


def check_file(path: Path) -> list[tuple[str, str]]:
    """Return (category, location) for each prose literal asserted but never seeded by the tests."""
    tree = ast.parse(path.read_text(), filename=str(path))
    asserted, seen, handed = _asserted(tree)
    pool = _file_pool(tree, seen, handed, _shared_pool(_tests_root(path)))
    return [
        (category, f"{path}:{lineno} {category}: {text!r}")
        for lineno, category, text in asserted
        if _is_prose(text) and not _covered(text, pool)
    ]


def main(argv: list[str]) -> int:
    """Refuse a test asserting prose it did not seed; with --report, count and pass."""
    report = "--report" in argv
    findings = [f for name in argv if name != "--report" for f in check_file(Path(name))]
    for _, line in findings:
        print(line)
    if report:
        for category, count in sorted(Counter(c for c, _ in findings).items()):
            print(f"{category}: {count} site(s)")
        print(f"copy assertions: {len(findings)} total (report only)")
        return 0
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
