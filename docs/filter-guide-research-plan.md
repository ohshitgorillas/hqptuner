# Filter guidance card — research plan

Plan authored 2026-07-29 for a single executing agent. Research only — no implementation, no UI code, no plan for UI code. Output is one document: `docs/filter-guide.md`. Implementation planning happens later, separately, through the plan gate.

**Execution discipline (binding):** phases run strictly in order, one at a time. Finish a phase — deliverable written into the working draft, exit check passed — before reading anything for the next. Do not interleave, do not batch phases "for efficiency", do not start web research before both extraction phases are complete. Each phase below states what it consumes, what it produces, and how to know it is done.

## Goal

HQPTuner's Resampling tab gets a guidance card explaining common filter terms in **plain English** — what each term means for the sound. The manual already carries the technical explanations; the card translates, it does not duplicate. This plan produces the researched, cited raw material that card copy will be written from.

## Locked scope decisions (user, 2026-07-29 — do not reopen)

1. **Facets only.** The seven terms in the term inventory below. Filter *families* (poly-sinc vs sinc vs gauss vs closed-form vs IIR vs polynomial) are OUT — per-filter prose already lives in `hqptuner/data/filters.json` descriptions.
2. **SDM side OUT.** Modulators, integrators, `direct_sdm` — not covered.
3. **Descriptive stance.** No audibility verdicts in either direction — never "you can hear this", never "you can't". State what the filter does (e.g. minimum phase puts all ringing after the transient; linear phase splits it before and after); the listener judges. Published audibility thresholds are background for the researcher, not card content.

## Term inventory (frozen)

Exact UI strings the card must explain, verified against the working tree 2026-07-29:

| # | Term | UI surface | Values / label strings |
|---|---|---|---|
| 1 | Phase | narrow bar, `hqptuner/static/components/NarrowBar.js:51-56` | Linear / Minimum / Intermediate |
| 2 | Length | narrow bar, `NarrowBar.js:57-62` | Short / Medium / Long / Extra long |
| 3 | Focus | narrow bar, `NarrowBar.js:46-50` | Transients / Timbre / Space |
| 4 | Quality | narrow bar, `NarrowBar.js:40-45` | n/5 — relative guidance, not absolute (manual §4.6 intro) |
| 5 | Ratio | narrow bar, `NarrowBar.js:66-70` | Integer / 2× / 1:1, plus Upsample-only checkbox |
| 6 | Genre | narrow bar, `NarrowBar.js:28-39` | manual's own genre column, not editorial |
| 7 | Apodizing | per-chain 1x control, `hqptuner/static/components/ApodNarrow.js` | full / half / none |

Adjacent, in scope as supporting glosses (they share the tab and collide with the terms above):

- **Two-stage `-2s` suffix** — `hqptuner/data/filters.json` `two_stage_note` is the authoritative text; card needs at most one plain sentence.
- **"Filter length" card = `fft_size`** — `hqptuner/static/components/tabs/ResamplingTab.js:99-101`. A DIFFERENT thing from facet Length (tap count). Same word, same screen. Research must characterize both precisely so the collision can be surfaced; **resolving the naming is the user's call — flag it, do not pick**.

## Facts already verified this session (reuse, do not re-derive)

- Length facet classification logic and tap-count grounding: `hqptuner/static/store/facets.js:91-128` (sinc letter series, million-tap filters, `LENGTH_OVERRIDES`).
- Phase parsed from filter name suffixes (`-lp`/`-mp`/`-ip`): `facets.js:83-89`.
- Quality/focus/ratio ship live in FiltersItem descriptions; apodizing in arg bit 0, half in bit 1: `facets.js` header comment.
- `filters.json` `guidance` block already holds plain-ish notes: `1x_vs_nx`, `apodizing` (Apod-counter rule), `quality_ratings`, `author_recommendation`.
- No help/explainer UI exists anywhere in the app — the card is new construction.
- Manual §4.6 per-filter prose uses the vocabulary the card must translate: pre-ringing / post-ringing, "analog-sounding", passband ripple, attenuation, "optimal transient response".

## Claim policy (binding for the output document)

Two tiers, every claim tagged:

- **`[sourced]`** — stated in the HQPlayer manual, the hqplayerd readme, or reached literature. Carries a citation: `file:line` for on-disk sources, URL + access note for web. Verbatim quote preserved alongside any paraphrase.
- **`[structural]`** — arithmetic/DSP entailment, true by construction (e.g. a minimum-phase FIR concentrates all ringing after the impulse; total ringing energy relates to transition-band steepness and filter length). Must be an entailment a DSP text would state, not a plausibility.

Nothing untagged ships. Subjective/reported-experience claims ("sounds smoother", "more analog") are **omitted**, not hedged — with one exception: the manual's own subjective language may be quoted as the manual's characterization, attributed to it explicitly.

Verification tags for web sources follow `docs/eq-assistant/SOURCES.md` legend: `[V]` read primary directly, `[VA]` delegated agent returned verbatim quote + URL, `[S]` secondary only, `[X]` unreachable — `[S]` and `[X]` material stays off the card.

## Phases

### Phase 1 — On-disk extraction: HQPlayer's own docs

**Consumes:** `docs/vendor/manual/04-04-pcm.txt`, `04-05-sdm.txt` (only where it defines a facet term used on the PCM side), `04-06-filter-oversampling-selection.txt` (495 lines — read all of it), `04-07-advanced.txt`, `02-06-apodization.txt`, `02-08-20-khz-filter.txt` if it touches facet terms, and `hqplayerd-readme.txt` (notably §1.2 `fft_size`).

**Produces:** a claims table — one row per sentence that attaches a meaning or sonic consequence to one of the seven facets (or to `-2s` / `fft_size`). Columns: facet · verbatim quote · `file:line` · which UI value(s) it grounds. Facet-attached claims only; per-filter color commentary that doesn't generalize to a facet is skipped (families are out of scope).

**Delegation note:** the two source sets (manual sections vs readme) are independent — two read-only extraction lanes may run in parallel *within this phase*. Verify every returned `file:line` by spot-reading before accepting; an unverified subagent quote is a confabulation.

**Exit check:** every one of the seven facets plus the two supporting glosses has at least one row, or an explicit "manual is silent on X" entry. `fft_size` semantics quoted from the readme verbatim.

### Phase 2 — Reuse audit: existing research corpus

**Consumes:** `docs/eq-assistant/PHASE.md` (primary — already covers minimum vs linear phase, pre-ringing, and states pre-echo originates at the oversampling filter), `PSYCHOACOUSTICS.md`, `SOURCES.md`, `FILTER-MATH.md` — facet-relevant sections only.

**Produces:** list of already-verified structural facts usable under the claim policy, each with its existing citation and verification tag carried over. Explicit list of what the corpus does NOT cover (candidate Phase 3 questions).

**Exit check:** for each of phase / length / apodizing, a one-line verdict: "corpus covers: …, corpus silent on: …". (Focus/quality/genre/ratio are HQPlayer-editorial facets; the corpus is unlikely to touch them — say so if confirmed.)

### Phase 3 — Web research: gaps only

**Consumes:** the open-questions list produced by Phases 1–2. Do not research anything already answered on disk.

Expected gaps (verify they are actually still open before spending effort):

1. Apodizing mechanism in plain terms — corrects/attenuates ringing already baked into the *source* by an earlier ADC/decimation filter, rather than merely adding its own character. Find a citable statement (Craven's apodizing papers are the likely primary).
2. "Intermediate phase" — established literature term or HQPlayer-specific coinage? Determines whether the card can define it beyond "between linear and minimum".
3. Filter length (taps) — what it structurally buys: transition-band steepness, stopband attenuation, ringing duration trade. A DSP-text-grade statement, not forum lore.
4. Anything Phase 1 left with "manual is silent on X" for a term the card cannot skip.

**Rules:** every claim tagged per the legend; unreachable primary → `[X]`, question dropped from card content. Descriptive stance holds — collect *what it does*, not *whether it's audible*. Timebox: this phase ends when the four questions above are resolved or tagged `[X]`; it is not an open-ended literature review.

**Exit check:** each gap question closed with a tagged citation or an explicit `[X]`.

### Phase 4 — Register and form survey

**Consumes:** `docs/design-system.md` (binding for any eventual card), existing user-facing copy for voice — section notes and captions in `hqptuner/static/components/tabs/*.js`, `AlertStrip.js`, tooltips/titles if any.

**Produces:** a short register note (sentence length, person, tone observed in existing copy) and 2–3 candidate forms for the card (e.g. single card of short per-term entries; per-facet disclosure anchored to each narrow chip; hybrid) with one-line trade-offs. **Recommend one; do not decide** — form is settled at implementation planning with the user.

**Exit check:** register note grounded in ≥3 quoted examples of existing copy; each candidate form names where it lives in the tab.

### Phase 5 — Assemble `docs/filter-guide.md`

**Produces the single deliverable**, containing:

1. Term inventory table (from this plan, updated if the tree moved).
2. Per-facet section: plain-English gloss draft (2–4 sentences, descriptive stance) + the claims backing it, each tagged and cited. Gloss must be derivable from its claims alone — no orphan assertions.
3. Supporting glosses: `-2s`, `fft_size`.
4. **Open naming question, flagged for the user:** facet "Length" vs "Filter length" card collision — options, no decision.
5. Claim policy section (copied from this plan) so the doc is self-verifying.
6. Sources appendix with verification tags; `[X]` entries listed, not silently dropped.

Size target: the working document, not a corpus — closer to `docs/junk-filter-recommender-plan.md` than to `docs/eq-assistant/`. Repo markdown rules apply: soft-wrapped, one logical line per paragraph/list item (`.claude/hooks/md-softwrap.py` enforces).

**Exit check:** every gloss sentence traces to a tagged claim; all seven facets + two supporting glosses present; naming question flagged; no audibility verdicts anywhere; no untagged claims.

### Phase 6 — Hand-back

Report to the user: deliverable path, per-facet one-line summary of what the research found, the naming question, and any `[X]` gaps that leave a facet thin. **Stop.** No implementation, no card copy in the UI, no follow-on plan without the user opening that conversation.

## Constraints carried from project rules

- Host + project `CLAUDE.md` bind in full: change budget (writes to `docs/filter-guide.md` are working-tree edits — allowed; no other writes needed), bounded investigation, grounding gate.
- HQPlayer manual is authoritative for HQPlayer behavior — believe it, never probe the live daemon to confirm it. **This task needs zero daemon contact.**
- Web research is free (fetch/search); delegation to read-only agents is free. Prefer delegating bulk reading (the 495-line manual section, PDFs) and verifying pointers yourself.
- If the working draft dies mid-phase, resume from the last completed phase's exit check — that is what the checks are for.
