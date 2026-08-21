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

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, cast

import pytest


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""


#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_changelog.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_changelog_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check
WORDS = GATE.words
WORD_CAP = GATE.WORD_CAP

#: The seven headings Keep a Changelog accepts here, in the order they go in.
#: Spelled out rather than read off the gate: the list is the contract.
KINDS = ("Added", "Changed", "Deprecated", "Removed", "Fixed", "Security", "Internal")

#: Everything above the section body, so a section's first line is line 7.
HEAD = "# Changelog\n\nNotable changes to HQPTuner.\n\n## [Unreleased]\n\n"

#: One entry breaking no rule: bold lead, one paragraph, third person, plain register.
CLEAN = "- **The thing works now.** It did not before, and the fix is in this release."


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
        raise FixtureError(f"expected {needle!r} on exactly one line, found it on {hits}")
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


def body_of(path: Path) -> list[tuple[int, str]]:
    """The ``[Unreleased]`` body of a written changelog, as ``unreleased()`` reads it."""
    body = GATE.unreleased(path.read_text(encoding="utf-8").splitlines())
    return cast("list[tuple[int, str]]", body)


# --- a clean section --------------------------------------------------------


def test_a_conformant_unreleased_section_passes_the_gate(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(CLEAN))) == 0


# --- the word cap -----------------------------------------------------------


def test_the_word_cap_is_seventy_five() -> None:
    """The number CONTRIBUTING.md publishes to entry writers, not an internal tuning knob."""
    assert WORD_CAP == 75


def test_a_bullet_over_the_word_cap_fails_the_gate(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(sized_bullet(WORD_CAP + 1)))) == 1


@pytest.mark.parametrize("expected", [str(WORD_CAP + 1), str(WORD_CAP)], ids=["actual count", "the cap"])
def test_an_over_long_bullet_is_reported_with_its_count_and_the_cap(tmp_path: Path, capsys: Any, expected: str) -> None:
    bullet = sized_bullet(WORD_CAP + 1)
    path = write_changelog(tmp_path, under_added(bullet))
    CHECK(path)
    assert expected in report(capsys.readouterr().out, path, bullet)


def test_a_bullet_at_exactly_the_word_cap_passes_the_gate(tmp_path: Path) -> None:
    """The cap is inclusive: hitting it is reaching it, not exceeding it."""
    assert CHECK(write_changelog(tmp_path, under_added(sized_bullet(WORD_CAP)))) == 0


def test_an_em_dash_added_to_a_bullet_at_the_cap_does_not_push_it_over(tmp_path: Path) -> None:
    """Punctuation carrying no letter or digit is not a word, so it costs nothing."""
    assert CHECK(write_changelog(tmp_path, under_added(sized_bullet(WORD_CAP, middle="— ")))) == 0


# --- word counting ----------------------------------------------------------


def test_words_counts_plain_words() -> None:
    assert WORDS("alpha beta gamma") == 3


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


def test_a_bullet_running_to_a_second_paragraph_fails_the_gate(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(CONTINUED))) == 1


def test_a_bullet_running_to_a_second_paragraph_is_reported_as_such(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, under_added(CONTINUED))
    CHECK(path)
    assert "paragraph" in report(capsys.readouterr().out, path, CONTINUED).lower()


def test_a_blank_line_between_two_bullets_does_not_make_the_second_a_continuation(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(CLEAN, CLEAN))) == 0


# --- the bold lead ----------------------------------------------------------

#: An entry with no bold lead, worded so the gate's own noun for the problem
#: appears nowhere in the fixture.
NO_LEAD = "- The thing works now, and it did not before."


def test_a_bullet_without_a_bold_lead_fails_the_gate(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(NO_LEAD))) == 1


def test_a_bullet_without_a_bold_lead_is_reported_as_such(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, under_added(NO_LEAD))
    CHECK(path)
    assert "bold" in report(capsys.readouterr().out, path, NO_LEAD).lower()


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
    tmp_path: Path, capsys: Any, bullet: str, word: str
) -> None:
    path = write_changelog(tmp_path, under_added(bullet))
    CHECK(path)
    assert word in report(capsys.readouterr().out, path, bullet).lower()


def test_a_word_merely_containing_a_second_person_word_passes_the_gate(tmp_path: Path) -> None:
    """The match is word-bounded: ``younger`` is not ``you``."""
    bullet = "- **Lead.** The younger release did the same."
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == 0


# --- marketing register -----------------------------------------------------


HYPE = [
    ("- **Lead.** The knob simply moves now.", "simply"),
    ("- **Lead.** The move is seamless now.", "seamless"),
    ("- **Lead.** The engine is powerful now.", "powerful"),
    ("- **Lead.** The knob finally moves.", "finally"),
    ("- **Lead.** The knob quietly moves now.", "quietly"),
    ("- **Lead.** The knob moves significantly faster.", "significantly"),
    ("- **Lead.** The knob just works now.", "just works"),
    ("- **Lead.** The change is under the hood.", "under the hood"),
    ("- **Lead.** It runs out of the box.", "out of the box"),
]


@pytest.mark.parametrize("bullet", [b for b, _ in HYPE], ids=[w for _, w in HYPE])
def test_a_bullet_in_marketing_register_fails_the_gate(tmp_path: Path, bullet: str) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == 1


@pytest.mark.parametrize("bullet,word", HYPE, ids=[w for _, w in HYPE])
def test_a_bullet_in_marketing_register_is_reported_with_the_offending_word(
    tmp_path: Path, capsys: Any, bullet: str, word: str
) -> None:
    path = write_changelog(tmp_path, under_added(bullet))
    CHECK(path)
    assert word in report(capsys.readouterr().out, path, bullet).lower()


def test_a_marketing_word_inside_a_longer_word_passes_the_gate(tmp_path: Path) -> None:
    """The match is word-bounded: ``simplynoise`` is not ``simply``."""
    bullet = "- **Lead.** The simplynoise generator is gone."
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == 0


# --- narration by negation --------------------------------------------------


NEGATION = [
    ("- **Lead.** The knob moves; the dial is unchanged.", "is unchanged"),
    ("- **Lead.** The dials are unchanged.", "are unchanged"),
    ("- **Lead.** The dial remains unchanged.", "remains unchanged"),
    ("- **Lead.** The dial is otherwise unchanged.", "otherwise unchanged"),
    ("- **Lead.** The dial is unaffected.", "unaffected"),
    ("- **Lead.** The dial is untouched.", "untouched"),
    ("- **Lead.** The dial moved and nothing changed.", "nothing changed"),
    ("- **Lead.** The dial moves and nothing else changes.", "nothing else changes"),
    ("- **Lead.** The dial moves and everything else works as before.", "everything else works as before"),
]


@pytest.mark.parametrize("bullet", [b for b, _ in NEGATION], ids=[p for _, p in NEGATION])
def test_a_bullet_narrating_by_negation_fails_the_gate(tmp_path: Path, bullet: str) -> None:
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == 1


@pytest.mark.parametrize("bullet,phrase", NEGATION, ids=[p for _, p in NEGATION])
def test_a_bullet_narrating_by_negation_is_reported_with_the_offending_phrase(
    tmp_path: Path, capsys: Any, bullet: str, phrase: str
) -> None:
    path = write_changelog(tmp_path, under_added(bullet))
    CHECK(path)
    assert phrase in report(capsys.readouterr().out, path, bullet).lower()


def test_a_negation_phrase_inside_a_longer_word_passes_the_gate(tmp_path: Path) -> None:
    """The match is word-bounded: ``unaffectedness`` is not ``unaffected``."""
    bullet = "- **Lead.** The unaffectedness score is gone."
    assert CHECK(write_changelog(tmp_path, under_added(bullet))) == 0


#: One marketing word and one negation phrase — two rules, one bullet.
HYPE_AND_NEGATION = "- **Lead.** The knob simply moves and the rest is unchanged."


def test_a_bullet_breaking_the_marketing_and_negation_rules_is_reported_twice(tmp_path: Path, capsys: Any) -> None:
    """The two wordlists are separate rules, so a bullet on both lists earns both reports."""
    path = write_changelog(tmp_path, under_added(HYPE_AND_NEGATION))
    CHECK(path)
    assert len(problem_lines(capsys.readouterr().out, path)) == 2


@pytest.mark.parametrize("expected", ["simply", "is unchanged"])
def test_both_wordlist_rules_a_single_bullet_breaks_are_named(tmp_path: Path, capsys: Any, expected: str) -> None:
    path = write_changelog(tmp_path, under_added(HYPE_AND_NEGATION))
    CHECK(path)
    assert expected in report(capsys.readouterr().out, path, HYPE_AND_NEGATION).lower()


# --- several rules at once --------------------------------------------------

#: No bold lead, second person, and a marketing word — three problems, one bullet.
TRIPLE = "- you should simply try it."


def test_a_bullet_breaking_three_rules_is_reported_three_times(tmp_path: Path, capsys: Any) -> None:
    """Once per rule broken, not once per bullet: a fixed entry has to clear them all."""
    path = write_changelog(tmp_path, under_added(TRIPLE))
    CHECK(path)
    assert len(problem_lines(capsys.readouterr().out, path)) == 3


@pytest.mark.parametrize("expected", ["bold", "you", "simply"])
def test_each_rule_a_single_bullet_breaks_is_named(tmp_path: Path, capsys: Any, expected: str) -> None:
    path = write_changelog(tmp_path, under_added(TRIPLE))
    CHECK(path)
    assert expected in report(capsys.readouterr().out, path, TRIPLE).lower()


def test_a_mix_of_bullet_and_heading_problems_fails_the_gate(tmp_path: Path) -> None:
    section = "### Fixed\n\n" + CLEAN + "\n\n### Added\n\n" + NO_LEAD + "\n"
    assert CHECK(write_changelog(tmp_path, section)) == 1


# --- headings ---------------------------------------------------------------

#: ``Changed`` twice, with an innocent ``Added`` above it in canonical order, so
#: naming the duplicated kind means naming the right one rather than every one.
DUPLICATE = "### Added\n\n" + CLEAN + "\n\n### Changed\n\n" + CLEAN + "\n\n### Changed\n\n" + CLEAN + "\n"
UNKNOWN = "### Tweaked\n\n" + CLEAN + "\n"
UNKNOWN_DEEP = under_added(CLEAN, CLEAN, CLEAN) + "\n### Tweaked\n\n" + CLEAN + "\n"
OUT_OF_ORDER = "### Fixed\n\n" + CLEAN + "\n\n### Added\n\n" + CLEAN + "\n"


def test_a_repeated_heading_fails_the_gate(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, DUPLICATE)) == 1


def test_a_repeated_heading_is_reported_with_its_kind(tmp_path: Path, capsys: Any) -> None:
    """The report has to say which heading came twice, so the writer knows what to merge."""
    path = write_changelog(tmp_path, DUPLICATE)
    CHECK(path)
    assert "Changed" in report(capsys.readouterr().out, path, CLEAN)


def test_a_repeated_heading_report_leaves_the_sections_other_headings_alone(tmp_path: Path, capsys: Any) -> None:
    """``Added`` appears once and is fine; a report naming it too is naming everything."""
    path = write_changelog(tmp_path, DUPLICATE)
    CHECK(path)
    assert "Added" not in report(capsys.readouterr().out, path, CLEAN)


def test_a_heading_of_an_unknown_kind_fails_the_gate(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, UNKNOWN)) == 1


def test_a_heading_of_an_unknown_kind_is_reported_with_its_kind(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, UNKNOWN_DEEP)
    CHECK(path)
    assert "Tweaked" in report(capsys.readouterr().out, path, CLEAN, "### Added")


def test_headings_out_of_keep_a_changelog_order_fail_the_gate(tmp_path: Path) -> None:
    assert CHECK(write_changelog(tmp_path, OUT_OF_ORDER)) == 1


def test_headings_out_of_keep_a_changelog_order_are_reported_as_such(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, OUT_OF_ORDER)
    CHECK(path)
    assert "order" in report(capsys.readouterr().out, path, CLEAN).lower()


@pytest.mark.parametrize("kind", KINDS)
def test_an_accepted_heading_kind_passes_the_gate(tmp_path: Path, kind: str) -> None:
    """All seven kinds are known; alone in a section, each is trivially in order."""
    assert CHECK(write_changelog(tmp_path, f"### {kind}\n\n{CLEAN}\n")) == 0


def test_every_accepted_heading_kind_in_canonical_order_passes_the_gate(tmp_path: Path) -> None:
    section = "".join(f"### {kind}\n\n{CLEAN}\n\n" for kind in KINDS)
    assert CHECK(write_changelog(tmp_path, section)) == 0


# --- scope ------------------------------------------------------------------

#: A released entry breaking most of the rules at once.
HISTORY = "\n## [1.2.3] — 2026-01-01\n\n### Nonsense\n\n- you simply get seamless output.\n"


def test_problems_in_a_released_section_pass_the_gate(tmp_path: Path) -> None:
    """Released sections are history: the scan stops at the next ``## `` heading."""
    assert CHECK(write_changelog(tmp_path, under_added(CLEAN), released=HISTORY)) == 0


def test_a_released_sections_offending_words_are_not_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, under_added(CLEAN), released=HISTORY)
    CHECK(path)
    assert "seamless" not in capsys.readouterr().out


def test_a_changelog_with_no_unreleased_section_passes_the_gate(tmp_path: Path) -> None:
    path = tmp_path / "CHANGELOG.md"
    path.write_text("# Changelog\n\nNotable changes." + HISTORY, encoding="utf-8")
    assert CHECK(path) == 0


# --- how a problem is printed -----------------------------------------------


def test_a_problem_is_printed_with_the_file_path(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, under_added(NO_LEAD))
    CHECK(path)
    assert str(path) in capsys.readouterr().out


def test_a_problem_is_printed_with_the_1_indexed_line_number_of_the_bullet(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, under_added(CLEAN, CLEAN, CLEAN, CLEAN, NO_LEAD))
    CHECK(path)
    reported = report(capsys.readouterr().out, path, NO_LEAD)
    assert str(line_of(path, NO_LEAD)) in reported


def test_a_heading_problem_is_printed_with_the_line_number_of_the_heading(tmp_path: Path, capsys: Any) -> None:
    path = write_changelog(tmp_path, UNKNOWN_DEEP)
    CHECK(path)
    reported = report(capsys.readouterr().out, path, CLEAN)
    assert str(line_of(path, "### Tweaked")) in reported


# --- the reading helpers ----------------------------------------------------


def test_unreleased_gives_a_body_line_with_its_1_indexed_line_number(tmp_path: Path) -> None:
    path = write_changelog(tmp_path, under_added(CLEAN))
    assert (line_of(path, CLEAN), CLEAN) in [(number, text.strip()) for number, text in body_of(path)]


def test_unreleased_stops_at_the_next_version_heading(tmp_path: Path) -> None:
    path = write_changelog(tmp_path, under_added(CLEAN), released=HISTORY)
    assert not [text for _, text in body_of(path) if "seamless" in text]


def test_entries_gives_one_tuple_per_bullet(tmp_path: Path) -> None:
    path = write_changelog(tmp_path, under_added(CLEAN, CLEAN, CLEAN))
    assert len(GATE.entries(body_of(path))) == 3


def test_entries_gives_a_bullets_1_indexed_line_number(tmp_path: Path) -> None:
    path = write_changelog(tmp_path, under_added(NO_LEAD))
    assert [number for number, _ in GATE.entries(body_of(path))] == [line_of(path, NO_LEAD)]


def test_entries_carries_a_bullets_continuation_lines(tmp_path: Path) -> None:
    path = write_changelog(tmp_path, under_added(CONTINUED))
    assert "indented beneath it" in " ".join(GATE.entries(body_of(path))[0][1])


def test_headings_gives_the_kind_of_every_heading_in_the_section(tmp_path: Path) -> None:
    path = write_changelog(tmp_path, OUT_OF_ORDER)
    assert [kind for _, kind in GATE.headings(body_of(path))] == ["Fixed", "Added"]


def test_headings_gives_a_headings_1_indexed_line_number(tmp_path: Path) -> None:
    path = write_changelog(tmp_path, UNKNOWN)
    assert [number for number, _ in GATE.headings(body_of(path))] == [line_of(path, "### Tweaked")]


# --- the command line -------------------------------------------------------


def test_main_returns_zero_when_the_named_path_is_clean(tmp_path: Path, monkeypatch: Any) -> None:
    path = write_changelog(tmp_path, under_added(CLEAN))
    monkeypatch.setattr(sys, "argv", ["check_changelog.py", str(path)])
    assert GATE.main() == 0


def test_main_returns_one_when_the_named_path_has_a_problem(tmp_path: Path, monkeypatch: Any) -> None:
    path = write_changelog(tmp_path, under_added(NO_LEAD))
    monkeypatch.setattr(sys, "argv", ["check_changelog.py", str(path)])
    assert GATE.main() == 1


def test_main_returns_one_when_one_of_several_paths_has_a_problem(tmp_path: Path, monkeypatch: Any) -> None:
    clean = write_changelog(tmp_path, under_added(CLEAN))
    dirty_dir = tmp_path / "other"
    dirty_dir.mkdir()
    dirty = write_changelog(dirty_dir, under_added(NO_LEAD))
    monkeypatch.setattr(sys, "argv", ["check_changelog.py", str(clean), str(dirty)])
    assert GATE.main() == 1


def test_main_checks_every_path_it_is_given(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    """The second path is read, not short-circuited away by the first one passing."""
    clean = write_changelog(tmp_path, under_added(CLEAN))
    dirty_dir = tmp_path / "other"
    dirty_dir.mkdir()
    dirty = write_changelog(dirty_dir, under_added(NO_LEAD))
    monkeypatch.setattr(sys, "argv", ["check_changelog.py", str(clean), str(dirty)])
    GATE.main()
    assert problem_lines(capsys.readouterr().out, dirty)
