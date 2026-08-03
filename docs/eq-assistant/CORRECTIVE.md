# CORRECTIVE.md — measurement-driven correction, as distinct from voicing

Every other document in this base calibrates for **voicing**: a plain-language complaint, translated through `vocabulary.json`, nudging a chain that an AutoEq baseline already corrected (`vocabulary.json` `_meta.use_case` says so verbatim). This document covers the other mode — the user hands over a **measurement**, names a **yardstick**, and asks for the error between them to be driven toward zero. The two modes share tools and share nothing else: different magnitude source, different Q discipline, different definition of done.

Provenance note: the workflow here was not designed on paper first. It was extracted from two real sessions — `sessions/ori/ori3-tuning.json` (ZMF Ori 3.0, factory 5128 measurement, DF target) and `sessions/blackwood/blackwood-tuning.json` (ZMF Blackwood, user's own REW measurement, flat-on-rig target) — where the doctrine was beaten into shape turn by turn. Claims sourced only to those ledgers are tagged `[session]`; everything else cites the standing corpus. The mechanics of every eqlab job mentioned live in `scripts/eqlab/README.md`; this document carries when and why, never how.

## 1. Two modes, and how to tell which one you are in

| | Voicing | Corrective |
|---|---|---|
| Input | complaint in listening terms | measurement file + yardstick |
| Magnitude source | `typical_gain_db` (±2–3 dB starting points) | **the error curve** — whatever it says, that is the size |
| Q discipline | 0.5–1.6 preferred, low-Q bias (`PSYCHOACOUSTICS.md` §1) | **whatever the measured feature has** — a Q 3 resonance gets a Q 3 cut |
| Band placement | vocabulary region + amend-before-append | **measured feature centres** — the error curve places bands, not the vocabulary |
| Done when | user stops complaining | residual against target is small *and* the user accepts it by ear |
| ±6 dB/turn clamp | policy (D1) | still policy — a large correction lands across turns, or as a `replace_segment`-shaped full fit the user reviews as a curve overlay |

**The mode is declared by the input, not inferred from the words.** A measurement on the table plus "correct this" is corrective; reaching for `typical_gain_db` in that situation is the defining failure of the mode confusion — it produced the Blackwood session's rejected single-peak "corrections" `[session]`. Conversely a bare complaint with no measurement is voicing, and no amount of corrective ambition changes that: there is nothing to fit to.

The two modes compose in one session. Correct first, voice on top: once the residual is flat, later complaints are handled the voicing way *against the corrected chain*, and the correction bands are treated exactly like AutoEq bands — measurement-placed, not casually amended to taste (`PRIMER.md`, "AutoEq bands are not interchangeable").

## 2. The yardstick — choosing what "correct" means

There is no universal target. There is a ladder, and every rung requires the target and the measurement to be **rig-compatible** — a target defined on one rig family pasted onto another rig's measurement produces a fictional error curve.

1. **Same-rig-family reference curve.** A 5128 measurement gets a 5128-referenced target (`5128-df-target.txt` exists in this directory for exactly that); a 711-family measurement gets a 711-family target. **Harman is 711-family-referenced — do not translate it onto 5128 data** `[session, ori turn 1]`. The rig-trust material behind this is `TRANSDUCERS.md` §4.
2. **Flat-on-this-rig, backed by cited testimony.** Legal when the rig is nonstandard but its behaviour is attested — the Blackwood rig read HD580 and HE600 flat through bass/mids on the user's cited evidence, so flat-on-rig served as the target there, with treble held at reduced confidence until a same-rig reference file supplies the rig's treble transfer `[session]`. Confidence tracks evidence: the Blackwood ledger's `yardstick.pending_upgrade` records exactly which magnitudes are provisional and why, and that is the pattern — name what you are waiting on rather than pretending the target is settled.
3. **No valid pairing** — `clarify`. Ask for the rig, or for a compatible target, before fitting anything. A fit against an incompatible target is worse than no fit, because it looks like an answer.

**Tilt the target; do not fit raw DF.** A raw diffuse-field curve is an anatomy transfer, not a preference target — Olive 2025 found **no listener cluster accepted the raw 5128 DF target**, and the mean preferred tilt is −1 dB/octave (`SOURCES.md` §2.2d). The Ori session applied exactly that: 5128 DF, −1 dB/oct pivoted at 1 kHz `[session]`. The −1 dB/oct figure is a convention with spread around it (`SOURCES.md` head note), so it is a starting point the user adjusts, not a constant.

**Deviate from the target deliberately and file the deviation.** A target is not a contract. The Ori session declined to fill a 5 dB presence shortfall on preference-research grounds, recorded it in the turn record as a filed deviation, and the later "sounds shouty" complaint was resolved by *re-reading the filed deviation*, not by re-measuring `[session]`. An undocumented deviation is indistinguishable from an error two turns later.

## 3. Reading the measurement

Accepted shapes are what eqlab's `fr_text` parser eats: whitespace-separated columns, first two read as Hz and dB, headers and comments skipped — which covers REW text exports (Hz/SPL/phase) and bare two-column files alike. REW's native `.mdat` is unparsed Java serialization; ask for a text export. Know what the file *is* before using it: raw versus compensated SPL, which channel, what resolution — the ledger's `measurement` block records all of it (`RECORD.md`).

**The error curve is a `difference` target: `target − measurement`**, aligned at a mid-band anchor (1 kHz, or mean-align) so the fit chases shape rather than absolute level — absolute level belongs to the preamp (`FILTER-MATH.md` §6). This one construction is the entire bridge from measurement to fit: every metric, objective and constraint then reads from it.

Clean before trusting. Despike (median/MAD) removes isolated dropouts; a densely contaminated stretch — where most local points are bad — defeats any median window, and gets an `override` (interpolate across it) instead, which also removes it from every score so it cannot bias neighbouring bands `[session, ori]`. An overridden region is a region you have chosen not to know about; say so in the record.

## 4. Smoothing is a decision, made more than once

Smoothing width sets what the fit can see, and the corpus's only prior word on it is one incidental quote (`TRANSDUCERS.md` §4). The session-derived doctrine `[session, ori]`:

- **1/3 octave** for overall shape and the first-pass fit. It smears: the Ori's 1/3-oct pass read 9–12 kHz as approximately on-target.
- **1/6 octave** to find structure. The same region at 1/6 oct exposed an untreated +2.9 dB peak at 11.5 kHz, and showed the 8 kHz band sitting ~300 Hz off the measured centre.
- **1/12 octave (or finer)** to verify a placed band against the feature it claims to treat, and to check what survived a correction.

The rule is **re-score at finer smoothing before declaring a region done**. A residual that is flat at 1/3 oct and lumpy at 1/6 is not done — the treble-forest failure mode (fitting coupler grass tightly) is avoided by the reliability ceiling in §5 and by matching Q to the *smoothed* feature, not by never looking closely.

## 5. The reliability ceiling

`TRANSDUCERS.md` §4 sets the trust ceiling — 711-family couplers qualified to ~8 kHz, ~10 dB uncertainty above 10 kHz, features that move with placement — and `PSYCHOACOUSTICS.md` §5 sets the floor (reseat σ ≈ 2 dB, sub-2 dB moves never narrated as precise). For fitting, that translates to:

- Below ~8 kHz: fit magnitudes as measured.
- Above: features are real but their **magnitudes and exact centres are indicative**. Correct them at moderated depth and moderated Q, expect the listening pass to trim them, and never quote them at below-8 kHz precision. The Blackwood air-band bands were staged as audition variants precisely because the rig's treble transfer was unconfirmed `[session]`.
- A repeatable rig beats a qualified rig you do not have: repeatability (same answer across reseats/pad-shifts) is what licenses correcting a treble feature at all; qualification is what licenses trusting its printed magnitude.

## 6. What is not correctable

Minimum-phase inversion is well-posed — the peaking transfer function and its inverse are both stable and causal (`FILTER-MATH.md` §2) — **except where the response approaches zero**: the minimum-phase decomposition requires no zeros on the unit circle (`PHASE.md` §1), and an acoustic null is the physical version of that exception. The corpus states both halves without joining them; joined: **never fill a null.** Boosting into a cancellation adds level and headroom cost without restoring the notch (`TRANSDUCERS.md` §2.1). Operationally: a deep narrow trough that deepens as smoothing gets finer is a null — skip it and record the skip, as the Ori session did with its 12 kHz canyon `[session]`.

Also outside the fit:

- **Rig-anatomy features.** The coupler's own resonances and the target's anatomy transfer are in *both* curves when the pairing is rig-compatible, and cancel in the difference. If a suspiciously canonical feature (the ~3 kHz apex, the 711 half-wave spike) shows up in the error curve, suspect the pairing before fitting it.
- **Ear-canal individuality.** Not a knob — tested negative (`PRIMER.md` fourth must-be-told rule, `TRANSDUCERS.md` §3.2).
- **Seal, fit and placement variance.** A feature that moves between reseats is not a stable target; correct the repeatable part (`TRANSDUCERS.md` §3.1).
- **The driver's mechanical limits.** A BA's LF corner and similar are fixed properties EQ fights, not free parameters (`TRANSDUCERS.md` §2.2).

## 7. Fitting doctrine

The fit is search plus refine against the error curve; job mechanics in `scripts/eqlab/README.md`. What the sessions established about *driving* it `[session]`:

- **Target-relative objectives, ERB-weighted where the ear is the judge.** `rmse` with `domain: "erb"` over the region under correction weights error by auditory bandwidth rather than log-frequency. Add a secondary weighted term for a second region rather than widening the primary.
- **Constraints are collateral guards.** Every region the fit is *not* meant to touch that borders one it is gets an explicit bound (bass mean within ±0.75 dB, neighbour-band collateral bounded). A fit scored only where it aims will happily wreck the neighbourhood.
- **Band budget comes from the error curve's feature count**, not from a prior. One band per resolved feature at the working smoothing; a double-humped plateau is two cuts, not one deep one — the search itself demonstrated two lighter cuts beat one by 0.42 dB at the worst spot with less collateral `[session, ori]`. A visible side peak with no band is an unserved feature and the user will find it (§8).
- **Free the centres in the refine pass.** Grid search places, continuous refinement converges; a band whose refined centre lands off the measured feature centre at finer smoothing gets moved (the Ori 8 kHz band, 7898 → 8215 Hz).
- **Read the search diagnostics, not just the winner.** `binding` names the constraint actually limiting the answer; `sensitivity` prices relaxing it. When relaxing the binding constraint buys ~0.01 dB, you are at the diminishing-returns wall — stop and say so rather than manufacturing further improvement.
- **A settled optimum sits off the search bounds.** A parameter pinned at its bound means the space was too small or the constraint is doing the work; either way the answer is not converged.
- **Preamp from the summed response** of the whole chain — the negative of the maximum of the summed magnitude, never the largest band, never the sum of boosts (`FILTER-MATH.md` §6).
- **Residual is the report, listening is the verdict.** Post-fit, re-score the corrected chain against the same target at finer smoothing and report residual per region. Then the user listens: a complaint against a near-zero residual indicts the *target realisation*, not the fit — the Ori "shouty" turn resolved as a filed target deviation plus a listening bisection on one band, no re-measurement `[session]`. Ear-versus-error disagreements resolve toward the ear, and the resolution is recorded as a target deviation so the fit stays honest.

## 8. Anti-patterns

Each of these was committed by an agent and rejected by the user in the Blackwood session `[session]`; paraphrased here, verbatim in the ledger.

1. **The single-peak "correction".** Cutting the biggest peak and stopping is not a correction profile; it is triage presented as a fit. A correction serves the region's measured structure — main features, side peaks, valleys — or names what it is deliberately leaving and why.
2. **Under-magnitude timidity.** Voicing-sized gains (±2–3 dB) applied to corrective-sized errors. The error curve sets the magnitude; a 6 dB measured excess gets a cut sized to the curve (across turns if the per-turn clamp requires), not a polite 1 dB. A "correction" whose net effect is ~0.1 dB where the error is several dB is a non-answer.
3. **Whole-spectrum refit when a region was named.** The user scoped the work; touching everything else is unrequested change and reads as ignoring the instruction. Constrain the fit to the named region and guard its borders.
4. **Glossing visible structure.** Side peaks and valleys flanking a main feature are part of the correction. If they are genuinely untreatable (null, reliability ceiling), the answer says so explicitly — silence around visible structure reads as not having looked.
5. **Vocabulary reflexes in corrective mode.** Amend-before-append, low-Q preference and `typical_gain_db` are voicing guidance. In corrective mode band placement, Q and gain all come from the measurement, and bands are appended wherever the error curve puts features.

## 9. Channel imbalance

Corrective sessions surface imbalance complaints because a fresh correction invites a hard listen. Diagnostic order `[session, blackwood]`:

1. **Chain symmetry first** — read the live matrix and check L/R rows mirror (same process strings, mirrored gains). Symmetric chain means the imbalance is external to the fit: source material, hardware, seal, or the listener (`HEARING.md` covers interaural asymmetry).
2. **Per-channel measurements are the only basis for a per-channel correction** — a right-channel-only measurement cannot justify an asymmetric fit, and the Blackwood correction was applied symmetrically for exactly that reason.
3. **Per-ear EQ is a lateralization hazard regardless** (`PHASE.md` §7): below ~1.2 kHz an asymmetric band puts interaural phase differences orders of magnitude above the ITD floor. All four change types are stereo-symmetric today; an asymmetric request is `clarify` + `recommends` (`PRIMER.md` third must-be-told rule).
