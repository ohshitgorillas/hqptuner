# PRIMER — HQPTuner EQ Assistant

A standalone brief for an agent picking up this feature cold. Companions: `SOURCES.md` (citations, verification tags, source disagreements) and `vocabulary.json` (the term map).

> **Revised 2026-07-22.** Three corrections and one structural change; all are called out in place below. (1) The crossfeed centre-tilt direction was inverted — it *decreases* as crossfeed level rises. (2) AutoEq bands were described as untouchable; they are in scope. (3) The guardrail table was presented as enforced limits; almost all of it is guidance, and **Q is deliberately unclamped**. (4) **Structural: a turn is a bounded tool loop, not a single completion**, and the prose rule was loosened to permit prose anchored to the numbers it describes. If you find text anywhere that contradicts this file on any of these, this file is right and that text is stale.

> **Revised 2026-07-26.** One structural change: **a third response branch, `discuss`**, so the user can ask questions and get an anchored answer that stages nothing (D16). The union is now three branches, only one of which may carry `changes`, and every prose answer declares a `basis`. Further amendments landing in the same pass are recorded in the plan's decision table (D17–D21); where this file has not caught up with them yet, the plan is authoritative for those and this file is authoritative for everything above.

## What it is

A card at the bottom of HQPTuner's DSP tab: one text input plus a session history. The user types a plain-language listening complaint — "too boomy", "vocals sound distant", "half the time they're perfect, half the time slightly too quiet" — and the feature returns a **structured, measured diff** that is **staged** into the app's existing pending-changes buffer. The user batches several turns, reviews, and presses **Apply** once.

**It is a bounded tool-using agent, not a single completion.** A turn runs: diagnose → compute the chain's actual response → generate candidate fixes → measure each → select. It has one tool:

```
evaluate_chain(base_bands[], candidate_changes[], at_frequencies[])
    -> { hz: net_db }, band averages, spread
```

Pure computation — no daemon contact, no staging, callable many times per turn. **The loop is not optional and cannot be replaced by a bigger prompt**: measuring a candidate means evaluating a chain that does not exist yet, so nothing preloaded into context substitutes for it. Evaluate at *musical* frequencies — the note fundamentals of whatever the complaint names — not a uniform log grid. "E2 is fine, A2 is not" explains a symptom; "there is a trough at 168 Hz" does not.

## What it is not

* **Not a chat client — but it does answer questions.** The loop is invisible; only the final structured answer reaches the user. Prose is permitted **only as a field of a structured object carrying the numbers it describes** — see the schema contract below. Free-form turns are banned. The `discuss` branch lets the user ask things ("why narrow the Q instead of cutting it?") and get an answer that changed nothing; it is still a structured object, still anchored, and it **cannot carry `changes`**. What the prose ban protected was anchoring, not silence.
* **It never applies anything.** Staging only. Apply is a human action, always.
* **It cannot enable or disable any feature.** It adjusts things that are already on. If crossfeed is off, a spatial complaint gets a `clarify`, not a diff that switches it on.
* **It does not delete bands casually.** Setting a gain to 0 dB is the reversible equivalent and is the preferred move — but this is guidance, not a prohibition (D2), and it is explicitly suspended inside a **`replace_segment`** (D17), the simplification case where N bands are replaced by M across a declared span. Zeroing twelve stages there would leave twelve dead stages and defeat the entire operation.

## The metric panel

A session accumulates **model-coined metrics**, and they are session state. When a complaint names a quality that band arithmetic can capture, define it, name it, and carry it forward. The real session coined `v_db = mean(bass 50–150, treble 4k–10k) − mid 400–1500` from "I hate V-shaped", and two turns later that metric decided an unrelated bass fix was acceptable.

Each metric stores a `definition` (band arithmetic as data), an `origin_turn`, and a `series` — its value after every turn since. **Every answer reports the whole panel**, not only the metric it was aiming at. That is the only way a side effect becomes detectable, and it makes "back off that last change" cheap because the numbers are already recorded.

## Session recovery

Models go off the rails and context gets poisoned. **The sound and the reasoning fail independently**, so there are four operations rather than one "clear session":

|  | keep the chain | revert the chain |
|---|---|---|
| **keep the ledger** | — | **Rewind** — undo the sound, keep the reasoning |
| **prune the ledger** | **Amnesia** — keep the sound, forget how we got here | **Reset** |

**Amnesia is the important one.** When an early mis-diagnosis contaminates every later turn, the chain is often fine — the user corrected it by ear as they went — while the context is poison. Discarding a curve somebody listened their way to, in order to fix a conversation, is the wrong trade.

Every turn stores a **pre-turn chain checkpoint**: bands, crossfeed, compensation strength. That is what makes rewind-to-any-turn instant, and it is also what lets a badly-coined metric be redefined with its whole series recomputed over history, so the panel stays comparable.

Three rules:

* **Revert stages, it never applies.** A rewind lands a checkpoint in the staging buffer and waits for Apply, like every other change. Anything else is a write lane past the Apply gate.
* **Pruning marks, it never deletes.** Excluded turns leave the context window, stay in the export flagged, and stay visible struck through in the UI.
* **Metric definitions outlive the context window.** The ledger is sent bounded, so a poisoned turn older than the window is already out of context while its coined metrics still steer every answer. Pruning must reach metric definitions separately from turns, or amnesia will appear to work and will not.

The tool loop is also **capped per turn**. A turn that cannot converge inside the cap aborts on a stock message and stages nothing — and is itself a signal, usually that the complaint was ambiguous and should have been a `clarify`.

## The four change types

| # | Change | Parameter | Unit | Bounds |
|---|---|---|---|---|
| 1 | Voicing EQ stage | `type` (`peak`/`lshelf`/`hshelf`), `f`, `g`, `q` | Hz, dB, dimensionless | see guardrails |
| 2 | Crossfeed crossover | frequency | Hz | 300–2000 |
| 2 | Crossfeed level | feed | dB | 1.0–15.0 |
| 3 | Crossfeed compensation | strength | % | 0–150 |
| 4 | `replace_segment` (D17) | N bands out, M in, over a declared span | — | must report fit residual |

HQPlayer matrix pipelines carry a `process` string — a comma-separated stage chain. An IIR stage looks like `iir:type=peak;f=1000;q=1;g=-3.5`. Types carrying gain are `peak`, `lshelf`, `hshelf`; those are the only three the tuner emits. (`lp`, `hp`, `lp1`, `hp1`, `bp`, `ap`, `notch`, `biquad` also exist in the engine and are out of scope.) Response math is the standard RBJ "Audio EQ Cookbook" biquad set.

Crossfeed is HQPlayer's `bauer` post-process — the Bauer stereophonic-to-binaural (bs2b) algorithm. Presets: `default` 700 Hz / 4.5 dB, `cmoy` 700 Hz / 6.0 dB, `jmeier` 650 Hz / 9.5 dB. Touching either parameter switches the preset selector to `custom`.

## Advising on things it cannot change (D19, D20)

The tuner may **recommend anything and change only the four above**, through a `recommends` field on `outcome` or on `discuss`. The reason is not helpfulness — it is that **the alternative is symptom masking.** A model that can see the oversampling filter implicated in a spatial complaint, but whose only levers are EQ and crossfeed, will EQ *around* a cause sitting in plain sight. Advice costs nothing structurally, the user is the one who acts, and the enable/disable boundary is reinforced rather than eroded.

Two hard constraints:

* **Only names the live engine enumeration reports.** The validator rejects any `suggested` value that is not in it. HQPlayer is niche and model recall of it is thin, so an invented filter name is the likeliest failure — and it is worse than bad advice, because it is **unfollowable**.
* **Dimensional, never reputational.** Per-filter reputation is forum folklore, gear-dependent and unsourceable. What *is* defensible is the axis: linear phase puts ringing symmetrically around a transient so energy arrives before the attack; minimum phase moves it all after, at the cost of frequency-dependent group delay; filter length trades frequency-domain accuracy against time-domain compactness. That is mechanism, and it earns `basis: "mechanism"`.

The axis layer lives in `hqptuner/data/filters.json`'s `guidance` block (P1). It is **`vocabulary.json`'s own structure applied to a second parameter space** — descriptor → axis → direction — not a new kind of asset. Filter position is read from what the engine already reports: phase is encoded in the name, apodizing in arg bit 0, length in the description text.

Three things it must carry, all load-bearing:

* **`contested` per axis.** The mechanisms are real; the audibility is small and disputed near Nyquist. Say so rather than overselling.
* **One axis at a time.** Hold family and phase, move length — or the reverse. Change several at once and the A/B is unattributable, which teaches the user nothing.
* **Negative rules.** Midrange tonality, nasality and boom are **EQ's**, not the filter's. Filter axes plausibly touch transient character, top-octave texture, spatial diffuseness and "digital" hardness. Without this list, a filter suggestion becomes the escape hatch for every complaint the model cannot otherwise fix — a confident non-answer.

`filters.json` also carries the manual's **own genre column, explicitly non-editorial**, so "listed for rock/pop" is a citation and not an opinion.

## Stage classes and scope

> **Corrected 2026-07-22.** An earlier draft declared AutoEq bands untouchable and gave the tuner an exclusively-owned appended segment. That is withdrawn. It was based on a misreading of the requirement, and in practice it produces exactly the failure it was meant to prevent.

The chain contains two classes of stage:

1. **EQ bands** — whether hand-entered or imported from a headphone's `ParametricEQ.txt` via the AutoEq library. **All of them are in scope.** The tuner amends them.
2. **Crossfeed-compensation stages** — machine-generated, recomputed wholesale from `(crossover, feed, strength)`. Never hand-edited, never amended band-by-band.

**The wire format is a flat comma-separated string and carries no provenance metadata.** There is no field that says which band came from where, and none is needed: the tuner is not trying to avoid anything.

**The governing rule is amend-before-append.** An AutoEq preset already tiles the spectrum with eight to ten measurement-placed bands, so a complaint almost always has a band sitting in its region already. Moving that band's gain is a one-number change that leaves the curve readable. Appending a fresh band beside an existing one means the net response is now the *sum* of two overlapping filters, and after a few turns the curve is unreasonable — which is the actual observed failure mode, and the reason the protected-segment design was dropped.

**But it is guidance, not a rule, and the mechanical form of it is wrong** (F3, D2). An earlier draft of this file said: *if any existing band's centre falls within half an octave of the target, amend it; append only where nothing covers the region.* That is withdrawn. Every vocabulary region already contains one of the preset's bands, so the rule collapses into *never append* — and worse, it forces amending whatever band is nearest regardless of whether that band suits the job.

**AutoEq bands are not interchangeable.** A Q 0.7 shelf is broad shaping; a Q 4 notch at 5.7 kHz is killing a measured resonance. Amending that notch to satisfy "a bit less bright" does not voice anything — it silently undoes a measurement correction.

The real test is **filter suitability, which is a judgment**: amend when a band sits near the target *and* its shape fits the move being asked for; append when the nearest band is surgical, or when nothing suitable is near. Vocabulary entries carry `typical_q` as the shape to compare against. This lives in the prompt and is corrected by the user in plain language, never in the validator — encoding it as a rejection would mean encoding taste.

Mangling the AutoEq correction is a cheap, one-click-recoverable outcome — the user re-imports the profile from the library picker — and nothing reaches the daemon without an explicit Apply. It was never worth an architecture to prevent.

## How compensation consistency is maintained

**Verified finding — state it exactly as follows.** The compensation block is not a flag but **eight literal mid/side pipeline rows**. The app **re-detects it purely structurally every render** and compares the stored shelf frequency/Q against a **fresh fit for the current crossfeed parameters**. A mismatch marks it **stale** and surfaces a **"Rebuild" prompt** — **the app never silently recomputes.**

Consequence for this feature: **any AI-proposed crossfeed parameter change must, in the same turn, emit a recompiled compensation block at the preserved strength percentage.** This holds whether or not the block was already stale beforehand. Preserve the *strength*; recompute the *fit*. The rebuild is itself a pipeline change, so it appears in the turn's structured diff like any other change — it needs no narration, and narrating it would violate the schema union below.

### The tilt, and its direction

> **Corrected 2026-07-22.** The first draft asserted "every 1 dB of crossfeed level costs 1 dB of centre tilt", with tilt rising as feed rises. **Both the direction and the magnitude were wrong.** The underlying algebra it rested on (`GB_lo − GB_hi = −feed`) is a true identity, but that quantity is the shelf separation in the analog prototype, not the realised tilt after normalisation.

In bs2b the mid (centre) path is normalised to 0 dB at DC and rolls off to `−tilt` at high frequency, where

```
tilt = 20·log10(1 − gHi + gLo)
gLo  = 10^((−5·feed/6 − 3)/20)
gHi  = 1 − 10^((feed/6 − 3)/20)
```

Two consequences, both counterintuitive and both load-bearing:

* **Tilt depends only on `feed`.** The crossover frequency does not enter the expression at all — it moves the corner at which blending stops, not the asymptotic tilt. (Crossover changes still make the compensation block stale, because the fit is *seeded* from the crossover. Recompile anyway.)
* **Tilt DECREASES as feed rises**, and compressively:

| feed | 1.0 | 4.5 (default) | 6.0 (cmoy) | 9.5 (jmeier) | 15.0 |
|---|---|---|---|---|---|
| centre tilt | 2.70 dB | 1.81 dB | 1.53 dB | 1.09 dB | 0.92 dB |

The entire 14 dB feed range moves tilt by 1.78 dB, so a ±1.5 dB nudge near the default changes tilt by roughly 0.3 dB — broad, and at or below audibility on its own. It matters for keeping compensation consistent, not as an audible consequence. **Do not narrate it to the user as a tonal change.**

Verified numerically against the shipped implementation in `lib/xfeed.js`, and corroborated by the app's own UI copy, which states a 1–2.7 dB range.

**A separate effect, frequently conflated:** crossfeed also sums correlated low-frequency content between channels, which can raise perceived bass weight. That is *not* the mid-path treble tilt and is *not* what compensation corrects. Keep them apart.

Compensation restores the centre with a fitted high-shelf pair, leaving the width effect intact. 0 % = off, 100 % = neutral centre, >100 % = brighter than neutral.

## The response schema contract

The **final answer** must validate against a union of exactly three branches. Intermediate tool calls are not part of the union — they never reach the user, so they were never what it guarded against. **Only branch 1 may carry `changes`**; that is the invariant the whole feature rests on.

```jsonc
// branch 1 — the model acted
{
  "diagnosis":   { "method", "finding", "explains_symptom", "measured": {...} },
  "changes":     [ ... ],
  "alternatives_rejected": [ /* candidates with measured figures + reason */ ],
  "metrics":     { "<name>": { "before": <n>, "after": <n> } },
  "side_effect": { "metric", "delta", "judgment", "remedy" }   // optional
}

// branch 2 — the model needs an answer before acting
{ "clarify": "<one sentence>", "context": { /* optional measured values */ } }

// branch 3 — the user asked; the model answered and changed nothing
{ "discuss": { "answer": "<prose, length-bounded>",
               "measured": { /* what the tool returned */ },
               "basis": "measured" | "vocabulary" | "unverified" } }
```

* **Exactly one branch.** Never two at once, no fourth branch, no extra top-level keys.
* **`discuss` stages nothing, structurally.** `changes` is *absent*, not an empty array, so the union stays a real XOR over the write path. Answer-then-act is two turns.
* **`basis` is mandatory on `discuss`, and it is rendered.** Nothing can tell whether a question was tool-answerable, so the model declares its footing instead: `basis: "measured"` requires a non-empty `measured`. **A measured answer and a recalled one must not look alike in the card** — that is the whole safety property, and it is what lets the user see which claims they can check.
* **A `discuss` turn never appends to a metric series.** The chain did not move, and a series entry with no checkpoint behind it shows fake drift and breaks metric-series recomputation, which assumes entries map 1:1 to checkpoints.
* **`discuss` turns are prunable as a class** — "forget the discussion, keep the tuning".
* **`diagnosis`, `changes` and `metrics` are all required** on branch 1. A change with no diagnosis, or one that reports only the metric it aimed at, is rejected.
* **`side_effect` needs its `remedy`.** Flagging a regression without naming the fix is rejected. The real session disclosed a `v_db` rise of +0.38 *before* applying and pre-named the remedy (+0.4 on the 750 Hz band rather than reverting) — that is the bar.
* **The anchoring rule is structural.** Prose may appear only as a field of an object that also carries numbers; `explains_symptom` sits beside `measured` and cannot wander from it. Nothing inspects what the prose *says* — the check is on shape, never on content.
* **Rejection rule:** any answer that fails validation is discarded outright. Not repaired, not partially applied, and its prose is never shown. Surface a generic failure and let the user retype.
* **`clarify` has three modes**, and the third is the most common in practice:
  1. **Scope deflection** — out of surface (feature toggles, filters, "make it louder").
  2. **Low-confidence inference** — the target comes from a named product rather than a descriptor and recall is uncertain.
  3. **Magnitude proposal** — direction is clear, amount is not, so surface the responsible band's current value and ask what to aim for.

  `clarify` is the correct answer far more often than a guessed diff.

## Two rules the model must be told, because it will not infer them

**Prefer additive fills to clawing back by-ear decisions.** Levels the user approved by listening in earlier turns are settled. Reaching a target by filling a hole beats revising an accepted value — the real session adopted this rule unprompted and it is right.

**Compound complaints are handled jointly, and the interaction check is the work.** One utterance can carry two complaints. Separating them is step one; checking that the two fixes do not fight — against the standing metric panel, including metrics coined in earlier turns — is what the turn is actually for.

## Uploads (D21)

The user can hand the model files — a measured frequency response, a `ParametricEQ.txt` from anywhere, a spec sheet, a review, their own notes. **All of it is accepted; `basis` carries the weight.** There is no accept/reject split by file kind. If someone uploads a file they have already decided it has value, and they know its provenance better than the model does.

The ladder, strongest to weakest: `measured` (computed this session) → `mechanism` (documented property + physical consequence) → `cited` (user-supplied file, naming file and location) → `vocabulary` → `unverified` (model recall, nothing behind it).

**`cited` outranks `unverified`.** A user-supplied writeup is attributable, re-readable and deliberately chosen; pretraining recall on niche gear is none of those. Uploading a review *improves* the epistemics over guessing from memory.

What holds regardless — mechanism, not judgement about the user:

* **Attribution is mandatory** — a claim from a file names the file, so it can be checked.
* **Retrieval, not dumping** — curves are sampled, prose is chunked and queried. A forty-page PDF in the ledger tail would evict the actual tuning turns.
* **Pruning must reach uploads**, separately from turns and exactly as it must reach metric definitions. An upload is the highest-volume path into context; amnesia that cannot drop one only appears to work.

**The step change:** a measurement plus `fit_chain` (D17) is AutoEq in-app from the user's own data. And an uploaded measurement can *contradict the loaded profile* — "your profile targets Harman, your measurement shows the seal is not reaching the bass shelf" — a fault that lives outside the chain, so no amount of chain arithmetic would ever have found it.

## The vocabulary map

`vocabulary.json` has `_meta`, `tonal` (25 entries) and `spatial` (13 entries). Each tonal entry carries `term`, `aliases`, `region_hz`, `suggested_fc_hz`, `suggested_type`, `direction`, `typical_gain_db`, `typical_q`, `named_quality`, `sources`, `confidence`, and a `notes` line naming any source disagreement. Spatial entries map instead to a crossfeed `parameter` with a `direction`, a typical delta, an optional `secondary` parameter, and a mandatory `tonal_side_effect` line.

**Direction convention (stated in `_meta`, repeat it in the system prompt): `direction` is what to do TO THE NAMED REGION TO SATISFY THE USER — not what the word means.** "Too boomy" → `cut` 60–150 Hz. "Warmer" → `boost` 100–300 Hz. The `named_quality` field says whether the entry is written for an unwanted quality or a wanted one; when the user's sentence inverts that polarity ("not bright enough"), invert `direction` and keep the region, Q and magnitude. `_meta.conflict_pairs` lists term sets that must not be emitted together because they cancel.

`_meta.eq_emission_rules` carries the amend-before-append rule and the per-turn limits; `_meta.tonal_spatial_interaction` carries the corrected tilt physics. `_meta.corrections` lists what changed on 2026-07-22 and why.

## Guardrails

> **Read this before the table.** Guardrails split three ways, and only two of them are enforced:
>
> * **Validity** — what the engine and form accept: `type` ∈ {peak, lshelf, hshelf}, crossfeed bounds from the live `/matrix` form, compensation strength 0–150 %, the response union. A violation is a malformed request.
> * **Correctness** — headroom recompute and the compensation rebuild. Both are **derived by the client**, never emitted by the model; a model must not guess shelf coefficients or a preamp figure.
> * **Policy** — exactly one item: **±6 dB per turn**. There is no absolute gain ceiling. We adjust an existing measurement-grounded profile rather than generating one, so the profile sets the envelope.
>
> **Everything else in this table is guidance, not a limit.** Q ranges, shelf-Q conventions and band budgets are starting points the model applies by judgment and the user corrects in plain language. **Q in particular is deliberately unclamped**: in a real session the root fault was a band at Q 0.26 wide enough to eat 200–800 Hz, and the fix was widening the Q to 0.70 — nearly a factor of three, which any bound tight enough to feel safe would have blocked. Taste is measured in the eval, never enforced in the validator.

| Guard | Value | Provenance |
|---|---|---|
| EQ gain, hard clamp | **±12.0 dB** | AutoEq `DEFAULT_FIXED_BAND_FILTER_MIN/MAX_GAIN = -12.0/+12.0`; both graphic-EQ configs use the same |
| EQ gain, per-turn soft | ±6.0 dB | AutoEq `DEFAULT_MAX_GAIN = 6.0`, `DEFAULT_TREBLE_MAX_GAIN = 6.0`; also a project decision (D1) |
| Q, hard clamp | **0.18 – 6.0** | AutoEq `DEFAULT_PEAKING_FILTER_MIN_Q = 0.18248`, `MAX_Q = 6.0` |
| Q, voicing preferred | 0.5 – 1.6 | Toole: broad low-Q colourations are what listeners actually notice over repeated listening; narrow deep bands are less audible and more likely mis-aimed |
| Q, narrowband ceiling | 4.0 | reserved for `sibilant`, `shrill`, `piercing` only |
| Shelf Q | **fixed 0.7** | AutoEq `DEFAULT_SHELF_FILTER_MAX_Q = 0.7`; every shipped oratory1990 shelf is `Q 0.70` |
| Centre frequency | 20 – 20000 Hz | AutoEq shelf/peaking `MIN_FC = 20.0`; note AutoEq's optimiser caps at 10 kHz |
| Band scope | **all bands amendable, AutoEq included** | user decision 2026-07-22; supersedes the withdrawn protected-segment design |
| Per-turn band budget | amend ≤ 2, append ≤ 1 | keeps a turn's diff reviewable |
| Crossfeed frequency | **300 – 2000 Hz** | libbs2b `BS2B_MINFCUT` / `BS2B_MAXFCUT`. Read the live `/matrix` form at runtime rather than hardcoding — this is HQPlayer's form, not bs2b's library |
| Crossfeed level | **1.0 – 15.0 dB** | libbs2b `BS2B_MINFEED` / `BS2B_MAXFEED` = 10 / 150, encoded as dB × 10. Same runtime caveat |
| Compensation strength | 0 – 150 % | app-defined |
| **Headroom recompute** | on any net positive gain | AutoEq emits `Preamp: {-compound.max_gain:.1f} dB` — the negative of the maximum of the **summed** magnitude response of the whole chain. **Not** the negative sum of positive gains, and **not** the negative of the largest single band. Verified against the shipped HD 650 preset: largest band `+6.4` dB, preamp `-6.1` dB, because a `-3.1` dB band partially cancels it. |

Every positive-gain proposal must recompute the row `gain` (dB) by that rule across the **entire** chain — all EQ bands and compensation stages together — because they share one headroom budget.
