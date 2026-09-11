# FEATURE-CONTRACT.md — the web feature's contract, split out of PRIMER.md

Companion to `PRIMER.md` (the agent's domain brief), `RECORD.md` (the ledger spec), `STAGING.md` (how a change reaches the pending buffer).

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

## The response schema contract

The **final answer** must validate against a union of exactly three branches. Intermediate tool calls are not part of the union — they never reach the user, so they were never what it guarded against. **Only branch 1 may carry `changes`**; that is the invariant the whole feature rests on.

```jsonc
// branch 1 — the model acted
{
  "diagnosis":   { "method", "finding", "explains_symptom", "in_plain_terms", "measured": {...} },
  "changes":     [ /* band / crossfeed / compensation changes */ ],
  "answers":     { /* optional: same body as branch 3, mandatory basis */ },
  "alternatives_rejected": [ /* candidates with measured figures + reason */ ],
  "variants":    [ /* co-equal candidates for the user to audition */ ],  // optional
  "recommends":  [ /* advisory: settings the model cannot touch */ ],     // optional
  "metrics":     { "<name>": { "before": <n>, "after": <n> } },
  "side_effect": { "metric", "delta", "judgment", "remedy" }   // optional
}

// branch 2 — the model needs an answer before acting
{ "clarify": "<one sentence>", "context": { /* optional measured values */ } }

// branch 3 — the user asked; the model answered and changed nothing
{ "discuss": { "answer": "<prose, length-bounded>",
               "measured": { /* what the tool returned */ },
               "basis": "measured" | "vocabulary" | "unverified",   // enum unsettled — see 2026-07-30 block
               "recommends": [ /* optional, same shape as on branch 1 */ ] } }
```

* **Exactly one branch.** Never two at once, no fourth branch, no extra top-level keys.
* **`discuss` stages nothing, structurally.** `changes` is *absent*, not an empty array, so the union stays a real XOR over the write path. **The asymmetry runs one way only** (D22): a `discuss` turn can never stage, but an acting turn *may answer* through `answers`, so a question arriving beside an actionable complaint no longer costs a turn. Answering a question and staging a change in the same turn is the expected behavior, not a violation — `discuss` alone, when the utterance also carried an actionable complaint, is the deflection-into-chat failure.
* **`diagnosis` carries two registers of one finding** (D22): `explains_symptom` technical, `in_plain_terms` plain. **The plain register is a restatement, not an extension** — it may introduce no claim, mechanism, citation or fact absent from the technical field beside it. Quote the magnitude in plain terms on every change turn; that is the point, not the risk, because it calibrates the user's ear-to-number mapping and the next complaint arrives as "another dB or so" instead of "a bit less". A trailing "how does that sound?" is prose and is fine; "shall I go ahead?" is not, because it strands the user at the Apply gate.
* **`variants` are for genuine taste forks only** (D18). Co-equal candidates the user auditions by ear, distinct from `alternatives_rejected` which is what the model discarded *with reasons*. Swapping one is a re-stage, never an apply. Offering them to look thorough is a failure, not diligence.
* **`alternatives_rejected` is optional by design** (D23). It is the strongest thing a change has to defend itself with and it renders expanded by default — but mandating it would manufacture straw candidates to fill the slot, which is the same padding `variants` is scored down for.
* **`basis` is mandatory on `discuss`, and it is rendered.** Nothing can tell whether a question was tool-answerable, so the model declares its footing instead: `basis: "measured"` requires a non-empty `measured`. **A measured answer and a recalled one must not look alike in the card** — that is the whole safety property, and it is what lets the user see which claims they can check.
* **A `discuss` turn never appends to a metric series.** The chain did not move, and a series entry with no checkpoint behind it shows fake drift and breaks metric-series recomputation, which assumes entries map 1:1 to checkpoints.
* **`discuss` turns are prunable as a class** — "forget the discussion, keep the tuning".
* **`diagnosis`, `changes` and `metrics` are all required** on branch 1, and `diagnosis` must carry `method`, `finding`, `explains_symptom`, `in_plain_terms` and `measured`. A change with no diagnosis, one missing its plain register, or one that reports only the metric it aimed at, is rejected.
* **`side_effect` needs its `remedy`.** Flagging a regression without naming the fix is rejected. The real session disclosed a `v_db` rise of +0.38 *before* applying and pre-named the remedy (+0.4 on the 750 Hz band rather than reverting) — that is the bar.
* **The anchoring rule is structural.** Prose may appear only as a field of an object that also carries numbers; `explains_symptom` sits beside `measured` and cannot wander from it. Nothing inspects what the prose *means* — the check is on shape, never on content.
* **But numeric provenance is checked** (D22, D2a). Every numeric literal in every prose field must match a value the same turn already carries in `measured`, `changes`, `metrics` or `alternatives_rejected`, modulo rounding. An unmatched literal rejects the answer wholesale. This keeps the structural character of the rule: it asks only where a number came from, never what the sentence around it means. Whether the plain register faithfully restates the technical one is semantic and stays in the eval.
* **Rejection rule:** any answer that fails validation is discarded outright. Not repaired, not partially applied, and its prose is never shown. Surface a generic failure and let the user retype.

## Uploads (D21)

The user can hand the model files — a measured frequency response, a `ParametricEQ.txt` from anywhere, a spec sheet, a review, their own notes. **All of it is accepted; `basis` carries the weight.** There is no accept/reject split by file kind. If someone uploads a file they have already decided it has value, and they know its provenance better than the model does.

The ladder, strongest to weakest: `measured` (computed this session) → `mechanism` (documented property + physical consequence) → `cited` (user-supplied file, naming file and location) → `vocabulary` → `unverified` (model recall, nothing behind it).

**`cited` outranks `unverified`.** A user-supplied writeup is attributable, re-readable and deliberately chosen; pretraining recall on niche gear is none of those. Uploading a review *improves* the epistemics over guessing from memory.

What holds regardless — mechanism, not judgment about the user:

* **Attribution is mandatory** — a claim from a file names the file, so it can be checked.
* **Retrieval, not dumping** — curves are sampled, prose is chunked and queried. A forty-page PDF in the ledger tail would evict the actual tuning turns.
* **Pruning must reach uploads**, separately from turns and exactly as it must reach metric definitions. An upload is the highest-volume path into context; amnesia that cannot drop one only appears to work.
