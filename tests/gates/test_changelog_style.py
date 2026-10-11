"""The gate that holds ``CHANGELOG.md``'s ``[Unreleased]`` section to the house entry style.

``scripts/gates/check_changelog.py`` reads a changelog and reports style
problems in its ``## [Unreleased]`` section only — released sections are
history and are never rewritten, so they are never reported on. The rules it
enforces are the mechanical half of the entry spec in ``CONTRIBUTING.md``: a
word cap, one paragraph per entry, a bold lead, no second person, no marketing
register, and ``###`` headings that are unique, known, and in Keep a Changelog
order.

These cases write minimal changelogs under ``tmp_path`` and point the script's
public functions at them. Observable contract is what a caller gets: the int
exit code from ``check()``, the int from ``main()``, what lands on stdout, and
the tuples the reading helpers return. Nothing here reads the gate's internals
— the two problem-collecting functions are private and are exercised only
through ``check()``.

Every assertion about *what a report says* runs through ``report()``, which
strips both the changelog's filesystem path and the fixture's own source text
out of the captured output first. Without that, a gate that merely echoed the
offending line back would satisfy a bare substring match, and the assertion
would stop constraining the moment the report format changed.
"""

from pathlib import Path

import check_changelog
import pytest
from narrow import FixtureError

CHECK = check_changelog.check
WORDS = check_changelog.words
WORD_CAP = check_changelog.WORD_CAP

#: The seven headings Keep a Changelog accepts here, in the order they go in.
#: Spelled out rather than read off the gate: the list is the contract.
KINDS = ("Added", "Changed", "Deprecated", "Removed", "Fixed", "Security", "Internal")

#: Everything above the section body, so a section's first line is line 7.
HEAD = "# Changelog\n\nNotable changes to HQPTuner.\n\n## [Unreleased]\n\n"

#: One entry breaking no rule: bold lead, one paragraph, third person, plain register.
CLEAN = "- **The thing works now.** It did not before, and the fix is in this release."

#: An entry with no bold lead, worded so the gate's own noun for the problem
#: appears nowhere in the fixture.
NO_LEAD = "- The thing works now, and it did not before."


def write_changelog(tmp_path: Path, section: str, released: str = "") -> Path:
    """Write a changelog whose ``[Unreleased]`` section body is ``section``."""
    path = tmp_path / "CHANGELOG.md"
    path.write_text(HEAD + section + released, encoding="utf-8")
    return path


def under_added(*bullets: str) -> str:
    """A section body: one ``### Added`` heading and the bullets beneath it."""
    return "### Added\n\n" + "\n\n".join(bullets) + "\n"


def sized_bullet(count: int, middle: str = "") -> str:
    """A conformant bullet counting exactly ``count`` words, plus optional punctuation."""
    return "- **Lead.** " + middle + " ".join(["thing"] * (count - 1))


def line_of(path: Path, needle: str) -> int:
    """The 1-indexed line number of the single line of ``path`` holding ``needle``."""
    hits = [n for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1) if needle in line]
    if len(hits) != 1:
        raise FixtureError(reason=f"expected {needle!r} on exactly one line, found it on {hits}")
    return hits[0]


def report(out: str, path: Path, *sources: str) -> str:
    """Captured stdout with the changelog's path and each fixture's own text removed.

    ``tmp_path`` is named after the test function, so words and digits from a
    test's name turn up inside any path the gate echoes back; and a report that
    quoted the offending line verbatim would satisfy any substring match drawn
    from that line. Removing both first means only the gate's own wording can
    match.
    """
    text = out.replace(str(path), "")
    for source in sources:
        text = text.replace(source, "")
    return text


def problem_lines(out: str, path: Path) -> list[str]:
    """The stdout lines reporting a problem — the ones naming the file."""
    return [line for line in out.splitlines() if str(path) in line]


# --- a clean section --------------------------------------------------------


@pytest.mark.parametrize(("entry", "code"), [(CLEAN, 0), (NO_LEAD, 1)], ids=["clean", "no lead"])
def test_a_conformant_unreleased_section_passes_the_gate(tmp_path: Path, entry: str, code: int) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(entry))) == code


# --- the word cap -----------------------------------------------------------


@pytest.mark.parametrize("expected", [str(WORD_CAP + 1), str(WORD_CAP)], ids=["actual count", "the cap"])
def test_an_over_long_bullet_is_reported_with_its_count_and_the_cap(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], expected: str
) -> None:
    bullet = sized_bullet(WORD_CAP + 1)
    path = write_changelog(tmp_path, under_added(bullet))
    CHECK(path)
    assert expected in report(capsys.readouterr().out, path, bullet)


@pytest.mark.parametrize(("count", "code"), [(WORD_CAP, 0), (WORD_CAP + 1, 1)], ids=["at the cap", "one over"])
def test_a_bullet_at_exactly_the_word_cap_passes_the_gate(tmp_path: Path, count: int, code: int) -> None:
    """The cap is inclusive: hitting it is reaching it, not exceeding it."""
    assert CHECK(write_changelog(tmp_path, under_added(sized_bullet(count)))) == code


# --- word counting ----------------------------------------------------------


def test_words_ignores_a_standalone_em_dash() -> None:
    """Naive splitting counts four here; the em dash carries no letter or digit."""
    assert WORDS("alpha — beta gamma") == 3


def test_words_ignores_the_content_of_a_code_span() -> None:
    """A code span is a token of syntax, not prose the reader has to wade through."""
    assert WORDS("alpha `code span here` beta") == 2


def test_words_ignores_a_standalone_pair_of_bold_asterisks() -> None:
    """Naive splitting counts four here; ``**`` alone is a marker, not a word."""
    assert WORDS("**Bold lead.** ** tail") == 3


def test_words_ignores_a_standalone_underscore_emphasis_marker() -> None:
    """Naive splitting counts three here; ``_`` alone is a marker, not a word."""
    assert WORDS("_emphasis_ _ tail") == 2


# --- paragraphs -------------------------------------------------------------

#: A bullet running on into a second block, worded so the gate's own noun for the
#: problem appears nowhere in the fixture.
CONTINUED = "- **Lead.** First block of text.\n\n  A second block indented beneath it."


@pytest.mark.parametrize(
    ("section", "code"), [(under_added(CLEAN, CLEAN), 0), (under_added(CONTINUED), 1)], ids=["two bullets", "continued"]
)
def test_a_blank_line_between_two_bullets_does_not_make_the_second_a_continuation(
    tmp_path: Path, section: str, code: int
) -> None:
    assert CHECK(write_changelog(tmp_path, section)) == code


# --- second person ----------------------------------------------------------


SECOND_PERSON = [
    ("- **Lead.** This is the one you asked for.", "you"),
    ("- **Lead.** It follows your setup now.", "your"),
    ("- **Lead.** The choice is yours here.", "yours"),
    ("- **Lead.** The check runs yourself out of it.", "yourself"),
    ("- **Lead.** Your setup drives it now.", "your"),
]


@pytest.mark.parametrize("bullet", [b for b, _ in SECOND_PERSON], ids=[w for _, w in SECOND_PERSON])
def test_a_bullet_in_second_person_fails_the_gate(tmp_path: Path, bullet: str) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == 1


@pytest.mark.parametrize("bullet,word", SECOND_PERSON, ids=[w for _, w in SECOND_PERSON])
def test_a_bullet_in_second_person_is_reported_with_the_offending_word(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], bullet: str, word: str
) -> None:
    path = write_changelog(tmp_path, under_added(bullet))
    CHECK(path)
    assert word in report(capsys.readouterr().out, path, bullet).lower()


@pytest.mark.parametrize(
    ("bullet", "code"),
    [("- **Lead.** The younger release did the same.", 0), ("- **Lead.** This is the one you asked for.", 1)],
    ids=["younger", "you"],
)
def test_a_word_merely_containing_a_second_person_word_passes_the_gate(tmp_path: Path, bullet: str, code: int) -> None:
    """The match is word-bounded: ``younger`` is not ``you``."""
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == code


# --- marketing register -----------------------------------------------------


@pytest.mark.parametrize(
    ("bullet", "code"),
    [("- **Lead.** The simplynoise generator is gone.", 0), ("- **Lead.** The knob simply moves now.", 1)],
    ids=["simplynoise", "simply"],
)
def test_a_marketing_word_inside_a_longer_word_passes_the_gate(tmp_path: Path, bullet: str, code: int) -> None:
    """The match is word-bounded: ``simplynoise`` is not ``simply``."""
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == code


# --- narration by negation --------------------------------------------------


@pytest.mark.parametrize(
    ("bullet", "code"),
    [("- **Lead.** The unaffectedness score is gone.", 0), ("- **Lead.** The dial is unaffected.", 1)],
    ids=["unaffectedness", "unaffected"],
)
def test_a_negation_phrase_inside_a_longer_word_passes_the_gate(tmp_path: Path, bullet: str, code: int) -> None:
    """The match is word-bounded: ``unaffectedness`` is not ``unaffected``."""
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == code


#: One marketing word and one negation phrase — two rules, one bullet.
HYPE_AND_NEGATION = "- **Lead.** The knob simply moves and the rest is unchanged."


def test_a_bullet_breaking_the_marketing_and_negation_rules_is_reported_twice(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The two wordlists are separate rules, so a bullet on both lists earns both reports."""
    path = write_changelog(tmp_path, under_added(HYPE_AND_NEGATION))
    CHECK(path)
    assert len(problem_lines(capsys.readouterr().out, path)) == 2


@pytest.mark.parametrize("expected", ["simply", "is unchanged"])
def test_both_wordlist_rules_a_single_bullet_breaks_are_named(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], expected: str
) -> None:
    path = write_changelog(tmp_path, under_added(HYPE_AND_NEGATION))
    CHECK(path)
    assert expected in report(capsys.readouterr().out, path, HYPE_AND_NEGATION).lower()


# --- several rules at once --------------------------------------------------

#: No bold lead, second person, and a marketing word — three problems, one bullet.
TRIPLE = "- you should simply try it."


def test_a_bullet_breaking_three_rules_is_reported_three_times(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Once per rule broken, not once per bullet: a fixed entry has to clear them all."""
    path = write_changelog(tmp_path, under_added(TRIPLE))
    CHECK(path)
    assert len(problem_lines(capsys.readouterr().out, path)) == 3


# --- headings ---------------------------------------------------------------

UNKNOWN_DEEP = under_added(CLEAN, CLEAN, CLEAN) + "\n### Tweaked\n\n" + CLEAN + "\n"
OUT_OF_ORDER = "### Fixed\n\n" + CLEAN + "\n\n### Added\n\n" + CLEAN + "\n"


def test_a_heading_of_an_unknown_kind_is_reported_with_its_kind(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = write_changelog(tmp_path, UNKNOWN_DEEP)
    CHECK(path)
    assert "Tweaked" in report(capsys.readouterr().out, path, CLEAN, "### Added")


#: Every accepted kind once, in Keep a Changelog order.
CANONICAL = "".join(f"### {kind}\n\n{CLEAN}\n\n" for kind in KINDS)


@pytest.mark.parametrize(
    ("section", "code"), [(CANONICAL, 0), (OUT_OF_ORDER, 1)], ids=["canonical order", "out of order"]
)
def test_every_accepted_heading_kind_in_canonical_order_passes_the_gate(
    tmp_path: Path, section: str, code: int
) -> None:
    assert CHECK(write_changelog(tmp_path, section)) == code


# --- scope ------------------------------------------------------------------

#: A released entry breaking most of the rules at once.
HISTORY = "\n## [1.2.3] — 2026-01-01\n\n### Nonsense\n\n- you simply get seamless output.\n"


@pytest.mark.parametrize(
    ("entry", "released", "code"),
    [(CLEAN, HISTORY, 0), (NO_LEAD, "", 1)],
    ids=["released problems", "unreleased problem"],
)
def test_problems_in_a_released_section_pass_the_gate(tmp_path: Path, entry: str, released: str, code: int) -> None:
    """Released sections are history: the scan stops at the next ``## `` heading."""
    assert CHECK(write_changelog(tmp_path, under_added(entry), released=released)) == code


@pytest.mark.parametrize(
    ("text", "code"),
    [("# Changelog\n\nNotable changes." + HISTORY, 0), (HEAD + under_added(NO_LEAD), 1)],
    ids=["no unreleased section", "unreleased problem"],
)
def test_a_changelog_with_no_unreleased_section_passes_the_gate(tmp_path: Path, text: str, code: int) -> None:
    path = tmp_path / "CHANGELOG.md"
    path.write_text(text, encoding="utf-8")
    assert CHECK(path) == code


# --- how a problem is printed -----------------------------------------------


def test_a_heading_problem_is_printed_with_the_line_number_of_the_heading(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = write_changelog(tmp_path, UNKNOWN_DEEP)
    CHECK(path)
    reported = report(capsys.readouterr().out, path, CLEAN)
    assert str(line_of(path, "### Tweaked")) in reported


# --- the command line -------------------------------------------------------


@pytest.mark.parametrize(("entry", "code"), [(CLEAN, 0), (NO_LEAD, 1)], ids=["clean", "dirty"])
def test_main_returns_zero_only_when_the_named_path_is_clean(tmp_path: Path, entry: str, code: int) -> None:
    assert check_changelog.main([str(write_changelog(tmp_path, under_added(entry)))]) == code
