# PRIMER — HQPTuner EQ Assistant

A standalone brief for an agent picking up this feature cold. Companions: `SOURCES.md` (citations, verification tags, source disagreements), `vocabulary.json` (the term map), and `CORRECTIVE.md` (the corrective mode — governing whenever the session carries a measurement and a yardstick); `SOURCES.md` §8 lists the rest.

**One prior worth carrying into every turn.** A user may be EQ-ing to compensate for their own hearing rather than to change the headphone, and they will rarely say so. `HEARING.md` carries what that does and does not license — in short: never infer a curve from an age, a grade or a self-report; a threshold shift is not a gain figure and half is the population approximation; boost near the edge of a loss region rather than deep inside it; the chain has no compression, no per-ear control and no calibrated level, so level-dependent complaints and asymmetry are `clarify` + `recommends` cases; and a sudden, unilateral or newly-changed symptom earns one factual sentence pointing at assessment — never a refusal, and never an idle gate.

**The XOR guards the write path, not speech.** `diagnosis` carries two registers of one finding (`explains_symptom` technical, `in_plain_terms` plain), an acting turn may answer a question that arrived beside the complaint through an `answers` field, and numeric literals in prose are provenance-checked by the validator. The only policy clamp is ±6 dB per turn; there is no absolute gain ceiling and no band cap.

## What it is

A card at the bottom of HQPTuner's DSP tab: one text input plus a session history. The user types a plain-language listening complaint — "too boomy", "vocals sound distant", "half the time they're perfect, half the time slightly too quiet" — and the feature returns a **structured, measured diff** that is **staged** into the app's existing pending-changes buffer. The user batches several turns, reviews, and presses **Apply** once.

**It is a bounded tool-using agent, not a single completion.** A turn runs: diagnose → compute the chain's actual response → generate candidate fixes → measure each → select. It has two tools:

```
evaluate_chain(base_bands[], candidate_changes[], at_frequencies[])
    -> { hz: net_db }, band averages, spread

fit_chain(...)   // D17 — solves the inverse problem: given a target curve,
                 // find the bands that reach it. Backs `replace_segment`
                 // and the uploaded-measurement path. See the plan for its signature.
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

The recovery operations, their three rules and the per-turn checkpoint live in `FEATURE-CONTRACT.md`.

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

`recommends` carries settings the tuner cannot change itself; its constraints and the filter-axis rules live in `FEATURE-CONTRACT.md`.

## Stage classes and scope

The chain contains two classes of stage:

1. **EQ bands** — whether hand-entered or imported from a headphone's `ParametricEQ.txt` via the AutoEq library. **All of them are in scope.** The tuner amends them.
2. **Crossfeed-compensation stages** — machine-generated, recomputed wholesale from `(crossover, feed, strength)`. Never hand-edited, never amended band-by-band.

**The wire format is a flat comma-separated string and carries no provenance metadata.** There is no field that says which band came from where, and none is needed: the tuner is not trying to avoid anything.

**The governing rule — in voicing mode — is amend-before-append.** (It is voicing guidance only: in corrective mode, band placement, Q and gain all come from the measurement's error curve, and `CORRECTIVE.md` governs.) An AutoEq preset already tiles the spectrum with eight to ten measurement-placed bands, so a complaint almost always has a band sitting in its region already. Moving that band's gain is a one-number change that leaves the curve readable. Appending a fresh band beside an existing one means the net response is now the *sum* of two overlapping filters, and after a few turns the curve is unreasonable — which is the actual observed failure mode.

**But it is guidance, not a rule, and the mechanical form of it is wrong** (F3, D2) — *if any existing band's center falls within half an octave of the target, amend it; append only where nothing covers the region.* Every vocabulary region already contains one of the preset's bands, so that rule collapses into *never append* — and worse, it forces amending whatever band is nearest regardless of whether that band suits the job.

**AutoEq bands are not interchangeable.** A Q 0.7 shelf is broad shaping; a Q 4 notch at 5.7 kHz is killing a measured resonance. Amending that notch to satisfy "a bit less bright" does not voice anything — it silently undoes a measurement correction.

The real test is **filter suitability, which is a judgment**: amend when a band sits near the target *and* its shape fits the move being asked for; append when the nearest band is surgical, or when nothing suitable is near. Vocabulary entries carry `typical_q` as the shape to compare against. This lives in the prompt and is corrected by the user in plain language, never in the validator — encoding it as a rejection would mean encoding taste.

Mangling the AutoEq correction is a cheap, one-click-recoverable outcome — the user re-imports the profile from the library picker — and nothing reaches the daemon without an explicit Apply. It was never worth an architecture to prevent.

## How compensation consistency is maintained

**Verified finding — state it exactly as follows.** The compensation block is not a flag but **eight literal mid/side pipeline rows**. The app **re-detects it purely structurally every render** and compares the stored shelf frequency/Q against a **fresh fit for the current crossfeed parameters**. A mismatch marks it **stale** and surfaces a **"Rebuild" prompt** — **the app never silently recomputes.**

Consequence for this feature: **any AI-proposed crossfeed parameter change must, in the same turn, emit a recompiled compensation block at the preserved strength percentage.** This holds whether or not the block was already stale beforehand. Preserve the *strength*; recompute the *fit*. The rebuild is itself a pipeline change, so it appears in the turn's structured diff like any other change. **It earns exactly one sentence in `in_plain_terms`** (D3 as amended by D22) — *the crossfeed moved, so the compensation was rebuilt to match*. The original rule said it needed no narration because the diff shows it, which is sound for a reader who reads diffs; to anyone else a twelve-stage block appearing under a complaint about bass is alarming, and an unexplained change is the one most likely to be discarded wholesale. One sentence in a field, never a branch, so the union is untouched.

### The tilt, and its direction

Center tilt is not 1 dB per 1 dB of crossfeed level, and it does not rise as feed rises. The algebra `GB_lo − GB_hi = −feed` is a true identity, but that quantity is the shelf separation in the analog prototype, not the realized tilt after normalization.

In bs2b the mid (center) path is normalized to 0 dB at DC and rolls off to `−tilt` at high frequency, where

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
| center tilt | 2.70 dB | 1.81 dB | 1.53 dB | 1.09 dB | 0.92 dB |

The entire 14 dB feed range moves tilt by 1.78 dB, so a ±1.5 dB nudge near the default changes tilt by roughly 0.3 dB — broad, and at or below audibility on its own. It matters for keeping compensation consistent, not as an audible consequence. **Do not narrate it to the user as a tonal change.**

This matches the shipped implementation in `lib/xfeed.js`; the app's own UI copy states a 1–2.7 dB range.

**A separate effect, frequently conflated:** crossfeed also sums correlated low-frequency content between channels, which can raise perceived bass weight. That is *not* the mid-path treble tilt and is *not* what compensation corrects. Keep them apart.

Compensation restores the center with a fitted high-shelf pair, leaving the width effect intact. 0 % = off, 100 % = neutral center, >100 % = brighter than neutral.

## The response schema contract

The three-branch union, its validator rules and the numeric provenance check live in `FEATURE-CONTRACT.md`.

## The three `clarify` modes

* **`clarify` has three modes**, and the third is the most common in practice:
  1. **Scope deflection** — out of surface (feature toggles, filters, "make it louder").
  2. **Low-confidence inference** — the target comes from a named product rather than a descriptor and recall is uncertain.
  3. **Magnitude proposal** — direction is clear, amount is not, so surface the responsible band's current value and ask what to aim for.

  `clarify` is the correct answer far more often than a guessed diff.

## Four rules the model must be told, because it will not infer them

**Prefer additive fills to clawing back by-ear decisions.** Levels the user approved by listening in earlier turns are settled. Reaching a target by filling a hole beats revising an accepted value — the real session adopted this rule unprompted and it is right.

**Compound complaints are handled jointly, and the interaction check is the work.** One utterance can carry two complaints. Separating them is step one; checking that the two fixes do not fight — against the standing metric panel, including metrics coined in earlier turns — is what the turn is actually for.

**Phase is not a lever, and channel asymmetry is the only place it gets loud.** Every stage the tuner emits is a minimum-phase biquad, so its phase response is *entailed* by its magnitude — there is no phase/magnitude trade to offer and no "same curve with less phase shift" to propose (`PHASE.md` §1). The chain's measured group delay varies by 156 µs across 300 Hz–1 kHz, several times under the lowest published audibility threshold and about the same as the unit-to-unit spread between two copies of the same headphone, so **do not narrate phase or group delay to the user as a consequence of an EQ move** — the same discipline the crossfeed center tilt gets. An EQ band also cannot pre-ring; pre-echo belongs to the oversampling filter alone, and a phase explanation must never become the escape hatch for a complaint EQ cannot fix. The exception is **asymmetry**: the same band applied to one ear only puts a frequency-dependent interaural phase difference into the signal that runs one to two orders of magnitude above the ITD detection floor below ~1200 Hz, which is a lateralization change with a tonal side effect rather than a tonal change (`PHASE.md` §7). All four change types are stereo-symmetric today (`HEARING.md` §4.3), so this is a `clarify` + `recommends` case now and a hard constraint on any future per-ear control.

**Do not offer a canal-resonance correction, however well the mechanism reads.** `TRANSDUCERS.md` §3.2 documents a real acoustic variable — the main ear-canal resonance near 2.7–3 kHz, which an IEM sits at the anti-node of and which varies between individuals by up to two octaves and more than 10 dB. Reading that, the obvious move is a narrow 3 kHz band the user tunes to their own ear, and it is wrong. Olive 2025 built exactly that control — 3 kHz, Q 2, +6 to −10 dB — gave it to 36 listeners on a diffuse-field baseline they were otherwise freely re-balancing, and got a mean adjustment of **+0.1 dB**, with only 5 of 36 reaching ± 2 dB (`SOURCES.md` §2.2d). Two further results put the tolerated spread through this region at several dB. **The inter-individual variance is why in-ear and over-ear targets differ as families; it is not a knob.** Bass and treble shelves are where individual taste actually lives, and the same study bounds them: about 6.7 dB of between-listener bass spread and 6.3 dB of treble, most tastes reachable inside ± 3 dB of each. If a user's complaint genuinely lands at 3 kHz, treat it as the ordinary `harsh` / `forward` case the vocabulary map already handles — not as ear-canal compensation, and never narrated to the user as tuning to their anatomy.

## Uploads (D21)

How an uploaded file is accepted, attributed and pruned lives in `FEATURE-CONTRACT.md`.

**An uploaded measurement plus a declared yardstick switches the session into corrective mode**, and `CORRECTIVE.md` is the governing document for it — target selection and rig compatibility, the error curve, smoothing, the reliability ceiling, what is not correctable, and fitting doctrine. The voicing calibrations in this file and `vocabulary.json` (typical gains, low-Q preference, amend-before-append) do not size corrective moves; the error curve does.

**The step change:** a measurement plus `fit_chain` (D17) is AutoEq in-app from the user's own data. And an uploaded measurement can *contradict the loaded profile* — "your profile targets Harman, your measurement shows the seal is not reaching the bass shelf" — a fault that lives outside the chain, so no amount of chain arithmetic would ever have found it.

## The vocabulary map

Look a term up with eqlab's `vocab` job rather than reading the file: it answers the matched entries, the conflict rows naming them, and the `_meta` rules for reading an entry. The entry schema is `_meta.entry_schema`.

**Direction convention (stated in `_meta`, repeat it in the system prompt): `direction` is what to do TO THE NAMED REGION TO SATISFY THE USER — not what the word means.** "Too boomy" → `cut` 60–150 Hz. "Warmer" → `boost` 100–300 Hz. The `named_quality` field says whether the entry is written for an unwanted quality or a wanted one; when the user's sentence inverts that polarity ("not bright enough"), invert `direction` and keep the region, Q and magnitude. `_meta.conflict_pairs` lists term sets that must not be emitted together because they cancel.

`_meta.eq_emission_rules` carries the amend-before-append rule and the per-turn limits; `_meta.tonal_spatial_interaction` carries the corrected tilt physics.

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
| **EQ gain, per turn — the one policy clamp** | **±6.0 dB** | AutoEq `DEFAULT_MAX_GAIN = 6.0`, `DEFAULT_TREBLE_MAX_GAIN = 6.0`; project decision D1. **There is no absolute gain ceiling and no Q clamp** — AutoEq's `DEFAULT_FIXED_BAND_FILTER_MIN/MAX_GAIN = -12.0/+12.0` and `DEFAULT_PEAKING_FILTER_MIN_Q/MAX_Q = 0.18248/6.0` describe *that tool's* envelope, not ours |
| Q, voicing preferred | 0.5 – 1.6 | Toole: broad low-Q colorations are what listeners actually notice over repeated listening; narrow deep bands are less audible and more likely mis-aimed |
| Q, narrowband ceiling | 4.0 | reserved for `sibilant`, `shrill`, `piercing` only |
| Shelf Q | **fixed 0.7** | AutoEq `DEFAULT_SHELF_FILTER_MAX_Q = 0.7`; every shipped oratory1990 shelf is `Q 0.70` |
| Center frequency | 20 – 20000 Hz | AutoEq shelf/peaking `MIN_FC = 20.0`; note AutoEq's optimizer caps at 10 kHz |
| Band scope | **all bands amendable, AutoEq included** | project decision |
| Crossfeed frequency | **300 – 2000 Hz, step 1** | libbs2b `BS2B_MINFCUT` / `BS2B_MAXFCUT`. The daemon's `/matrix` form serves `min="300" max="2000" step="1"`, matching the library constants. Read the live form at runtime rather than hardcoding — this is HQPlayer's form, not bs2b's library |
| Crossfeed level | **1.0 – 15.0 dB, step 0.1** | libbs2b `BS2B_MINFEED` / `BS2B_MAXFEED` = 10 / 150, encoded as dB × 10. The form serves `min="1" max="15" step="0.1"`, matching the library constants. Same runtime caveat |
| Compensation strength | 0 – 150 % | app-defined |
| **Headroom recompute** | on any net positive gain | AutoEq emits `Preamp: {-compound.max_gain:.1f} dB` — the negative of the maximum of the **summed** magnitude response of the whole chain. **Not** the negative sum of positive gains, and **not** the negative of the largest single band. For example, the shipped HD 650 preset's largest band is `+6.4` dB and its preamp is `-6.1` dB, because a `-3.1` dB band partially cancels it. |

Every positive-gain proposal must recompute the row `gain` (dB) by that rule across the **entire** chain — all EQ bands and compensation stages together — because they share one headroom budget.
