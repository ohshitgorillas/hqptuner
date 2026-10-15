#!/usr/bin/env python3
"""Gate: every tracked file is written in American spelling.

The gate reads each file it is handed and reports every British spelling on a
fixed British-to-American list, one problem per word, opening with
``<path>:<line>:`` and naming the American form to use.

The list holds whole words, never suffix patterns: ``optimise`` is on it and
``-ise`` is not, so ``noise``, ``promise``, ``precise`` and ``optimistic`` never
trip it. A listed word matches case-insensitively anywhere inside a run of
letters, so it is found inside an identifier on a ``_`` or camelCase boundary
(``write_labelled_report``, ``isCancelled``) and inside a run-on name
(``jblabelledreport``, ``centrergb``). An inflection that ends in a letter the
listed word does not carry (``colours``, ``optimised``, ``unlabelled``) is
covered by the word it contains; one that rewrites the ending (``centred``,
``optimising``, ``normalisation``) is listed in its own right. The longest
listed word wins where two overlap.

Exempt:

* third-party files, under ``hqptuner/static/vendor/`` and ``docs/official/``;
* three third-party API names: Python's ``.cancelled()`` and
  ``CancelledError``, and the HTML attribute ``aria-labelledby``;
* this gate, which holds the British list, and its test, which spells British
  examples.

``analyses`` is the plural of ``analysis`` in American English as well as a
British verb form, so that one word is never reported.

A file holding a NUL byte is binary, carries no spelling and is skipped.

Usage: ``python scripts/gates/check_spelling.py $(git ls-files)``
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

#: British word to American word, each a whole word in its own right.
WORDS: dict[str, str] = {
    "colour": "color",
    "neighbour": "neighbor",
    "honour": "honor",
    "favour": "favor",
    "favourite": "favorite",
    "flavour": "flavor",
    "behaviour": "behavior",
    "harbour": "harbor",
    "humour": "humor",
    "rumour": "rumor",
    "labour": "labor",
    "vapour": "vapor",
    "odour": "odor",
    "rigour": "rigor",
    "vigour": "vigor",
    "armour": "armor",
    "endeavour": "endeavor",
    "centre": "center",
    "centred": "centered",
    "centring": "centering",
    "metre": "meter",
    "metred": "metered",
    "litre": "liter",
    "fibre": "fiber",
    "calibre": "caliber",
    "grey": "gray",
    "licence": "license",
    "licenced": "licensed",
    "defence": "defense",
    "offence": "offense",
    "labelled": "labeled",
    "labelling": "labeling",
    "cancelled": "canceled",
    "cancelling": "canceling",
    "cancellable": "cancelable",
    "modelled": "modeled",
    "modelling": "modeling",
    "levelled": "leveled",
    "levelling": "leveling",
    "travelled": "traveled",
    "travelling": "traveling",
    "signalled": "signaled",
    "signalling": "signaling",
    "channelled": "channeled",
    "tunnelled": "tunneled",
    "fuelled": "fueled",
    "dialled": "dialed",
    "dialling": "dialing",
    "bezelled": "bezeled",
    "analyse": "analyze",
    "analysing": "analyzing",
    "paralyse": "paralyze",
    "catalyse": "catalyze",
    "practise": "practice",
    "manoeuvre": "maneuver",
}

#: Stems that take ``-ise`` in British spelling and ``-ize`` in American; each
#: yields the whole words ``<stem>ise``, ``<stem>ising`` and ``<stem>isation``.
ISE_STEMS = (
    "optim",
    "normal",
    "recogn",
    "summar",
    "organ",
    "capital",
    "minim",
    "maxim",
    "initial",
    "serial",
    "custom",
    "priorit",
    "visual",
    "real",
    "util",
    "final",
    "synchron",
    "standard",
    "categor",
    "apolog",
    "emphas",
    "author",
    "local",
    "memor",
    "sanit",
    "token",
    "random",
    "quant",
    "parametr",
    "special",
    "stabil",
    "central",
    "general",
    "global",
    "character",
    "material",
    "neutral",
    "penal",
    "harmon",
    "vapor",
    "vector",
)

#: Words that hold a listed word yet are American spellings themselves.
AMERICAN = frozenset({"analyses", "paralyses", "catalyses"})

#: Third-party API names that carry a British spelling the repo cannot change.
API_NAMES = re.compile(r"\.cancelled\(\)|\bCancelledError\b|\baria-labelledby\b")

#: Third-party directories, as runs of path components.
THIRD_PARTY = (("hqptuner", "static", "vendor"), ("docs", "official"))

#: The repository root, which the gate's own files are found under.
ROOT = Path(__file__).resolve().parent.parent.parent

#: This gate and its test, which carry British words on purpose.
OWN_FILES = frozenset({Path(__file__).resolve(), ROOT / "tests" / "gates" / "test_check_spelling.py"})

#: A run of letters, the unit a British word is found in and reported as.
LETTERS = re.compile(r"[A-Za-z]+")


def word_list() -> dict[str, str]:
    """Build the full British-to-American list, the ``-ise`` stems expanded."""
    words = dict(WORDS)
    for stem in ISE_STEMS:
        for british, american in (("ise", "ize"), ("ising", "izing"), ("isation", "ization")):
            words[stem + british] = stem + american
    return words


LIST = word_list()

#: Every listed word, longest first so the longest overlapping word wins.
BRITISH = re.compile("|".join(sorted(LIST, key=len, reverse=True)), re.IGNORECASE)


def match_case(model: str, word: str) -> str:
    """Spell ``word`` in the case of ``model``: all capitals, capitalized, or lower."""
    if model.isupper() and len(model) > 1:
        return word.upper()
    if model[0].isupper():
        return word.capitalize()
    return word


def american(run: str) -> str | None:
    """Respell the run of letters in American, or return None when it is American already."""
    if run.casefold() in AMERICAN:
        return None
    fixed = BRITISH.sub(lambda m: match_case(m.group(0), LIST[m.group(0).casefold()]), run)
    return fixed if fixed != run else None


def third_party(path: Path) -> bool:
    """Whether the file sits under a third-party directory."""
    parts = path.parts
    return any(parts[i : i + len(run)] == run for run in THIRD_PARTY for i in range(len(parts)))


def line_problems(label: str, number: int, line: str) -> list[str]:
    """Every British word on one line, with the American form to use."""
    problems = []
    for run in LETTERS.findall(API_NAMES.sub(" ", line)):
        fixed = american(run)
        if fixed is not None:
            problems.append(f"{label}:{number}: {run} is British spelling; use {fixed}")
    return problems


def check_file(path: Path) -> list[str]:
    """Every British spelling in one file, in line order."""
    data = path.read_bytes()
    if b"\0" in data:
        return []
    problems = []
    for number, line in enumerate(data.decode("utf-8", errors="replace").splitlines(), start=1):
        problems.extend(line_problems(str(path), number, line))
    return problems


def main(argv: list[str]) -> int:
    """Refuse any British spelling in the files handed over, outside third-party files."""
    problems = []
    for path in map(Path, argv):
        if path.is_file() and not third_party(path) and path.resolve() not in OWN_FILES:
            problems.extend(check_file(path))
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        print(f"\n{len(problems)} British spelling(s); use the American form", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
