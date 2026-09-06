---
name: copy-rules
description: HQPTuner user-facing text rules: owner-approved verbatim copy, what needs sign-off and what does not, the standing owner rulings, the data/*.json register, HQPlayer-derived copy that is off limits, and changelog scope. Load before touching user-facing text, data/*.json, or CHANGELOG.md.
---

# Copy rules

## Owner-approved, verbatim

Every piece of user-facing text (labels, popover prose, hints, tooltips, captions, button summaries, error copy, changelog entries) ships only with the owner's explicit approval, verbatim. Agent-drafted copy is a proposal until signed off; owner-drafted copy is the spec, character for character, and gets no additions, trims, appended clarifications or improvements. Factual errors in owner copy are flagged in discussion and the corrected wording approved before it ships. Em dashes are forbidden in user-facing text, enforced by gate. Rewording during a bug fix or refactor is still a copy change.

## Sign-off scope

The rule is about prose and judgment copy: paragraphs, headings, captions, hints, tooltips, popover text, changelog lines. It does not reach utility strings: control labels (Rate, Phase, Length), option names (Linear, Minimum, None), units (ms, kHz, dB), chip names, toggle names, readout keys, button text. Ship those with sensible wording and let the owner correct in the browser. Bring only prose, titles, captions and hints for approval, as a short list of real alternatives; a sign-off list padded with "ms" and "None" buries the two items that need a decision.

## Owner rulings are rules

A ruling on style, spelling, defaults or design framing applies across every surface it touches (labels, changelog, tips, docs, commit prose) silently. Never re-raise a settled item as an owed decision in a later revision. Standing rulings:

- Obvious mechanical slips in owner copy (capitalization, typos, punctuation, hyphenation consistency) get fixed on the way in, silently.
- American spelling everywhere (favor, color, analyze, center, -ize). Scan for -our/-ise/-yse/-re before hand-back; never offer spelling as a choice.
- A dropdown where the manual flags exactly one option Recommended gets no Recommended mark and no legend; a lone recommendation is the default. Count the flags first: one flagged means zero `rec` keys, two or more means flag all.
- A style ruling stated once ("Extra-short / Extra-long, hyphenate for consistency") covers every surface, changelog included.
- A fork with one plainly better branch is mine to pick, mentioned in one clause. Only genuinely defensible forks go to the owner.

Pushback: substance yes, style no. Factual errors in the owner's premises or copy get flagged with cited evidence and the corrected wording approved before shipping. Never argue the owner's design or wording down on a consistency convention I introduced; if my objection rests on my own symmetry rather than a fact or a gate, say so in one line and build their version. Ask only when two of the owner's own rules genuinely collide.

## `hqptuner/data/*.json` register

Descriptions, notes, tooltips and option blurbs use terse datasheet English close to the HQPlayer manual's own wording.

1. A blurb opens with a bare noun phrase; a sentence-initial subject stays bare ("Frequency response rolls off slowly", "Number of taps is 4096x conversion ratio", "Default is \"XFi\"").
2. Articles inside the sentence stay: objects, complements, prepositional phrases, subjects of mid-sentence subordinate clauses ("applied in the time domain", "if the playback rate is"). Owner-ruled exceptions keep "The": "The length of this filter can be configured", "The IIR filter is applied in the time domain". Parenthetical "for example" takes commas both sides. Oxford comma in lists.
3. A real syntax break gets the minimal fix only (comma splice to semicolon, dangling participle gets its subject).

Notation: 4096x-style multipliers, ≥/≤ for rate comparisons, hi-res, passband, half-band, "sinc filter", "linear phase" unhyphenated, "single-pass" hyphenated.

Judge each sentence by ear against these rules. Anything uncertain goes to the owner as a candidate list with the original beside it before editing. Never derive a new rule from one or two rulings and sweep it across the corpus.

## HQPlayer-derived copy is off limits

Filter names, plain names and descriptions in `data/filter-plain-names.json` and the other filter `data/*.json` are HQPlayer's, not the agent's to rewrite, whatever was approved in discussion. A request to change what an option-style mode displays ("drop X from Simplified mode") is a render-path change: strip or gate at the display seam (`store/plainnames.js` composes `display`/`closedLabel`; `store/prose.js` joins description notes and can gate on the `plainNames` pref), leave the overlay untouched, keep Standard style and the raw engine name unchanged. `tests/api/test_metadata_plain_names.py` requires table-wide unique `short` labels and unique family/variant/leaf/apod identities; uniqueness is table-wide, not per chain.

The `phase` field in `filters.json` was matched against Signalyst's published linear/intermediate/minimum phase filter counts and is authoritative with the manual. Where Signalyst is silent, copy states no phase; the owner's own filter knowledge never overrides the manual. Honor `_join_rules`: a `-2s` key strips the suffix and inherits the base entry, so a naive key lookup falsely reads "no phase".

## Changelog scope

An entry is for a change a reader of a shipped release would notice. Work quarantined to its own feature branch gets no entry there; the entry lands in the merge-to-dev change when the owner says the feature ships. A feature already sitting under `[Unreleased]` gets one entry, and later refinements or bug fixes to it get none; grep `[Unreleased]` before drafting a line at the plan gate. The entry is written at stage 2, approved before implementation, landed verbatim; style is gated by `scripts/gates/check_changelog.py` per `CONTRIBUTING.md` (one line, bold lead, at most 75 words, no second person, no marketing register, no implementation archaeology).
