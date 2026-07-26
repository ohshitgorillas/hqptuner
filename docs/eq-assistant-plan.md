# EQ Assistant — implementation plan

Planning document. Design settled in discussion 2026-07-22; this records the
verified code findings the design must be built against, the rulings taken where
the design and the code diverged, and the phased delivery order.

Companion reading: `docs/eq-assistant/PRIMER.md` (domain brief, written for an agent
with no prior context), `docs/matrix-spec.md` (pipeline/matrix design of record),
`docs/testing.md` (binding testing policy).

---

## 1. What the feature is

An **AI SOUND TUNER** card at the bottom of the DSP tab: one text input plus a
session history. The user types a plain-language listening complaint ("too
boomy", "vocals sound distant", "half the time they're perfect, half the time
slightly too quiet"); the feature returns a **structured, measured diff** which is
*staged* into the app's existing pending-changes buffer. The user batches several
turns, then presses Apply once.

**It is a bounded tool-using agent, not a single completion** (F8). The model
diagnoses by computing the chain's actual response, proposes candidate fixes,
measures each one, and selects — iterating against a response-evaluation tool
before it answers. A single-shot completion cannot do this: evaluating a
candidate means evaluating a chain that does not exist yet, so no amount of
context preloading substitutes for the loop.

It is still not a chat client. The loop is invisible; only the final structured
answer reaches the user.

### Response contract

A strict union at the **final answer** — exactly one of `outcome`, `clarify`, or
`discuss`. Never more than one, no other branches. A non-validating answer is
rejected wholesale with a stock message. Intermediate tool calls are not part of
the union: they never reach the user, so they were never what it guarded against.

**Only `outcome` may carry `changes`.** That is the invariant the whole feature
rests on, and the third branch is shaped to preserve it rather than to bend it.

```jsonc
// branch 1 — the model acted
{
  "diagnosis":   { "method", "finding", "explains_symptom", "measured": {...} },
  "changes":     [ /* band / crossfeed / compensation changes */ ],
  "alternatives_rejected": [ /* candidates with their measured numbers + reason */ ],
  "variants":    [ /* co-equal candidates for the user to audition */ ],  // optional
  "recommends":  [ /* advisory: settings the model cannot touch */ ],    // optional
  "metrics":     { "<name>": { "before": <n>, "after": <n> } },
  "side_effect": { "metric", "delta", "judgment", "remedy" }   // optional
}

// branch 2 — the model needs an answer before acting
{ "clarify": "<one sentence>", "context": { /* optional measured values */ } }

// branch 3 — the user asked; the model answered and changed nothing
{ "discuss": { "answer": "<prose, length-bounded>",
               "measured": { /* what the tool returned */ },
               "basis": "measured" | "mechanism" | "vocabulary" | "unverified",
               "recommends": [ /* optional, same shape as on branch 1 */ ] } }
```

### `discuss` — the user's questions (D16)

Tuning by ear is a conversation. The user asks what they are hearing, why a Q was
narrowed instead of cut, whether a symptom is the compensation or the bass
summing. The two-branch union had nowhere to put that: `clarify` means *the model
is blocked*, not *the user is curious*, so a question forced the model either to
misuse `clarify` or to invent a change to have somewhere to hang the prose. Same
class of gap F8 found with `side_effect` — real behaviour, no slot.

**What the prose ban was protecting was anchoring, not silence.** "The model may
only speak when it acts" was a proxy. `evaluate_chain` supplies the real thing: a
question about the chain is answered by measuring the chain, and the prose sits
beside numbers the model *computed* rather than numbers it *recalled*. That is
the same discipline `diagnosis.explains_symptom` already lives under (D8).

Four properties, all load-bearing:

- **`changes` is structurally absent** — not an empty array. The union stays a
  real XOR over the write path: exactly one branch can stage. Answer-and-then-act
  is two turns.
- **`basis` is mandatory and rendered.** The validator cannot know whether a
  question was tool-answerable, but it can force the model to declare its
  footing: `basis: "measured"` requires a non-empty `measured`. A measured answer
  and a recalled one **must not look alike in the card** — that is the entire
  safety property, and it is what lets the user see which claims they can check.
- **A `discuss` turn does not append to any metric series.** The chain did not
  move. A series entry with no checkpoint behind it would show fake drift and
  would break P2's recompute-over-checkpoints, which assumes series entries map
  1:1 to checkpoints.
- **Prunable as a class.** "Forget the discussion, keep the tuning" falls out of
  D13's marking model for free.

This is still not a chat client: no free-form turn exists, every string is a
field of an object that declares its footing, nothing renders unanchored, and the
write path still has exactly one gate.

**Two failure modes it introduces**, both needing eval cases (P5):

1. **Deflection into chat** — the model emits `discuss` where a diff was wanted
   and quietly stops tuning. Very plausible for a Haiku-class model running on a
   helpful-assistant prior. Pass condition on a clear actionable complaint is
   `outcome`; `discuss` is a fail.
2. **Priors leaking unchecked** — discussion is where audio folk belief enters.
   F2a is a case where the model's prior is *wrong* and the docs had to correct
   it, so a `discuss` turn about crossfeed tilt will state the folk belief with
   confidence unless the prompt carries the correction. The mandatory
   tilt-direction case therefore needs a **`discuss`-mode variant**, not only an
   `outcome`-mode one.

Chatty sessions also push tuning turns out of the bounded ledger tail faster, so
the truncation rule counts `discuss` turns separately (P3's `ASSEMBLY.md`).

### `variants` — A/B by ear (D18)

The real session behind F9 handed back **two options to try**: a three-band
simplification and a two-band one. The union has no slot for that.
`alternatives_rejected` is the wrong shape — those are candidates the model
*discarded, with reasons*. Variants are **co-equal and undecidable by number**,
because the residual does not say which one a person prefers. Taste decides, and
the only instrument for taste is the user's ears.

A/B by ear is *the* audio workflow and the schema could not express it.

```jsonc
"variants": [
  { "label": "3-band",
    "changes": [ ... ],
    "measured": { ... },          // residual, worst-error, whatever the turn computed
    "tradeoff": "<one line: what this one buys and what it costs>" },
  { "label": "2-band", "changes": [ ... ], "measured": { ... }, "tradeoff": "..." }
]
```

**The Apply gate is what makes this non-trivial.** Only one variant can be staged
at a time, so the interaction is stage-one → audition → swap:

- **Swapping a variant is a re-stage, never an apply.** It replaces what is in
  the staging buffer and still waits for the user's Apply — D12's rule inherited
  wholesale, since a variant picker that wrote through would be exactly the
  second write lane past the gate that D12 exists to forbid.
- **The ledger records that they were siblings.** Without that, "go back to the
  two-band one" does not resolve — the unpicked variants are not history, they
  are live alternatives for as long as the turn is open.
- **Unpicked siblings stay available until the turn is applied or discarded**,
  then they become ordinary ledger record like everything else.

**Variants are for genuine taste forks only.** Where measurement decides, the
model picks and puts the losers in `alternatives_rejected`. Offering variants to
look thorough is padding, it pushes the choice back onto the user for no reason,
and P5 scores it as a failure rather than as diligence.

### `recommends` — advisory reach beyond the surface (D19)

**The argument for this is that the alternative is symptom masking.** If the
model can see that the oversampling filter is implicated in a spatial complaint,
and its only levers are EQ and crossfeed, it will EQ *around* a problem that is
fixable at the source. Treating the symptom while the cause sits in plain sight
is worse than saying nothing, and it is exactly what a silent model would do.

So the model may **recommend anything, and change only the four.** The
recommendation costs nothing structurally — it is a rendered object with a
citation and no write path — and the user is the one who acts on it. This
reinforces the enable/disable boundary rather than eroding it: the model says
what it would change, and a human changes it.

**A field, not a fourth branch.** The motivating case is simultaneous — *"your
filter is a long one; based on what you're describing you might prefer something
shorter. Or I can proceed with the EQ as discussed, and here is what I'd do."*
A branch would be an XOR and would force the model to choose between advising and
acting. Riding on `discuss` covers the advise-only case with no changes, so no
new branch is needed.

```jsonc
"recommends": [{
  "setting":    "<schema key, e.g. pcm_filter>",
  "current":    "<live value>",
  "suggested":  ["<enum name>", "..."],
  "reason":     "<prose>",
  "basis":      "mechanism" | "cited" | "unverified",
  "confidence": "high" | "low"
}]
```

**The structural guard is free, and architecture §2 already supplies it: a
suggestion may only name values present in the live engine enumeration.** The
validator rejects anything else. This kills the likeliest failure outright —
HQPlayer is niche, the model's recall of it is thin, and an **invented filter
name is worse than bad advice because it is unfollowable**. Joining by live name
also means a HQPlayer version bump cannot leave a stale hardcoded list behind,
the same reasoning as D6.

**`basis: "mechanism"`** is the footing this branch should normally stand on: a
documented property plus its physical consequence, with the property from the
manual and the filter's position derived from the live enumeration. It is
stronger than "I read it somewhere" because it is checkable end to end. See D20
for the axis layer that makes it expressible.

### Uploads — the user hands the model a file (D21)

The user can upload material: a measured frequency response, a
`ParametricEQ.txt` from anywhere, a manufacturer sheet, a review, their own notes
from earlier sessions.

**All of it is accepted. There is no accept/reject split, and `basis` carries the
weight instead.** An earlier draft here proposed admitting parseable data and
refusing prose, on the grounds that a review is folklore with a file attached.
That was withdrawn: it protects the user from their own judgment, and it is
incoherent besides, since `basis` (D16) exists precisely so unverifiable material
can be present without masquerading as fact. If someone hands the model a file,
they have already decided it has value, and they know its provenance better than
the model does.

**The ladder, strongest to weakest:**

| basis | source |
|---|---|
| `measured` | computed by the tool this session |
| `mechanism` | documented property + its physical consequence (D19, D20) |
| `cited` | user-supplied file — names the file and the location within it |
| `vocabulary` | the sourced vocabulary asset |
| `unverified` | model recall, nothing behind it |

**`cited` sits above `unverified`, and that ordering is the whole correction.** A
user-supplied writeup is attributable, re-readable, and chosen deliberately;
model pretraining recall on a niche headphone is none of those. Uploading a
review **improves** the epistemics over guessing from memory rather than
degrading them.

What still holds — properties of the mechanism, not judgements about the user:

- **Attribution is mandatory.** A claim drawn from a file names the file. Not to
  gate anything: so the user can check it, and so the ledger's forensics work.
  Same rule every other part of this design already follows.
- **Parser safety.** Size cap, bounded parse, never `eval`. That is about the
  process, not about second-guessing the upload.
- **PDF text extraction is a real dependency** (`pypdf`-class) and the tree is
  currently pure-Python. A cost to name, not a reason to refuse — and this
  project already treats two PDFs as authority, so PDFs-as-reference is
  established practice here.
- **Retrieval, not dumping.** Curves are sampled; prose is chunked and queried.
  A forty-page PDF pasted into the ledger tail would evict the user's actual
  tuning turns. A mechanism problem, not a permission problem.
- **Pruning must reach uploads**, separately from turns and exactly as it must
  reach metric definitions (§1). An upload is the highest-volume path into the
  context window, so if one poisons the reasoning, amnesia has to be able to drop
  it — otherwise amnesia appears to work and does not.

**The step change is Class-A data plus the solver.** With a measurement in hand,
"too boomy" stops being a vocabulary lookup and becomes *"your measurement shows
+6 dB at 90 Hz"*. A measurement plus a target curve plus `fit_chain` (D17) is
**AutoEq in-app, from the user's own data** — nearly free now that the solver is
already planned, and arguably worth more than the conversational surface.

It also unlocks a diagnostic otherwise unreachable: **an uploaded measurement can
contradict the loaded profile.** "Your profile targets Harman; your measurement
shows the seal is not reaching the bass shelf" is a finding no amount of chain
arithmetic could produce, because the chain is not where that fault lives.

**The prose rule, restated (revised — see F8).** The original wording was "no
freeform model prose is ever rendered", and that is too strong: it would suppress
the single most valuable output the feature produces. The rule is now:

> **Prose is permitted only as a field of a structured object that carries the
> numbers it describes. Free-form turns are still banned.**

`diagnosis.explains_symptom` is anchored to `diagnosis.measured` and cannot
wander from it; a chat reply can. That distinction is the whole rule.
`alternatives_rejected` earns its place the same way — it is numeric, structured,
and is precisely what a user needs to see under a change to judge it.

**`clarify` has three modes**, and mode 3 is the most common in practice:

1. **Scope deflection** — the request is outside the surface (a feature toggle,
   "make it louder", a hardware question). **Narrowed by D19:** a filter or
   shaper question no longer dead-ends here — it can be answered and advised on
   through `recommends`, which the model still cannot act on itself.
2. **Low-confidence inference** — the target is derived from a named product
   rather than a descriptor and recall is uncertain (P3's product-knowledge rule).
3. **Magnitude proposal** — the direction is clear but the amount is not, so the
   model surfaces the responsible band's current value and asks what to aim for.

The prompt must teach all three or the model will guess a magnitude rather than
ask.

### The adjustable surface

The model may adjust exactly four things, and only while they are already
enabled:

1. **EQ bands** — parametric IIR stages (type, frequency, gain, Q) in the
   pipeline chain, plus a rationale of ≤80 characters per change. Every band in
   the chain is in scope, AutoEq imports included; see F3 and D2.
2. **Crossfeed parameters** — Bauer crossover frequency (Hz) and level (dB).
3. **Crossfeed compensation strength** — the 0–150 % figure.
4. **A band segment, replaced wholesale** (`replace_segment`, D17) — the
   simplification case. Not an amend and not an append: N bands out, M bands in
   across a declared frequency span. It must report its fit residual, and it
   renders as a before/after curve overlay rather than as a change list, because
   a twelve-line diff says nothing about whether the curve survived.

The model **cannot enable or disable any feature**. Turning crossfeed on, turning
compensation on, enabling the matrix — all user-only. It is guided to prefer
zeroing a band's gain over removing it, but that is prompt guidance rather than a
hard rule (F3, D2) — and it **does not apply inside a `replace_segment`**, where
zeroing twelve stages would leave twelve dead stages and defeat the entire point
of the operation.

### Visibility

Env-gated. The card renders only when the AI token variable is non-empty. No key
or URL entry anywhere in the UI; **the token never reaches the browser**. Model
selection is a dropdown inside the card, populated from whatever the configured
endpoint serves. Unset env → the feature is invisible and has zero footprint.

### Session ledger, and the metric panel

One entry per turn: complaint, the full answer object above, model id, prompt
version. Sent back as bounded context (last N turns) so "back off that last
change" resolves. Persists across Apply, so post-listen iteration can reference
now-live turns. Discard **marks turns discarded rather than deleting them**.

**The session also accumulates a metric panel, and this is session state in its
own right** (F8). A metric is *invented by the model* to operationalise a
complaint — "I hate V-shaped" became
`v_db = mean(bass 50–150, treble 4k–10k) − mid 400–1500` — and thereafter it is
**standing regression state**: every later turn reports it, whether or not that
turn was aiming at it. Two turns after it was coined, `v_db` was the number that
decided an unrelated bass fix was acceptable.

So the ledger stores, alongside the turns:

| field | meaning |
|---|---|
| `metrics[name].definition` | the band arithmetic, as data — coined once, reused forever |
| `metrics[name].origin_turn` | which complaint produced it |
| `metrics[name].series` | value after every turn since, so regressions are visible |

Every answer reports the **whole panel**, not just the metric it was aiming at.
That is what makes a side effect detectable at all, and it is what makes "back
off that last change" cheap — the numbers are already there, not just the intent.

### Session lifecycle — recovering from a bad session

A model goes off the rails, or the ledger accumulates something wrong that later
turns build on. These are **different failures** and they need different
remedies, because the sound and the reasoning can each be bad independently:

|  | **keep the chain** | **revert the chain** |
|---|---|---|
| **keep the ledger** | — | **Rewind** — undo the sound, keep the reasoning. "That last change was wrong, but you understood why." |
| **prune the ledger** | **Amnesia** — keep the sound, forget how we got here. The context-poisoning fix. | **Reset** — back to session start. |

**Amnesia is the one that matters and the one nobody builds.** When a model
mis-diagnoses early and every later turn reasons from that finding, the *chain*
may be perfectly good — it was corrected by ear along the way — while the
*context* is poison. Throwing away the EQ to fix the conversation is the wrong
trade; the user listened their way to that curve.

**Every turn stores a checkpoint of the chain state before it** (bands, crossfeed,
compensation strength). A dozen bands of JSON per turn — storage is irrelevant,
and it buys three things:

- **Rewind to turn N** without replaying anything.
- **Metric redefinition with a recomputed history.** A badly-defined coined
  metric can be redefined and its whole series recomputed over the stored
  checkpoints, so the panel stays comparable instead of showing a discontinuity.
  This is only possible because the checkpoints exist.
- **Forensics** — the export shows what the chain looked like when each decision
  was made.

Three rules govern all of it:

- **Revert stages, it never applies** (D12). A rewind puts the checkpoint into
  the staging buffer and the user presses Apply, exactly like any other change.
  Anything else is a second write lane past the Apply gate.
- **Pruning marks, it never deletes** (D13). Excluded turns stop being sent as
  context and stay in the export, flagged. If you are studying why a model went
  off the rails, deleting the evidence is precisely wrong.
- **Metric definitions outlive the context window.** The ledger is sent bounded
  (last N turns), so a poisoned turn older than N is already out of context while
  its coined metrics are still steering every answer. Pruning must reach metric
  definitions separately from turns, or amnesia silently fails to work.

---

## 2. Verified findings

Established by reading the code on 2026-07-22, not inferred.

### F1 · Crossfeed parameters

`static/store/schema.js:204-207` — all four keys are **http lane**
(restart-required), endpoint `matrix`:

| schema key | form field | widget |
|---|---|---|
| `crossfeed_enabled` | `post_bauer_enabled` | checkbox |
| `crossfeed_preset` | `post_bauer_preset` | dropdown |
| `crossfeed_frequency` | `post_bauer_frequency` | knob, default 700 Hz |
| `crossfeed_level` | `post_bauer_level` | knob, default 4.5 dB |

**Bounds are not hardcoded.** They arrive from the daemon's `/matrix` form
constraints at runtime via `matrixByName`. The old design sketch's "300–2000 / 1–15"
is only that — a sketch; libbs2b's own `BS2B_MINFCUT`/`MAXFCUT` and
`BS2B_MINFEED`/`MAXFEED` agree with it, but the validator still reads bounds from
the served form, with constants as fallback only. Otherwise a HQPlayer version
bump silently desyncs the clamps.

`state.js:applyBauerCoupling` — editing frequency or level auto-sets the preset
to `custom` within the same stage POST. The AI path routes through `edit()` to
inherit this rather than writing the field directly.

### F2 · Compensation consistency is invalidate-and-prompt, not recompute

Compensation is **eight literal wire rows**. `msCompile()` (`lib/xfeed.js:144`)
rewrites the stereo EQ pair at pipelines 1+2 into mid/side rows with
`gainunit:"Lin"`; the M rows carry `eqProcess` plus two RBJ high-shelves fitted
by `fitComp()` to the inverse of the crossfeed's centre tilt.

Detection is **purely structural, every render**. `msRecognize()`
(`xfeed.js:173`) matches the source/mixdown/gain-sign pattern and regexes the
comp suffix. There is no tag, no metadata, no stored flag.

Staleness is computed, never stored: `msRecognize` runs a fresh `fitComp(fc,
feed)` for the **current** crossfeed parameters and compares the stored shelf f/q
(tolerance 0.5 Hz, 0.005 Q). A mismatch sets `stale: true`, which surfaces as a
badge on the Pipelines card ("out of date — the crossfeed settings changed; press
Rebuild") plus a **Rebuild** button on the Response card. `stageBlock()`
recompiles at the preserved percentage.

So the app today **never silently recomputes and never silently goes stale** — it
flags and waits for a human click. Correct for a knob the user turned by hand.

**Ruling — the AI path rebuilds in-turn.** When a turn changes a crossfeed
parameter and a recognized compensation block exists, the same diff emits the
recompiled block, preserving `sFraction`, `eqProcess`, and `preampDb`. This
reuses `fitComp` + `msCompile` and introduces no new math.

**This applies whether or not the block was already stale on entry.** A block
left out of date by an earlier hand-edit gets rebuilt too. The rebuild is a
pipeline change, so it appears in the turn's structured diff exactly like every
other change — there is nothing silent about it and it needs no narration. (An
earlier draft proposed refusing the change when the block was already stale, and
a variant that narrated the rebuild in prose. Both were rejected: the first hands
the user a chore mid-session, the second violates the `changes` XOR `clarify`
union.)

#### F2a · The tilt direction — corrected

The centre tilt the compensation inverts is

```
tilt = 20·log10(1 − gHi + gLo)
```

It depends **only on feed** — crossover frequency does not enter it — and it
**decreases** as feed rises:

| feed | 1.0 | 4.5 (default) | 6.0 | 9.5 | 15.0 |
|---|---|---|---|---|---|
| centre tilt | 2.70 dB | 1.81 dB | 1.53 dB | 1.09 dB | 0.92 dB |

So **more crossfeed level means *less* centre dulling**, which is the opposite of
the common intuition and the opposite of what the first draft of the research
assets asserted. Verified numerically against `lib/xfeed.js`; corroborated by the
app's own UI copy, which states a 1–2.7 dB range. The relationship is compressive
— a ±1.5 dB feed nudge moves tilt about 0.3 dB, broad and at or below audibility.

Crossover frequency changes still make the compensation block stale (the fit is
*seeded* from the crossover), so a recompile is mandatory for those too.

Not to be conflated: crossfeed also sums correlated bass between channels, which
can raise perceived weight. That is a separate effect and is not what
compensation corrects.

Because a model's priors will supply the folk belief here, this is an **eval
case**, not merely a documentation fix.

### F3 · AutoEq bands are in scope — amend before append

*Revised 2026-07-22 by user decision; supersedes the protected-segment design.*

There is no provenance metadata in the wire format. `doImport()`
(`components/MatrixTab.js:492`) appends parsed stages onto the row's `process`
string and maps the `Preamp:` line onto the row `gain`; `parseEqText` →
`editedStage` produces ordinary stages indistinguishable from hand-typed ones.

An earlier draft treated that as a gap to be closed, and proposed an
exclusively-owned appended segment so AutoEq bands stayed untouchable. **That is
withdrawn.** It was based on a misreading of the requirement, and it produces the
failure it was meant to prevent: an AutoEq preset already tiles the spectrum with
eight to ten measurement-placed bands, so a complaint almost always has a band in
its region already. Amending that band's gain is a one-number change that leaves
the curve readable. Appending a fresh band beside it makes the net response the
sum of two overlapping filters, and a few turns of that is unreasonable. This was
established empirically in a manual tuning session before the feature was
specified.

**Amend before append — as prompt guidance, not a validator rule.** An earlier
draft made this a hard rejection ("reject an append where a band covers the
region"). That was wrong twice over. Every vocabulary region contains one of the
preset's bands, so the rule reduces to *never append*; and it forces amending
whatever band is nearest regardless of whether that band suits the job. AutoEq
bands are not interchangeable — a Q 0.7 shelf is broad shaping, a Q 4 notch at
5.7 kHz is killing a measured resonance. Amending the notch to satisfy "a bit
less bright" does not voice anything; it silently undoes a measurement
correction.

The real test is **filter suitability, which is a judgment**: amend when a band
sits near the target *and* its shape fits the move being asked for; append when
the nearest band is surgical, or nothing suitable is near. Vocabulary entries
carry `typical_q`, which gives the model a target shape to compare against.
Encoding this as a rejection would mean encoding taste, which a validator cannot
do. It lives in the prompt; the user corrects in plain language when the model
gets it wrong, and the ledger carries that correction forward as context.

Deletion is likewise guidance, not prohibition: prefer zeroing a band's gain to
removing it, because it keeps the chain shape stable across turns. Discard and
profile re-import both recover from a bad call.

Mangling the AutoEq correction is one-click recoverable (re-import from the
library picker) and nothing reaches the daemon without Apply, so it never
warranted an architecture to prevent.

### F4 · Staging plumbing is already sufficient

Pipelines stage as one atomic canonical-JSON http field `matrix_pipelines` via
`stagePipelines(rows)`, server-side, surviving browser reload. Crossfeed
parameters stage via `edit(key, value)`. `dirtyKeys` / `split` / PendingBar /
Apply pick both up unchanged.

**The EQ Assistant writes through the same two functions the existing UI uses.** No
new apply plumbing, no new lane. "Staged only, never auto-applied" is nearly free.

### F5 · Headroom recompute needs no new math

Row `gain` (dB) is the preamp. With compensation on it is folded into the Lin
gains (`k = 0.5·10^(preamp/20)`) and recovered by `msRecognize` as
`20·log10(k/0.5)`. `lib/dsp.js:chainResponse` + `logFreqs` already compute chain
magnitude across the band — they drive every plot. Headroom recompute is a max
over that, taken across the **entire** chain, since all bands share one budget.

### F6 · Gate constraints that force the architecture

- 500-line file cap (`scripts/check_file_length.py`), xenon B/A/A, strict mypy,
  vulture → new Python lands as a package `hqptuner/ai/`, several small modules.
- `docs/testing.md`: fakes speak the wire protocol; mocking our own code is
  forbidden → a **fake OpenAI-compatible HTTP endpoint**, mirroring
  `tests/fake_http.py`.
- **The JS side has a test runner too:** `make test-js` runs `node --test` over
  `tests/js/` (`docs/testing.md`), so new frontend code lands with a test.

→ **The enforcing validator is Python, server-side.** The client gets only the
compile-and-stage step, reusing already-verified math. This is a constraint, not
a preference: guardrails implemented in JS would be ungated by `make check`.

### F7 · A real tuning session, and what it corrected

`docs/eq-assistant/auteur-classic-tuning.json` — nine turns from an actual session
(ZMF Auteur Classic on an oratory1990 profile), exported after the fact. This is
ground truth rather than invented examples, and it is the **source for P3's
few-shot pairs and P5's eval cases**. Three things in it contradicted the design.

**The session was run with Opus 4.8, and that qualifies everything below.** It
demonstrates what Opus-class reasoning produces; it is **not** evidence that a
Haiku-class model reaches any of it. Cases derived from this file are therefore
calibrated at the top of the ladder, so a weaker model failing them is the
expected result rather than a surprise — P5 must tier them accordingly and must
not read "these are real cases" as "these are baseline cases". The turns that
reason over summed response (3, 4) and the Q diagnosis (2) are the ones most
likely to separate model classes, and are the most useful gate material for
exactly that reason.

**`clarify` is mostly a proposal, not a deflection.** Both clarify turns surface
the responsible band's current value and ask for a target — turn 1 quotes
`PK 107 Hz, −5.2 dB, Q 0.26`, turn 8 recaps what was heard and asks what lands
next. Neither is out-of-scope. See §1 for the corrected three-mode contract.

Turn 1 is also a clean tier-3 case ("where the auteur classic's magic is") where
the model clarified instead of guessing — the product-knowledge rule (P3)
validates against real behaviour.

**Q is load-bearing and is the parameter most likely to be mis-set.** Turn 2
moves the 107 Hz band from Q 0.26 to Q 0.70 and names that as the root cause:
"Q0.26 gutted 200-800 Hz". The original fault was a band so wide it ate the lower
midrange; the fix was *narrowing* it, not merely reducing gain. Q therefore
stays **unclamped** — a legitimate correction here spans nearly a factor of
three, and a bound tight enough to be safe would have blocked the fix. It is
guidance in the prompt and a **scored dimension in P5's eval**, consistent with
D2a: taste is measured, not enforced.

**The model reasons over the summed response, not the band list.** Turn 3: "Cut
sat atop the shelf, netting only ~+1.5 dB." Turn 4 appends an anti-mud dip
because "the heft pass raised" it. The prompt must therefore carry the current
chain **and its computed summed magnitude response**, not just an enumeration of
bands — a requirement P3's `ASSEMBLY.md` has to state explicitly.

Two secondary confirmations: multi-band turns are normal (turns 2, 3 and 6 move
two or three bands each, so the per-turn band budget cut in D2 was right), and
the back-off pattern occurs naturally — turn 5 reverses turn 3's shelf raise and
turn 9 partially undoes turn 4's appended dip, giving the ledger-referencing
few-shot real examples.

### F8 · The session continued, and broke the single-turn design

Later turns in the same file (still Opus 4.8) are qualitatively different from
the early ones, and they invalidate the single-completion contract outright.

**A turn is a tool loop, not a completion.** The "half the time perfect, half
slightly too quiet" turn ran: diagnose → compute the live chain's net response →
generate four candidate fills → measure each at note fundamentals → select. The
selection step is what forces the tool: **measuring a candidate means evaluating
a chain that does not exist yet**, so no amount of context preloading substitutes
for it. One tool, called in a loop:

```
evaluate_chain(candidate_changes[], at_frequencies[])
    -> { hz: net_db }, plus band averages and a spread figure
```

**Frequencies are musical, not a log grid.** It evaluated at E1/E2/A2/D3/E3/A3/D4
fundamentals, and that is what produced the actual insight — *"E2 sits in the
boosted region and sounds right, A2 upward falls in the trough"* explains the
symptom in a way a uniform grid does not. The tool takes arbitrary requested
frequencies; the prompt teaches the note-fundamental framing.

**Ripple is a diagnosis class the vocabulary cannot express.** "Half the time
perfect, half slightly too quiet" is not thin, not recessed — it is
*inconsistent*, and the fix is flattening rather than shifting. `vocabulary.json`
maps term → region → direction, which cannot represent it. This is a missing
category, not a missing term.

**Metrics are invented, then become standing state.** See §1's metric panel. This
is the largest gap between the observed behaviour and the original design.

**Compound complaints are handled jointly, and the interaction check is the
value.** One utterance carried both "no OOMPH" and "still a little forward"; the
two fixes were checked against each other rather than applied independently,
because the oomph fill raises the bass band while the presence trim lowers only
1.8–4 kHz — and the net effect landed on `v_db`, a metric coined two turns
earlier. The earlier tier-2 framing said the work was *separating* overlapping
complaints. Separating them is step one; checking the fixes do not fight, against
metrics from earlier turns, is the actual work.

**Side effects are disclosed with a remedy named in advance.** `v_db` rose to
+0.38 from the oomph fill; the model judged it acceptable, disclosed it before
applying, and pre-named the remedy (+0.4 on the 750 Hz band rather than
reverting). The union had no slot for this and an ≤80-character rationale cannot
hold it — hence the `side_effect` field in §1.

**It adopted a policy nobody wrote.** Rejecting "lower the 2096 and 7959 peaks
instead of filling": *"those levels were set by ear in earlier turns and
validated; clawing them back would undo accepted decisions."* Prefer additive
fills over revising values the user already signed off by ear. That belongs in
the prompt rather than being rediscovered each session.

**`alternatives_rejected` is first-class output.** Every later turn carries the
candidates not taken, with measured numbers and reasons. It is structured and
numeric, it renders safely, and it is what lets a user judge a change rather than
take it on faith.

**Consequence — the prose rule was too strict.** `diagnosis.explains_symptom` is
the most valuable string the feature produces. §1 now permits prose *as a field
of a structured object carrying the numbers it describes*, and continues to ban
free-form turns. Decision taken 2026-07-22.

**The file is the format spec.** `auteur-classic-tuning.json` now carries
`base_bands`, and per turn `diagnosis`, `alternatives_rejected`, `measured`,
`selected_*`, `side_effect_flagged`, `verification`, and `answer` on clarify
turns. The schema is harvested from it, not designed in parallel with it.

### F9 · `evaluate_chain` is forward-only, and the inverse problem is unreachable

*Established 2026-07-26 from a real session, to be recorded as an asset
alongside `auteur-classic-tuning.json`.*

A user asked a chatbot to simplify roughly twelve peaks in the mid-bass, and got
back **two candidates — a three-band version and a two-band version** — because
that model could *solve*, not merely evaluate.

`evaluate_chain` cannot reach this. It is a **forward** evaluator: given bands,
return net dB. Simplification is the **inverse**: given a target curve and a band
budget, solve for the bands. Through a forward tool the model would have to run
descent by hand across dozens of round trips, and **D15's per-turn loop cap
aborts it long before convergence**. This is an architectural gap, not a prompt
gap — the same shape of argument D7 made about the loop itself.

**Two senses of "scratchpad" get conflated here, and only one is missing.**
*Reasoning space* — algebra in the model's head — it already has, free, and it is
adequate for `20·log10(0.5)`. It is **not** adequate for a multi-variable fit,
where failure is invisible: the output is a plausible-looking band set that does
not actually fit. *Compute* is the missing half.

**Dependency state, verified 2026-07-26:** `pyproject.toml` carries no `numpy`
and no `scipy`; the tree is pure-Python (`fastapi`, `uvicorn`, `httpx`,
`beautifulsoup4`, `defusedxml`, `python-multipart`). A Nelder-Mead over ~12
parameters against ~60 log-spaced points runs in milliseconds in pure Python and
is roughly sixty lines. **Do not add a numeric dependency for this** — xenon
B/A/A forces it factored small regardless.

**Why this is in scope rather than an extra.** Twelve stacked mid-bass peaks is
precisely what append-heavy sessions produce — the failure F3 predicted when it
withdrew the protected-segment design. Simplification is partly cleanup of this
feature's own mess, so the feature owes it.

### F10 · The filter asset already exists — D20 is a layer, not a file

*Verified 2026-07-26 by reading the shipped data, not inferred.*

`hqptuner/data/filters.json` already carries, per engine-reported filter name:
`genre`, `quality`, `focus`, `apodizing`, `ratio` and a manual-sourced
`description`, with `aliases`, `_join_rules`, a `two_stage_note`, and a
`guidance` block. Its `_source` is `hqplayer6desktop-manual.pdf §4.6`.

Its own `_comment` settles the open question about how a filter's dimensional
position is known, and it is better than name-parsing guesswork:

> "quality/focus/ratio ship live in FiltersItem descriptions, apodizing in arg
> bit 0, **phase is encoded in the name**"

`hqplayerd-readme.txt` corroborates: the live description strings carry length and
phase as literal text — "Apodizing extra long Gaussian polyphase",
"linear-phase", "intermediate-phase", "minimum-phase". So **no fragile suffix
parser is needed and no per-filter table has to be authored**; position is read
from what the engine already reports, which is architecture §2's rule anyway.

Two consequences worth stating:

- **Genre-aware advice is already sourced.** The `genre` column is the manual's
  own and is explicitly flagged non-editorial, so "this filter is listed for
  rock/pop" is a citation rather than an opinion. That matters directly for
  complaints scoped to particular material.
- **D20 shrinks to an axis layer inside the existing `guidance` block** — the
  perceptual mapping and the negative rules. No new asset, no new file.

**Deliberately not done here.** The axis content itself is not authored in this
pass: writing perceptual claims into a shipped data file that feeds UI tooltips
needs a read of manual §4.6 proper, not the greps above. It lands in P1, where
the asset-reconciliation work and its acceptance criteria already live.

---

## 3. Settled decisions

Recorded so they are not relitigated.

| # | Decision | Rationale |
|---|---|---|
| D1 | **±6 dB per turn, the only policy clamp.** No absolute cap | We are adjusting an existing measurement-grounded profile, not generating one from scratch, so the profile itself sets the envelope. A per-turn bound keeps one turn's blast radius reviewable and makes "back off that last change" tractable. Cumulative drift is self-limiting: the user is listening between turns |
| D2 | **All bands amendable, AutoEq included. Amend-before-append and prefer-zeroing-to-deleting are prompt guidance, not validator rules.** No band caps | Per F3 — coverage is the wrong test and suitability is a judgment. Encoding it as a rejection means encoding taste |
| D2a | **Guardrails split three ways: validity / correctness / policy** | Validity = values the engine or form accepts (crossfeed bounds from the served form, compensation 0–150 %, the schema union). Correctness = headroom recompute and the in-turn compensation rebuild; arithmetic, not opinion. Policy = D1 alone. Everything previously in the guardrail table that fits none of these is prompt guidance |
| D3 | **Crossfeed change always rebuilds compensation in-turn**, stale or not, with no narration | The rebuild is a pipeline change and shows in the structured diff; narration would violate the `changes` XOR `clarify` union |
| D4 | Plan lives here; **no separate phase-plan entry** | User decision |
| D5 | Validator is Python; client only compiles and stages | Per F6 — JS guardrails would be ungated |
| D6 | Crossfeed bounds read from the served `/matrix` form | Per F1 — constants desync on a HQPlayer version bump |
| D7 | **A turn is a bounded tool loop, not a completion.** The union constrains the final answer only; intermediate tool calls never reach the user | Per F8 — measuring a candidate means evaluating a chain that does not exist yet, which no context preloading can supply |
| D8 | **Prose is permitted as a field of a structured object carrying the numbers it describes; free-form turns stay banned** | Per F8 — `explains_symptom` is the feature's most valuable output and is anchored to `measured`, so it cannot wander the way a chat reply can |
| D9 | **The metric panel is session state.** Model-coined metrics carry a definition, an origin turn, and a series; every answer reports the whole panel | Per F8 — `v_db` decided an unrelated turn two steps after it was coined. Reporting only the targeted metric makes side effects undetectable |
| D10 | **`lib/dsp.js` is the reference implementation; the Python port follows it**, pinned by a committed fixture | The plots are what the user has been trusting, so the curve they see is authoritative. Two implementations of RBJ that drift silently would have the model optimising against a curve nobody sees |
| D11 | The evaluation loop runs **server-side** | The token lives there, and blocking a multi-iteration loop on a round-trip to a browser tab that may have closed is fragile |
| D12 | **Revert stages, it never applies.** A rewind lands a stored checkpoint in the staging buffer and waits for Apply | Anything else is a second write lane past the Apply gate, which is the one invariant the whole feature is built on |
| D13 | **Pruning marks, it never deletes.** Excluded turns leave the context window and stay in the export, flagged | Same rule as Discard. A session that went wrong is the most valuable thing to study; deleting the evidence to tidy it is backwards |
| D14 | **Every turn stores a pre-turn chain checkpoint** | Cheap (a dozen bands of JSON), and it is what makes rewind-to-N, metric-redefinition-with-recomputed-history, and forensics all possible at once |
| D15 | **The tool loop is capped per turn** and aborts with a stock message | An unbounded loop is a cost, latency and runaway hazard; a turn that cannot converge inside the cap is itself a signal worth surfacing |
| D16 | **A third branch, `discuss`, answers the user's questions.** Prose + `measured` + a mandatory `basis`; `changes` structurally absent; no metric-series append; prunable as a class | Tuning by ear is a conversation. `clarify` means *the model* is blocked, not *the user* is curious, so a question had nowhere to go but `clarify` misuse or an invented change. What the prose ban protected was anchoring, not silence — `evaluate_chain` supplies the anchor, and `basis` makes the footing visible instead of trusting the prompt to hold the line. The `basis` ladder extends in D19 (`mechanism`) and D21 (`cited`) |
| D17 | **A second tool, `fit_chain`, solves the inverse problem**, and `replace_segment` is a change class in its own right | Per F9 — a forward evaluator cannot reach a fit, and hand-rolled descent dies on D15's cap. A purpose-built solver beats sandboxed code execution here: arbitrary exec would run in the process holding the daemon credentials and owning the staging lane; it is untestable under `docs/testing.md` (you would be testing the sandbox, not the capability); and it is non-deterministic, so P5 could not score it. A sandbox is **deferred, not refused** — revisit if two tools prove one short. Amends P6's "band count never decreases" and exempts itself from prefer-zeroing |
| D18 | **`outcome` may carry `variants` — co-equal candidates the user auditions.** Swapping one is a re-stage, never an apply; the ledger records them as siblings | A/B by ear is the audio workflow and the schema could not express it. Distinct from `alternatives_rejected`, which is what the model discarded *with reasons*: variants are undecidable by number, because the residual does not say which one a person prefers. Restricted to genuine taste forks — where measurement decides, the model decides, and padding an answer with variants is scored as a failure (P5) |
| D19 | **`recommends` — the model may advise on settings it cannot change.** A field on `outcome` and on `discuss`, never a branch. Suggestions are constrained to the **live engine enumeration** | The alternative is symptom masking: a model that sees the filter implicated and can only reach EQ will EQ around a cause sitting in plain sight. Advising costs nothing structurally and the user is the one who acts, so it reinforces the enable/disable boundary rather than eroding it. A field rather than a branch because the motivating case is simultaneous — advise *and* propose the EQ. The live-enum constraint kills the invented-filter-name failure, which is the likeliest one on niche software and is worse than bad advice because it is unfollowable |
| D20 | **Filter advice is dimensional, never per-filter reputation.** An axis layer in `filters.json`'s existing `guidance` block: length, phase, apodizing — each with a mechanism, a symptom→direction mapping, and an honest `contested` note. **One axis moves at a time**, and the layer carries **negative rules** naming the symptoms that are not filter symptoms | Per-filter reputation is forum folklore, gear-dependent and unsourceable — the user ruled it out. Dimensional properties are not: linear phase puts ringing symmetrically around a transient so energy arrives before the attack, minimum phase moves it all after at the cost of frequency-dependent group delay, and filter length is a straight trade of frequency-domain accuracy against time-domain compactness. That is mechanism, and Toole is already a cited source for phase audibility. It is also **`vocabulary.json`'s own structure applied to a second parameter space** — descriptor → axis → direction — so it is a sibling asset, not a new epistemology. Effect sizes are real but small and contested near Nyquist; the `contested` field says so rather than overselling. One-axis-at-a-time because changing family, phase and length together makes the A/B unattributable and teaches nothing. Negative rules because without them a filter suggestion becomes the model's escape hatch for any complaint it cannot fix, which is a confident non-answer |
| D21 | **The user may upload files, all kinds, and `basis` carries the weight** — with `cited` ranking *above* `unverified`. Attribution mandatory; retrieval not dumping; pruning must reach uploads separately from turns | An accept/reject split by file kind protects the user from their own judgment, and contradicts `basis` (D16), which exists so unverifiable material can be present without masquerading as fact. A user-supplied writeup is attributable, re-readable and deliberately chosen; model recall on niche gear is none of those, so uploading **improves** epistemics rather than degrading them. The step change is a measurement plus `fit_chain` — AutoEq in-app from the user's own data — and a measurement that contradicts the loaded profile is a fault chain arithmetic cannot see |

---

## 4. Phases

Dependency order: `P0 → P1 → P2 → P3 → P4 → P5 (gate) → P6 → P7 → P8`, with P2
parallelizable against P1 and P3.

Every phase hands back with `make check` green plus PASS/FAIL per acceptance
criterion. P7 additionally carries the binding visual protocol from
`docs/design-system.md`:
fresh headless-chromium screenshots at 1280 with measured DOM numbers, never
eyeballed. Every phase with user-visible surface lands its `CHANGELOG.md` entry
in the same commit.

### P0 · Domain research — **complete**

`SOURCES.md`, `vocabulary.json` (25 tonal + 13 spatial), `PRIMER.md`. Sources:
Sean Olive / Harman listener-training research; FORCE Technology Sound Wheel
lexicon (reached via ITU-R BS.2399-0, the AES paper being paywalled); Audio
Commons timbral models; Owsinski's descriptor tables; AutoEq's documented
filter/gain/Q/preamp conventions (our clamps align with these); Toole on
audibility and broad-vs-narrow adjustments. Spatial: Meier, bs2b documentation,
crossfeed-perception literature.

Two corrections were applied to the first draft on 2026-07-22 and are recorded in
`_meta.corrections`: the inverted tilt direction (F2a) and the AutoEq scope
reversal (F3). Both are flagged in place in the assets rather than silently
overwritten.

Known gaps, honestly marked in `SOURCES.md`: r/oratory1990 unreachable (only his
preset data via AutoEq is cited, no reasoning attributed); three AES papers
paywalled; Toole's book secondary-sourced and flagged not-for-user-facing-copy;
no peer-reviewed quantification of crossfeed's bass-summing tonal effect exists.

### P1 · Land assets, probe live bounds

Move P0 output into `docs/eq-assistant/`. Probe the live daemon's `/matrix` form for
the real `post_bauer_frequency` / `post_bauer_level` min/max/step. Read-only, no
idle gate required.

The P0 assets were written against the earlier guardrail model and still carry
it: `PRIMER.md`'s guardrail table and `vocabulary.json`'s `_meta.clamps` /
`_meta.eq_emission_rules` list Q clamps, shelf-Q conventions and band budgets as
enforced limits. Under D2a those are prompt guidance. Reconcile them as part of
this move rather than editing them twice — they are not in the repo yet.

**Also lands here: the filter axis layer** (D20, F10). Read manual §4.6 properly —
the greps behind F10 established *where* the data lives, not what to say about
it — and extend `hqptuner/data/filters.json`'s existing `guidance` block with
axes keyed by dimension rather than by filter:

| axis | carries |
|---|---|
| `length` | tradeoff (frequency-domain accuracy vs time-domain compactness), symptoms pointing shorter, symptoms pointing longer, mechanism, `contested` |
| `phase` | linear / intermediate / minimum — pre-ringing vs group delay, mechanism, `contested` |
| `apodizing` | already a per-filter field; the axis entry says what the choice is *for*, per the existing `guidance.apodizing` note |

Plus two things the axes alone do not supply:

- **One axis at a time.** A suggestion holds family and phase fixed and moves
  length, or vice versa. Moving several at once makes the A/B unattributable.
- **Negative rules** — the symptoms that are *not* filter symptoms. Midrange
  tonality, nasality and boom belong to EQ; filter axes plausibly touch transient
  character, top-octave texture, spatial diffuseness and "digital" hardness.
  Without this the model reaches for a filter whenever it cannot fix something.

Effect sizes go in honestly: the mechanisms are real, the audibility is small and
contested near Nyquist, and `contested` says so. Same standard as `SOURCES.md`'s
known-gaps section.

**Depends:** P0.
**Accept:** probed bounds recorded in `PRIMER.md`; any divergence from libbs2b's
300–2000 / 1.0–15.0 flagged here; validator bound-source ruled per D6; the
assets' guardrail framing matches D2a, with anything demoted to guidance stated
as guidance rather than as a limit; `filters.json` carries the axis layer with a
`contested` note on every axis and an explicit negative-rules list, and every
mechanism claim in it cites manual §4.6 or an entry already in `SOURCES.md`.

### P2 · Backend skeleton — env gate, model list, ledger

`hqptuner/ai/config.py`: token, base-URL, and default-model env variables.
Feature-enabled flag rides `/api/metadata`; the token never leaves the process.
`GET /api/ai/models` proxies the endpoint's model list with a configured
fallback. `hqptuner/ai/ledger.py` persists to `state/` (already a compose
volume): turn id, timestamp, complaint, model, prompt version, validated answer,
resulting diff, status (`staged` / `applied` / `discarded` / `excluded`), **the
pre-turn chain checkpoint** (D14), the metric panel snapshot, and **references to
any uploads the turn drew on** (D21).

Uploads themselves live under `state/` beside the ledger, stored once and
referenced by id, so export and checkpoints stay coherent and a file used across
six turns is not copied six times. `DELETE /api/ai/session/upload/{id}` drops one
from context — **pruning must reach uploads separately from turns** (D21), since
an upload is the highest-volume path into the context window and amnesia that
cannot drop it only appears to work.

`hqptuner/ai/session.py` — the lifecycle operations (§1):

| route | effect |
|---|---|
| `POST /api/ai/session/rewind` `{to_turn}` | stages that turn's checkpoint; ledger untouched (D12) |
| `POST /api/ai/session/prune` `{from_turn}` or `{turn_ids}` | marks turns `excluded`; chain untouched (D13) |
| `POST /api/ai/session/reset` | both — stages the session-start checkpoint, excludes every turn |
| `DELETE /api/ai/session/metric/{name}` | drops a coined metric from the panel |
| `PUT /api/ai/session/metric/{name}` | redefines it and **recomputes its whole series** over the stored checkpoints |

Turn 0 is written at session start so "revert to before any of this" is a rewind
like any other, not a special case. Discard keeps its existing hook off
`POST /api/discard`.

**Depends:** none.
**Accept:** token unset → `/api/metadata` reports disabled and every `/api/ai/*`
route 404s; token set → model list served; ledger survives a process restart; no
browser-served payload contains the token; Discard marks turns rather than
removing them; a rewind stages and does not apply (the daemon is untouched until
Apply); a prune leaves the chain byte-identical; an excluded turn is absent from
assembled context and present in the export with its flag; a redefined metric's
series is recomputed across every checkpoint rather than left discontinuous; a
prune that removes the origin turn of a coined metric also removes that metric
from the panel, or amnesia silently fails; an upload survives a process restart,
is stored once however many turns reference it, and pruning one removes it from
assembled context while leaving it in the export flagged — exactly what D13
requires of turns.

### P2b · Response-evaluation tool — the loop's one instrument

The tool that makes a turn possible (F8, D7). `hqptuner/ai/dsp.py` — an RBJ
biquad chain-magnitude implementation, plus `hqptuner/ai/evaluate.py` exposing:

```
evaluate_chain(base_bands[], candidate_changes[], at_frequencies[], reference_curve?)
    -> { hz: net_db }, band averages, spread, deviation from reference
```

Pure computation: no daemon contact, no staging, no side effects. Callable many
times per turn.

`reference_curve` is the optional hook for an uploaded measurement or target
(D21). It is passed **by id and sampled**, never inlined — a measurement is
hundreds of points and pasting it into the prompt would evict the ledger tail.
With one present, the tool also reports deviation from it, which is what turns
"too boomy" into "your measurement shows +6 dB at 90 Hz".

**The second tool is the solver** (F9, D17), in `hqptuner/ai/fit.py`:

```
fit_chain(target_response, n_bands, band_types[], constraints)
    -> bands[], residual_db_rms, worst_error_hz
```

`target_response` accepts an uploaded curve by id as well as a computed one
(D21) — which is what makes "generate EQ from my own measurement against this
target" the same code path as "simplify these twelve bands".

Also pure computation, and it composes with the first: `fit_chain` proposes,
`evaluate_chain` verifies, the residual is reported to the user. Nelder-Mead in
pure Python — **no numeric dependency**, per F9's verified dependency state.
Both `residual_db_rms` and `worst_error_hz` are returned because an RMS figure
alone hides a single bad octave, and a simplification that averages well while
wrecking one region is the exact failure worth catching.

**`lib/dsp.js` is the reference and Python follows it** (D10). Ship
`docs/eq-assistant/dsp-reference.json` — a fixture of chains × frequencies × expected
dB, **generated from the JS implementation** — and assert the Python port against
it in the offline suite. The JS side is already auto-tested (`tests/js/dsp.test.js`
covers `lib/dsp.js`); the fixture is what makes cross-language drift detectable and
gives both suites the same values to bind to.

**A daemon oracle exists and should anchor the fixture** (`docs/matrix-spec.md`
probe round 3, 2026-07-22). `POST /matrix/plot` evaluates an arbitrary submitted
chain with the daemon's own DSP and writes `plot magnitude value range: min,max`
to the journal — no writes, no reload, nothing staged. It confirmed the RBJ
coefficients and `q`-as-Q at 0.019 dB RMS. So the fixture's expected values can be
cross-checked against HQPlayer itself rather than only against our own JS, which
is what "the plots are what the user has been trusting" (D10) actually requires.
Limits: min/max only (no curve), and a fixed ~96–99 kHz evaluation rate, so it
grounds coefficients but not source-rate warping.

Named-band arithmetic (`mud_200_400`, `oomph_80_160`, `v_db`) is expressed as
data so a model-coined metric (D9) is stored and replayed rather than recomputed
from prose.

**The loop is capped** (D15). A per-turn ceiling on `evaluate_chain` calls, with
the turn aborting on a stock message rather than running away. A turn that cannot
converge inside the cap is itself worth surfacing — it usually means the
complaint was ambiguous and should have been a `clarify`. The cap is
configuration, not a constant, and P5 reports observed iteration counts (which is
how the ceiling gets set from data rather than guessed).

**Depends:** P2.
**Accept:** Python matches the JS fixture within 0.01 dB across every case; a
`fit_chain` over a known chain reproduces it to a residual near zero, and a fit
constrained below the band count needed reports an honestly large
`worst_error_hz` rather than a flattering RMS;
evaluating a candidate leaves no staged state and touches no daemon; a
model-coined metric definition round-trips through storage and reproduces its
value; band averages and spread match hand-computed values for a known chain; a
loop exceeding the cap aborts with the stock message and stages nothing.

### P3 · Prompt assets, versioned as a unit

`docs/eq-assistant/prompt/`: `system.md`, `vocabulary.json` (from P0),
`fewshot.json`, `ASSEMBLY.md` (concatenation order, token budget, ledger
truncation rule), `VERSION`. The version stamps into every ledger entry.

6–10 few-shot complaint→diff pairs. **Draw them from
`docs/eq-assistant/auteur-classic-tuning.json` (F7) wherever it covers the case** —
real complaints in the user's own words beat invented ones, and that file already
supplies amend, append, multi-band, back-off, and two clarify examples. Invent
only what it lacks: the spatial/crossfeed cases and the off-topic deflection.

The set must include: a ledger-referencing "back off" turn, a compound
trade-off, a spatial complaint resolving to a crossfeed change, a mixed
tonal+spatial turn, an off-topic deflection, and **one clarify example of each of
the three modes** (§1) — deflection, low-confidence inference, and magnitude
proposal. At least one pair must demonstrate **amending an existing band** rather
than appending, and one must demonstrate the reverse — appending because the
nearest band is a narrow measurement correction that would be wrong to repurpose
(F3). At least one must change a band's **Q** rather than only its gain (F7).

**Chain context is part of the assembled prompt.** Per F7 the model reasons over
the summed response, not a band list, so `ASSEMBLY.md` must specify that each
turn carries the current chain *and* its computed summed magnitude response
(sampled on the same log grid the plots use), alongside the bounded ledger tail
**and the standing metric panel with its definitions** (D9). Getting this wrong
makes interaction effects invisible to the model and it will stack overlapping
bands.

**The prompt must teach the loop, not just the schema** (F8, D7). Four things
the model will not infer from a tool signature:

- **Measure before proposing, and measure candidates before choosing.** The tool
  is cheap; guessing is not. A diff with no `evaluate_chain` call behind it is
  the failure mode this prompt exists to prevent.
- **Evaluate at musical frequencies.** Note fundamentals for the instruments the
  complaint names — E1/E2/A2/D3 for bass and power chords, and so on — not a
  uniform log grid. "E2 is fine, A2 is not" is what explains a symptom; "there is
  a trough at 168 Hz" is not.
- **Coin a metric when a complaint deserves one, then keep reporting it.** If the
  user names a quality that band arithmetic can capture — V-shape, mud, oomph —
  define it, name it, and carry it forward as a standing check (D9).
- **Prefer additive fills to clawing back by-ear decisions.** Values the user
  approved by listening in earlier turns are settled; reaching a target by
  filling a hole beats revising an accepted level. The model adopted this rule on
  its own (F8); state it so it does not have to.

**Ripple and consistency complaints need their own vocabulary category.** "Half
the time perfect, half the time slightly too quiet" is not a tonal descriptor —
it names an *inconsistency*, and the fix is flattening rather than shifting.
`vocabulary.json` is currently term → region → direction and cannot express it.
Add a third category alongside `tonal` and `spatial`: symptom → net-curve
property → structural fix, with ripple/register-dependence as the first entries.

**Product-knowledge rule.** A complaint may name a headphone rather than a
quality ("the midrange magic the Auteur Classic is known for"). Reaching a diff
then requires recalling that specific product, and wrong recall produces
confidently wrong EQ the user has no way to check — the failure is invisible,
unlike a misread descriptor. The prompt must instruct: when the target is derived
from a named product rather than a descriptor, and confidence in that recall is
low, emit `clarify` asking what the user is hearing, not a guessed diff.

**Depends:** P0, P1.
**Accept:** assembly reproducible from `ASSEMBLY.md` alone; every guardrail
number in the system prompt matches P4's validator constants, asserted by a test
rather than by review; all six required few-shot categories present, plus the
amend-an-existing-band demonstration; assembled prompt within the stated token
budget.

### P4 · Validator and diff schema — the enforcing layer

`hqptuner/ai/schema.py`, `hqptuner/ai/validate.py`. Validates the **final answer**
only (D7); intermediate tool calls are unvalidated because they cannot reach the
user and cannot stage anything.

Per D2a the validator enforces three classes and nothing else. Anything not
listed here is prompt guidance, applied by judgment and corrected by the user.

**Validity** — the request must be something the engine and form accept:

| guard | value |
|---|---|
| answer shape | `outcome` XOR `clarify` (§1); no third branch, no extra top-level keys |
| `outcome` required fields | `diagnosis`, `changes`, `metrics` — a change with no diagnosis and no metric panel is rejected |
| `diagnosis` | `method`, `finding`, `explains_symptom`, `measured`; every prose field must sit beside the numbers it describes (D8) |
| `metrics` | reports the **whole** standing panel, not only the targeted metric (D9); a name absent from the panel it was handed is rejected |
| `side_effect` | optional, but if present must carry `metric`, `delta`, `judgment`, `remedy` — a flagged side effect with no remedy is rejected |
| `alternatives_rejected` | optional; each entry needs its measured figure and a reason |
| crossfeed frequency / level | live `/matrix` form bounds (D6) |
| compensation strength | 0–150 % |
| field types | numeric fields parse as numbers; `type` is one of `peak`/`lshelf`/`hshelf` |
| `recommends` | optional; each entry needs `setting`, `current`, `suggested`, `reason`, `basis`, `confidence`. **Every name in `suggested` must be present in the live engine enumeration** (D19, architecture §2) — an unknown name is rejected, never rendered |
| `variants` | optional; each needs `label`, `changes`, `measured`, `tradeoff`. A single-entry `variants` is rejected — one option is not a fork |
| forbidden targets | any enable/disable; the compensation block's internal structure; `matrix_enabled`. **`recommends` is advisory and can never stage**, so a `recommends` entry naming an in-surface parameter is rejected — that is a `changes` entry pretending to be advice |

Prose fields are length-bounded but not content-inspected. The anchoring rule
(D8) is enforced **structurally** — prose may only appear as a field of an object
that also carries numbers — never by trying to judge what the prose says.

**Correctness** — derived by the client, never emitted by the model. The model's
response is intent only; the staged diff is a superset carrying these
consequences. A model must not guess shelf coefficients or a preamp figure —
both are exact calculations the client can do and a guess would either fail the
app's structural staleness check or clip.

| derived | rule |
|---|---|
| headroom | on any net positive gain, recompute row gain so the **whole** chain's max magnitude ≤ 0 dBFS |
| compensation | a crossfeed change emits a rebuilt block at preserved strength (D3) |

**Policy** — one item:

| guard | value |
|---|---|
| EQ gain delta, per turn | ±6 dB (D1) |

**Depends:** P1, P2b, P3.
**Accept:** fake OpenAI-compatible endpoint over real HTTP, speaking a tool loop
(the fake must be able to answer an `evaluate_chain` call and then return a final
answer, or the loop path is untested); each enforced item carries a rejection
test and a boundary-accept test, one assertion each; an answer carrying both
branches is rejected; one carrying neither is rejected; an unknown top-level key
is rejected; an `outcome` missing its metric panel is rejected; a `side_effect`
without a `remedy` is rejected; a model answer that *emits* a derived value (a
compensation block or a preamp figure) is rejected as out of contract; mutation
check — disabling each check fails its own test.

**No test asserts a taste judgment** — Q choice, band selection, amend-vs-append,
and whether the diagnosis is *correct* are unenforced by design and are measured
in P5's eval instead. The validator checks that a diagnosis is present and
anchored, never that it is right.

Derivation itself is tested in P6, where the client owns it: a crossfeed change
produces a rebuilt block, a positive gain produces a recomputed row gain.

### P5 · Eval harness and model gate

`docs/eq-assistant/eval/cases.json` — 12+ cases spanning tonal, spatial, mixed,
clarify, off-topic, and ledger-referencing, with expected-region and
parameter-direction pass criteria. `scripts/eval_tuner.py`, CI-runnable against a
configured endpoint. The offline suite tests the runner's scoring, not the model.

**Seed the set from `docs/eq-assistant/auteur-classic-tuning.json` (F7).** Its nine
turns are real complaints with known-good outcomes, so they convert to eval cases
directly; the invented cases fill the gaps it does not cover (spatial, off-topic,
tilt direction).

Four cases are mandatory and adversarial: **the tilt-direction case** (per F2a, a
model's priors supply the wrong answer); a **band-suitability pair** — one where
amending an existing band is right, one where the nearest band is a narrow
measurement correction and appending is right; a **low-confidence product
inference**, where the pass condition is `clarify`, not a guessed diff (P3); and
an **over-wide band case** modelled on F7 turn 2, where the fault is a Q so low
the band eats a neighbouring region and the fix is to narrow it — a model that
only reaches for gain fails.

A fifth is mandatory under D19: a **filter-recommendation case**, adversarial in
two directions. The model must not invent an enumeration name (pass condition:
every `suggested` value appears in the live enum), and it must not assert
subjective reputation as fact (pass condition: `basis: "mechanism"` with a
documented property behind it, or the claim is tagged and de-emphasised). A
sixth, its negative: **a midrange tonality complaint must not produce a filter
recommendation** — per D20's negative rules, that symptom is EQ's, and reaching
for a filter there is a confident non-answer.

**Q is a scored dimension, not a clamp** (F7, D2a). The runner scores whether a
turn that needed a Q change made one, and whether Q choices land in a sane range
for the move — measured, never enforced.

#### Scoring a loop, not a completion

A tool-using turn (D7) fails in ways a completion cannot, and the outcome alone
does not reveal them — a model can reach a defensible diff by luck without ever
measuring. So the runner scores **process alongside outcome**, using the tool
call log:

| dimension | pass condition |
|---|---|
| measured before proposing | at least one `evaluate_chain` call precedes the answer |
| candidates compared | more than one candidate evaluated when the complaint admits several fixes |
| diagnosis matches measurement | the `finding` is consistent with what the tool actually returned — checked numerically, not by reading the prose |
| panel reported | the answer carries the whole standing metric panel (D9) |
| side effects caught | a change that moves a standing metric past a threshold declares it, with a remedy |
| variants used honestly | `variants` appear where the fork is genuinely taste-dependent and are **absent** where measurement decides — offering them to look thorough is a fail, not diligence (D18) |
| iteration cost | tool calls per turn, reported not gated — it is the honest cost signal for the model comparison |

The last one matters for the gate: a weaker model may reach the same answer with
three times the iterations, and that is a real difference in cost and latency
that a pass/fail score hides.

**Regression corpus.** `auteur-classic-tuning.json` doubles as one: replay each
turn from its recorded starting state and compare against the recorded outcome.
Not an exact-match assertion — a different band that lands the same measured
result is a pass — which is why the recorded `measured` / `selected_*` figures
matter more than the recorded band values.

#### Complexity tiers — the source of the user-guidance examples

Every case carries a **tier**, and the tiers are what the card's example
complaints are drawn from. They differ by what the request demands, not by
length:

| tier | demands | example |
|---|---|---|
| 1 | one vocabulary hit, one region, one band — a lookup | "slightly too shouty" |
| 2 | several sources whose problem regions differ but whose descriptors overlap; the work is separating them rather than stacking cuts in one place | "male and female vocals muddy, acoustic guitars too warm/blurry" |
| 3 | no vocabulary path; requires recalling a specific product and inferring a target from its reputation | "missing the midrange magic the Auteur Classic is known for" |

**Tiers are derived from eval results, never asserted.** The gate scores each
model against each tier; the guidance section then advertises only what that
model actually passed. An example shown to the user is therefore a verified
example by construction, and there is no second set of copy to keep in sync with
the eval.

Tier 3 is the one that can fail invisibly — see P3's product-knowledge rule. A
model that cannot reach a tier-3 target should score a pass by emitting
`clarify`, and the runner scores it that way.

**Run the gate: Haiku-class against a stronger model, tonal and spatial cases
scored separately, and per tier.** Spatial is the likelier failure mode — it
depends on the crossfeed parameter mapping, the least-represented material in any
model's pretraining.

**Depends:** P2, P3, P4.
**Accept:** the runner scores both classes over the full set; per-category **and
per-tier** pass rates reported separately; **the default-model decision is
recorded here with the numbers behind it**, not asserted; the per-model tier
ceiling that P7's guidance copy consumes is emitted by the runner, not written by
hand. If Haiku-class fails the spatial cases, the fallback is a stronger default
with Haiku selectable — never a silent lowering of the eval bar.

### P6 · Client — band resolution, compile, stage

`static/lib/aiseg.js`: resolve a target region to an existing band (nearest
centre within half an octave) or decide an append is warranted; apply amendments;
headroom recompute via `chainResponse` across the whole chain. Diff application
routes through `stagePipelines` / `stageBlock` / `edit` — the existing functions,
per F4. A crossfeed change triggers the in-turn compensation rebuild per D3.

Band resolution is thinner than the original sketch: the model now resolves its
own targets through the tool (D7), so the client's job is turning a `match`
(`{type, f_hz}`) into a stage index, applying the change, and persisting the
answer's metric panel into the ledger series (D9) — not deciding which band to
touch.

**Depends:** P2b, P4, P5.
**Accept:** a `match` resolves to exactly one stage, or the change is refused
rather than applied to a guess; band count never decreases **except under a
`replace_segment`, where it is the point** (D17) — outside that change class the
criterion stands unchanged; a `replace_segment` stages atomically, so a partial
application can never leave the chain with the old bands removed and the new ones
absent; a crossfeed change
leaves the compensation block non-stale (`msRecognize().stale === false`) with
`sFraction` preserved; applying an answer appends every panel metric to its
series; Discard restores the pre-turn chain exactly **and** rolls the series back
by one entry.

Every criterion here is deterministic and needs no model in the loop. Chain
*quality* is deliberately not asserted at this phase — it is measured in P5. Any
numeric proxy for "readable" (opposed gains in adjacent bands, band density, and
so on) fails on perfectly legitimate curves: AutoEq's own presets routinely place
opposed gains a fraction of an octave apart, and the real session's fix for a
ripple complaint was to *add* a band overlapping four existing ones.

### P7 · The card

`static/components/AiTuner.js`, bottom of the DSP tab, rendering only when the
env gate reports enabled. Single text input, model dropdown, session history.
The RESPONSE overlay reflects the cumulative staged result — the in-session
feedback loop.

**A turn renders as four parts**, not one diff line (F8, D8) — plus a fifth when
the turn carries `recommends`:

1. **Diagnosis** — `explains_symptom` beside the measured figures it describes.
   This is the part that makes a change trustworthy rather than magic, and it is
   why the prose rule was loosened.
2. **Changes** — the staged diff, as now. When the turn carries `variants`
   (D18), this part is a **picker** instead: each candidate with its label,
   measured figures and one-line tradeoff, the staged one marked. Picking a
   sibling re-stages and the pending bar re-counts; nothing reaches the daemon
   until Apply. Unpicked siblings stay selectable until the turn is applied or
   discarded. A `replace_segment` (D17) renders here as a before/after curve
   overlay with its residual, not as a list of removed and added bands.
3. **Alternatives rejected** — a small table of candidates with their measured
   figures and the reason each lost. Structured and numeric, so it renders
   safely; it is what lets the user judge a change instead of taking it on faith.
   Collapsed by default.
4. **Metric panel** — every standing metric with before/after and its delta, the
   targeted one emphasised. A `side_effect` renders here, with its pre-named
   remedy, since that is the surface where a regression becomes visible.

5. **Recommendations** (D19) — and these must be **visually unmistakable from
   staged changes**. A recommendation that reads as staged is a trap: the user
   presses Apply and the filter does not move. It has to read as *this one is
   yours*. Since HQPTuner owns the control being recommended, each entry carries
   a **link to that control** — navigate, never stage and never toggle, which
   keeps the enable/disable boundary intact while making the advice actionable.
   `basis` and `confidence` render with the claim, so a mechanism-grounded
   suggestion and a low-confidence one cannot be mistaken for each other.

The panel persists across turns as its own strip, so drift over a long session is
readable at a glance rather than by scrubbing history. Each metric carries a
remove and a redefine affordance; redefining recomputes the series (P2) rather
than starting a new one.

**Lifecycle controls, and the history as a context inspector.** The session
history is where §1's four operations surface:

- **Per turn** — "rewind to before this" stages that turn's checkpoint. It is a
  staged change like any other: the pending bar counts it, Discard undoes it, and
  nothing reaches the daemon until Apply (D12).
- **Session level** — *Forget context* (amnesia) and *Start over* (reset). Both
  name what they keep, not just what they destroy: "keep the sound, forget how we
  got here" is the whole point of the first and it has to read that way, or
  nobody will use it and they will reset instead.
- **Excluded turns stay visible**, struck through rather than removed (D13), with
  an un-exclude. Vanishing them would hide the thing the user just did.

The history therefore doubles as a **context inspector**: it must show which
turns are actually in the model's window, since the ledger is sent bounded. Turns
that have fallen out of the window naturally and turns pruned deliberately look
different but are both marked. This is the surface that answers "why does it keep
making that mistake" — the answer is usually visible here.

**Prose is rendered only from a field that sits beside its numbers** (D8). There
is no code path that renders a model string on its own — a diagnosis without its
`measured` block does not render, it fails validation upstream in P4.

**Guidance examples.** An empty text box is the worst affordance for a feature
whose whole difficulty is knowing what vocabulary lands, so the card shows
example complaints drawn from P5's tiered eval cases. They are **keyed to the
selected model** — changing the dropdown changes the examples to that model's
verified tier ceiling — and **clickable to populate the input**. Copy comes from
the runner's emitted per-model tier data (P5), never hand-written, so the card
cannot advertise a capability the eval did not demonstrate.

**Depends:** P6.
**Accept:** token unset → card absent from the DOM entirely, zero footprint;
selecting a different model changes the shown examples; every shown example
appears in `cases.json` at a tier that model passed; clicking one populates the
input; a turn renders all four parts with alternatives collapsed by default; a turn
carrying `variants` renders a picker in which exactly one sibling is staged at a
time, picking another re-stages rather than applies, the pending bar re-counts,
and the unpicked siblings remain selectable until the turn is applied or
discarded; a `replace_segment` renders as a before/after curve overlay carrying
its residual rather than as a band-by-band list; a `recommends` entry renders
visually distinct from staged changes, is **not** counted by the pending bar, and
carries a link that navigates to the named control rather than changing it; the
metric panel shows before/after for every standing metric, not only the targeted
one; a `side_effect` renders with its remedy; a per-turn rewind stages and counts
in the pending bar rather than applying; an excluded turn renders struck through
with an un-exclude rather than disappearing; the history distinguishes turns
inside the model's context window from those outside it; **no code path renders a model
string that is not a field of an object carrying numbers** (D8); the binding
design-system criteria at 1280 (nothing clips or overlaps, both tracks filled or
deliberately spanned, right edge flush with the container, no unnameable
whitespace); a two-column split carries its rule on the card centre line;
screenshots and measured pixel numbers in the hand-back.

### P8 · Export, docs, packaging

`GET /api/ai/session/export` → structured ledger JSON, plus an export button.
Uploads export **by reference and metadata** — id, filename, kind, which turns
used it, pruned-or-not — never as inlined file bodies, which would make the
export unbounded and would ship the user's material anywhere the export goes.
`POST /api/ai/session/upload` is the inbound path (D21): size-capped, bounded
parse, never `eval`, and no trust placed in the supplied filename.
Document the voluntary community submission path. **No automatic collection of
anything**, stated explicitly in the README. `compose.yaml` and README env
reference.

**Depends:** P7.
**Accept:** export round-trips through a JSON parse; README documents every env
variable and the submission path; a fresh-machine run with the variables unset
behaves exactly as today.
