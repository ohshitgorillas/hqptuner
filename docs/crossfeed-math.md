# Custom crossfeed — research findings and design options

Research phase output, 2026-07-22. Grounds the question "should HQPTuner bypass HQPlayer's Bauer post-process and build its own crossfeed in matrix pipelines?" in the actual psychoacoustic and filter mathematics.

**Implemented.** This began as a findings document; the design it describes now ships as the Structural mode of the Crossfeed card. Implementation notes are marked as such. Companion reading: `docs/matrix-spec.md` (matrix wire contract, probe findings, the existing crossfeed-compensation design of record).

## Provenance

| Claim class | Status |
|---|---|
| Brown & Duda structural model (eqs. 1–5, numeric constants) | **Verified verbatim** from the paper (IEEE TSAP 6(5), 1998, pp. 476–480) |
| Woodworth/Kuhn ITD limits | **Verified** — eq. (2) in the same paper, Kuhn's ~50 % LF excess quoted there |
| bs2b parameter model | **Verified** previously against the libbs2b source; see `matrix-spec.md` |
| Matrix realizability | **Derived here** from the wire grammar, then **validated live** — 24 rows applied and read back byte-exact, see §7b |
| Numeric agreement between the structural model and bs2b's default preset | **Computed here** — see §4, worth an independent check |
| HRTF dataset licences | **Secondhand** from search summaries; each needs reading before any vendoring |
| Delay-stage resolution | **Verified** — HQPlayer manual §7.2, `s` = "delay in number of samples at source rate" |
| Daemon accepts `delay` in a process chain | **Verified live** — all three unit forms (`s`/`t`/`d`+`v`) parse and are magnitude-transparent |

---

## 1 · What crossfeed is trying to reproduce

Headphones deliver each channel to one ear only. Loudspeakers do not: each ear hears both speakers, the far one **later** and **duller**. Crossfeed synthesizes that second path. Two cues matter, and they behave differently with frequency:

- **ITD** — interaural time difference. The far ear's copy arrives later.
- **ILD / head shadow** — the far ear's copy is attenuated, increasingly so with frequency, because the head is only an acoustic obstacle once its size is comparable to the wavelength.

Below roughly 600 Hz the head is effectively transparent (no ILD) and the cue is almost purely ITD. Above a few kHz the shadow dominates. The transition is the whole design problem.

## 2 · ITD — the two limits

Brown & Duda work in **interaural-polar coordinates**: θ is measured from the interaural axis, not the median plane. θ = 0° points at the ear in question. A source at azimuth ±30° from front centre therefore sits at θ = 60° for the near ear and θ = 120° for the far ear.

The high-frequency (ray-tracing) limit, Woodworth & Schlosberg, eq. (2):

```
ΔT(θ) = −(a/c)·cos θ            for   0 ≤ |θ| < π/2
ΔT(θ) =  (a/c)·(|θ| − π/2)      for  π/2 ≤ |θ| < π
```

with `a` = head radius, `c` = speed of sound. The paper's stated constants: **a = 8.75 cm** (average adult), **c ≈ 343 m/s**, giving **a/c = 255.1 µs**.

**On c, since HQPlayer names a different one.** The manual's `delay` plugin defaults `v` to 343.956 m/s, and it is tempting to match it. Don't: `v` exists to convert `d=<metres>` into a delay, and this design emits `t=<seconds>`, so `v` is never consulted. The paper's 343 is what `a`, `α_min` and `θ_min` were fitted against on KEMAR data, and those constants travel together — mixing a different c into them is false precision, not more precision. The gap is quantified rather than waved away: 0.28 % of c is **0.7 µs** of ITD, which sits under the 22.7 µs sample floor at 44.1 kHz (§5) and is dominated roughly 37× by head-radius spread across adults (~7.5–9.5 cm, ±26 µs). Precision here is bought by exposing `a`, which §6.2 does, not by refining c.

At low frequency the delay is larger — Kuhn's result, quoted in the paper as "approximately 50 % greater than the value predicted by (2) as µ → 0", where µ = ωa/c is normalized frequency and **µ = 1 corresponds to about 624 Hz**.

For a ±30° speaker pair: the near ear (θ=60°) sees a ray delay of −127.6 µs, the far ear (θ=120°) +133.6 µs, for an **ITD of 261.1 µs**. This is the number a fixed delay line would use. The LF value is larger — see §3.

## 3 · Head shadow — Brown & Duda's single-pole/single-zero filter

Eq. (3), the head-shadow filter:

```
              1 + j·α(θ)·ω/(2ω₀)
H_HS(ω,θ) =  ─────────────────────  ,   0 ≤ α(θ) ≤ 2
                 1 + j·ω/(2ω₀)
```

with eq. (4) `ω₀ = c/a`, and the zero's position set by eq. (5):

```
α(θ) = (1 + α_min/2) + (1 − α_min/2)·cos( (θ/θ_min)·180° )
```

with **α_min = 0.1** and **θ_min = 150°**. The pole is fixed at µ = 2; only the zero moves with angle. DC gain is 1 for every θ; the high-frequency asymptote is α. So α = 2 is a +6 dB HF boost (source at the ear), α < 1 is a cut.

The filter also carries a group delay, eq. (3)'s consequence:

```
T_g = (1 − α)/(2ω₀) = ½·(a/c)·(1 − α)
```

and the paper notes this is exactly what supplies "the 50 % additional low-frequency delay observed by Kuhn". **The LF ITD excess falls out of the shadow filter — it does not need to be modelled separately.**

Evaluated for ±30°:

| | near ear (θ=60°) | far ear (θ=120°) |
|---|---|---|
| α | 1.3436 | 0.2814 |
| DC gain | 0 dB | 0 dB |
| HF gain | +2.56 dB | −11.02 dB |
| group delay T_g | −43.8 µs | +91.7 µs |

Total LF ITD = 261.1 + 91.7 + 43.8 = **396.6 µs**, i.e. **52 % above the HF value** — matching Kuhn's ~50 % independently.

Two corroborations worth noting. Bauer's original 1961 network delayed the crossfeed signal "by about 0.4 ms below 1 kHz" — the LF figure above. And ω₀/2π = 623.9 Hz is the frequency at which the head starts to shadow at all, which is why every crossfeed design in the literature places its crossover between 650 and 900 Hz.

## 4 · What bs2b actually is, and its relation to this model

HQPlayer's `bauer` post-process is libbs2b (documented — see `matrix-spec.md`). Its structure is a first-order lowpass on the cross path plus a first-order high-boost on the direct path, with a scalar normalization. **It has no delay line**, but it is not delay-free: its filters are minimum-phase, so their phase response supplies a frequency-dependent delay — larger at LF, smaller at HF, which is qualitatively the right shape. bs2b's own documentation shows this as a "time delay response" curve.

Correcting an earlier claim in this repo's discussion: bs2b does not "lack ITD"; it lacks an **explicit, independently-controllable** ITD.

**The centre tilt is physically real, not a bs2b defect.** For the ±30° case above, ignoring the delay (as bs2b does), the centre response is (α_near + α_far)/2 = 0.8125 → **−1.80 dB at HF relative to DC**. bs2b's default preset (700 Hz / 4.5 dB) has a computed centre tilt of **1.81 dB** (`lib/xfeed.js`, verified against the source). Agreement to 0.01 dB, from completely independent derivations — and bs2b's documentation states its default is "closest to the virtual speaker placement with azimuth 30 degrees".

**This reframes HQPTuner's existing compensation feature.** Crossfeed compensation does not correct an error — it trades a loudspeaker-accurate centre for a neutral one. That is a legitimate and useful choice, and it is a *tonal* choice, independent of any headphone EQ (which rides through untouched — the EQ framing was deliberately dropped in 0.4.0 and should stay dropped). What the feature's copy should not do is imply the tilt is a flaw. Worth a wording pass whatever else is decided.

## 5 · Realizability in HQPlayer's matrix — the key result

The matrix sums pipeline rows into a shared mixdown, and `gainunit=Lin` accepts negative gains (phase inversion). That makes **parallel** structures expressible, not just cascades. Applying it to eq. (3):

```
      1 + jαx                 1
H_HS = ───────  =  α + (1−α)·─────  ,   x = ω/(2ω₀)
       1 + jx               1 + jx
```

A constant plus a scaled first-order lowpass. HQPlayer's `iir:type=lp1;f=F` is exactly that lowpass, with its −3 dB corner at 2ω₀/2π = **1248 Hz**. So:

> **The Brown & Duda head-shadow filter is exactly realizable as two matrix rows — a flat row at gain α, plus an `lp1` row at gain (1−α). No fit, no approximation, no rate-bound raw biquads.**

The ITD is a `delay:t=<seconds>` stage. Manual §7.2 gives the plugin's arguments as `s` (samples **at source rate**), `t` (seconds), `d` (metres) and `v` (velocity, default 343.956 m/s) — so `t` is rate-independent as a *specification*, but the underlying primitive is sample-granular at the source rate. Resolution is therefore **22.7 µs at 44.1 kHz**, about 4 % of the 261 µs ITD, improving directly with rate.

That matters less than it looks, because **the ITD is not all in the delay line**. Per §3, the head-shadow filter's group delay supplies the low-frequency excess — 135 µs of the 397 µs total — and that comes from the IIR, which is continuous. The delay stage carries only the high-frequency ray component, and ITD sensitivity is greatest below ~1.5 kHz, precisely where the shadow filter is doing the work. So the quantized part of the cue lands where the ear cares least. If it ever proves audible at redbook rates, `iir:type=ap` gives a fractional, rate-independent delay in-band — a fallback, not something to build on spec.

### Wire shape — 8 rows, stereo

With the common delay normalized out (near ear τ = 0, far ear τ = 261 µs), `k` = global normalization, `α_n` = 1.3436, `α_f` = 0.2814:

| # | src | process | gain (Lin) | → out |
|---|---|---|---|---|
| 1 | L | *(empty)* | `α_n·k` | L |
| 2 | L | `iir:type=lp1;f=1248` | `(1−α_n)·k` | L |
| 3 | R | `delay:t=0.000261` | `α_f·k` | L |
| 4 | R | `iir:type=lp1;f=1248,delay:t=0.000261` | `(1−α_f)·k` | L |
| 5–8 | | mirror image | | R |

`k = 0.5` puts the centre at unity gain at DC. Note `(1−α_n)` is **negative** (−0.3436) — the near-ear row 2 is phase-inverted, which is what makes the near ear's mild HF *boost* come out right. That is exactly the Lin-negative capability the compensation block already relies on.

Per-ear EQ appends to all four rows feeding that ear — EQ distributes over the sum, the same trick `msCompile()` already uses.

Eight rows: the same budget the current compensation block spends, replacing a numerically-fitted correction with an exact structural model.

## 6 · The design — one topology, three controls, two ways to supply H

Earlier drafts of this document posed a series of forks: "literal loudspeaker simulation" versus "flat centre by construction", then "structural" versus "HRTF". Neither is a fork. The first pair are endpoints of one continuous parameter; the second pair are two ways of supplying the same two transfer functions into the same row structure. What follows is one design.

### 6.1 · Topology

Hold the side path at its physical value and put only the **centre** on a control:

```
G_S      = (H_n − H_f)/2                    side path — fixed, never moves
G_M(λ)   = λ·(H_n + H_f)/2 + (1 − λ)        centre path — λ = 1 literal, λ = 0 flat
```

Rows carry a coefficient per (source, output) pair, and those follow directly:

```
A = (G_M + G_S)/2 = [(λ+1)·H_n + (λ−1)·H_f]/4 + (1−λ)/2      same-side  (L → L)
B = (G_M − G_S)/2 = [(λ−1)·H_n + (λ+1)·H_f]/4 + (1−λ)/2      opposite   (R → L)
```

Substituting `H_n = α_n + (1−α_n)·P` and `H_f = D·[α_f + (1−α_f)·P]` (P = the `lp1`, D = the delay) expands each coefficient into four row types — flat, `lp1`, delayed, delayed `lp1`. Eight rows per output ear, **16 rows** for stereo:

| row | source | process | gain (Lin) |
|---|---|---|---|
| 1 | near | *(empty)* | `(λ+1)·α_n/4 + (1−λ)/2` |
| 2 | near | `lp1` | `(λ+1)·(1−α_n)/4` |
| 3 | near | `delay` | `(λ−1)·α_f/4` |
| 4 | near | `lp1, delay` | `(λ−1)·(1−α_f)/4` |
| 5 | far | *(empty)* | `(λ−1)·α_n/4 + (1−λ)/2` |
| 6 | far | `lp1` | `(λ−1)·(1−α_n)/4` |
| 7 | far | `delay` | `(λ+1)·α_f/4` |
| 8 | far | `lp1, delay` | `(λ+1)·(1−α_f)/4` |

**λ = 1** zeroes rows 3–6 and collapses to the literal 8-row structure of §5 — the full ±30° simulation, with its −1.80 dB centre tilt and the phantom-centre comb.

**Correction (measured, supersedes an estimate made here earlier).** An earlier draft of this section called that comb "shallow because the two paths differ by 13.6 dB there". It is not shallow. Evaluated over 20 Hz–20 kHz the centre response at λ=1, 30° has a **11.59 dB dip at 1426 Hz** — straight through vocal presence. The level-difference reasoning was wrong because it used the HF asymptote, while the notch sits where the shadow filter has barely begun to act and the two paths are still comparable. This matters: it is the single largest coloration the design produces, an order of magnitude above the tilt everything else in this document discusses.

**λ = 0** gives a centre of exactly 1 at *every* frequency — the delay term cancels between rows 3 and 7 identically, so there is no tilt and no comb, with the side path still fully processed. Verified numerically: at λ = 0 the row coefficients sum to A + B = 1.000 at DC and at HF alike.

**Between them**, partial tilt and partial comb depth. λ is the existing compensation slider, generalized: `s = 1 − λ` maps onto today's 0–150 % control with the same sense (0 % = untouched crossfeed character, 100 % = neutral centre, above 100 % = overshoot brighter).

Cost of the generality: 16 rows against 8. The matrix allows 128, and the engine's `pipelines` setting has a 16 option, so this is free in practice.

### 6.2 · The centre control is a comb control

Measured, and the most useful thing to know about λ. The centre response's peak-to-trough ripple against λ, at three angles:

| λ | ripple @ 22° | ripple @ 30° | ripple @ 45° |
|---|---|---|---|
| 0 % | 0.00 dB | 0.00 dB | 0.00 dB |
| 40 % | 3.01 dB | 3.03 dB | 3.18 dB |
| 70 % | 6.25 dB | 6.30 dB | 6.68 dB |
| 100 % | 11.46 dB | 11.59 dB | 12.63 dB |

**The relationship is essentially angle-independent**: ripple falls below 3 dB at λ ≈ 39 % for every angle tested (39/39/38), and below 6 dB at λ ≈ 67 % (68/67/65). So the control behaves identically wherever the angle sits — move the geometry and the centre setting does not need re-tuning to hold the same amount of artifact.

**What angle moves is where the notch lands**: 2039 Hz at 22°, 1426 Hz at 30°, 952 Hz at 45°. That is the mechanism behind the wide-angle vocal oddity Phonitor users report — at wider angles the notch drops onto vocal fundamentals and instrument body. It is not that the ripple grows; it is that it moves somewhere far more damaging.

Note also that the HF tilt runs the *other* way — −2.08 dB at 22°, −1.80 at 30°, −1.14 at 45° — so any reasoning that treats "wider needs more centre correction" as a tilt story has the sign backwards.

### 6.3 · Controls

Three continuous parameters, none of them invented — each falls out of the model:

| control | what it sets | range |
|---|---|---|
| **θ** speaker angle | α_n and α_f via eq. (5), and the ITD via eq. (2). Physically this *is* the crossfeed amount: θ → 0° collapses toward mono, θ → 90° approaches no crossfeed at all | 0–90°, ±30° nominal |
| **a** head radius | ω₀ = c/a, hence the `lp1` corner; also scales the ITD linearly | ~7–10 cm, 8.75 cm nominal |
| **λ** centre character | literal loudspeaker centre (λ=1) ↔ flat centre (λ=0), side path untouched throughout | 0–150 % as `s = 1 − λ` |

Nothing here needs to be decided at design time. That is the point: bs2b exposes "level in dB", which is a coefficient of its own internal filter and means nothing physically; these are quantities a listener can reason about.

### 6.4 · Presets (implementation)

Angle and centre only. **Head size is excluded and persists across preset changes** — it is anatomy rather than taste, and it is the one parameter with a physically correct per-person answer, setting both the `lp1` corner and the ITD scale. Centre values are taken from the ripple table above rather than chosen by feel.

| Preset | Angle | Centre | Centre ripple | Notch | Rationale |
|---|---|---|---|---|---|
| **Standard** (default) | 30° | 70 % | 6.30 dB | 1426 Hz | ITU/SPL standard geometry, comb halved from literal |
| **Anechoic** | 30° | 100 % | 11.59 dB | 1426 Hz | literal — the notch left bare, as an anechoic pair would |
| **Intimate** | 22° | 70 % | 6.25 dB | 2039 Hz | closer stage, notch high and comparatively harmless |
| **Wide** | 45° | 50 % | 4.20 dB | 952 Hz | notch lands on vocal fundamentals, so bought down further |
| **Neutral center** | 30° | 0 % | 0.00 dB | — | zero centre coloration; nothing in hardware ships this |

Any manual touch of angle or centre falls to **Custom**, derived rather than stored, matching the Bauer preset dropdown's convention.

Grounding, and its limit: SPL's Phonitor parameterizes the same way (angle switch spanning 20–55°, marked at 20/30/40/55, with 30° as SPL's own recommended starting point and the fixed angle on the Phonitor se). Its quoted delays do **not** match ours — SPL give 20–55° as 90–635 µs where Woodworth at a = 8.75 cm gives 176–454 µs by ray and 270–664 µs including shadow group delay. So the parameterization is shared; the numbers are not, and copy should not imply Phonitor equivalence.

Not adopted: bs2b's preset names (Jan Meier, Chu Moy). Those are parameter sets for different math and live in Bauer mode; reusing the names would muddy the A/B.

### 6.5 · Supplying H — modelled or measured

`H_n` and `H_f` enter the algebra above as opaque transfer functions. Two realizations, same topology, same λ blend, same side-path arithmetic:

**Modelled** — `H = α + (1−α)·lp1`, two rows each, α and τ derived from θ and a. Exact, negligible CPU, and θ is continuously sweepable because α and τ are closed-form in it.

**Measured** — `H` is a convolution stage pointing at an HRTF impulse response, one row each. Captures pinna and torso cues the model omits.

- Matrix supports convolution per row, and HQPTuner already has the upload lane (`filterpark`, `POST /api/matrix/filter`). This uses **matrix pipeline convolution**, not HQPlayer's separate convolution-engine page — a distinct subsystem HQPTuner deliberately does not expose, and one the manual advises against running alongside the matrix anyway.
- The manual recommends 352.8/384 kHz impulses and provides `expand_hf` for lower-rate ones, suggesting one IR set can serve all source rates — **needs verification**.
- Dataset licensing (all secondhand, verify before use): MIT KEMAR — free with citation; CIPIC — public-domain subset, redistribution permitted; HUTUBS — CC BY; ARI — CC BY-SA (viral, problematic for vendoring); 3D3A — CC BY; SADIE II — licence not established.

These are not equivalent in every respect, and the differences are real rather than a matter of taste:

| | modelled | measured |
|---|---|---|
| rows for H | 2 per path | 1 per path |
| θ | continuous | per-angle lookup (datasets ship 5° increments) |
| group delay | continuous, supplies the LF ITD excess | baked into the IR |
| cost | negligible | FIR per row — real CPU, real latency |
| fidelity | no pinna, no torso | includes both |

The measured route is not automatically better. Non-individualized HRTFs are a known weak point — generic pinna cues frequently produce front-back confusion and in-head localization, and without room reflections or head tracking, externalization stays limited regardless of IR quality. A well-parameterized structural model can beat a stranger's ears.

## 7 · What this replaces

| | today (bauer + compensation) | this design |
|---|---|---|
| crossfeed | libbs2b post-process, 4 attributes | 16 matrix rows |
| ITD | implicit in bs2b's minimum-phase filters | explicit, θ- and a-derived |
| centre tilt | fixed by preset, corrected by a fitted 8-row block | λ, exact at every value |
| compensation feature | separate, with staleness detection and a rebuild button | **subsumed** — it is λ |
| controls | crossover Hz, level dB | speaker angle, head radius, λ |
| lane | http (restart) | http (restart), plus live A/B via matrix profiles |

## 8 · Implementation

Shipped as the Structural mode of the Crossfeed card. `lib/binaural.js` holds the model, compiler, recognizer and presets; `lib/xfmode.js` the mode derivation, staging and the stash that makes removal byte-exact; `components/Crossfeed.js` the card; `components/SpeakerDiagram.js` the geometry. Verified by `scripts/check_binaural.py` (nine checks, node-driven) and `scripts/check_xfeed.py`.

Two behaviours worth recording because both were got wrong first:

**Installing never refuses.** An earlier version returned an issue and blocked the mode switch when rows 0+1 were not a readable EQ pair. That guard was inherited from the compensation block, where it protects a round trip — here the round trip is guaranteed instead by stashing the original rows verbatim. Unreadable rows are now *set aside*: the block installs with no EQ of its own, the originals are stashed, and Turn off restores them exactly.

**EQ is carried per ear.** Chain and preamp both. A measured headphone correction is often asymmetric, and refusing those profiles would have excluded exactly the listeners most likely to want an accurate crossfeed. EQ distributes over each output ear independently, so this costs nothing structurally.

### 8.1 · Set-aside, verified end to end (2026-07-22)

Two restore paths, both exercised against the running app rather than reasoned about. Staged payloads were read off the wire from `POST /api/config/stage`, so what is recorded is what the app actually sent.

**Stashed restore, same session.** Rows 1+2 set to crossed routing — legal pipelines the compiler cannot read as an EQ pair — with asymmetric gains (−6.3 / −4.5) and an unrelated `riaa` row sitting past them. Clicking Structural installed anyway and reported why: *"pipelines 1+2 do not route straight through — they have been set aside, and Turn off restores them exactly."* Seventeen rows staged, which is the sixteen compiled plus the untouched `riaa` row; the two unreadable rows were consumed into the stash rather than appended. Turn off returned all three original rows **byte-identical**, crossed routing and asymmetric gains included.

**Fallback reconstruction, through the daemon.** The stash is written to `localStorage` alongside the remembered controls, so it **survives an Apply and a reload**. The fallback engages only when there is no stash to restore: a different browser, cleared storage, or a block installed before the stash existed. Driven with real Applies from a fresh browser context (stash verified empty): turning the block off and applying brought the daemon back carrying two rows, In 1→Out 1 and In 2→Out 2, both at −6.3 dB with the full 546-character headphone chain intact on each ear; the original sixteen rows were then restored through the same stage/apply lanes and read back **byte-identical to the starting configuration**.

Persistence has a cost worth naming: the stash is browser-local and is not invalidated by anything the daemon does. If the rows are changed elsewhere while a block is installed, Turn off still restores the stash as it was recorded, not what the configuration held most recently.

**What the fallback cannot reproduce**, now measured rather than assumed: row order is canonicalized to In 1-first, so a pair that arrived In 2-first comes back swapped; the gain is reformatted, not merely re-rounded — `String(Math.round(x * 100) / 100)` turns `−6.534` into `−6.53`, but also `−6.50` into `−6.5` and `−6.00` into `−6`; and exactly two rows come back, so a head that was three rows or asymmetric in a way the block flattened is not recoverable. None of this engages while the stash exists, which is the whole reason it exists.

## 9 · Invariants

States the implementation must make unreachable. These are not open questions — each follows from something already established, and probing them would only confirm a conclusion the maths already gives.

| invariant | why |
|---|---|
| crossfeed block ⇒ `post_bauer_enabled = 0` | The matrix runs *before* post-process, so both at once is two crossfeeds in series. This is not a UI gray-out: preset snapshots carry `post_bauer_enabled`, and matrix-profile load clears post-process and then has it re-applied from a snapshot by `matrixlane.profile_action`. The state can arrive without anyone touching a control, so the invariant has to be re-asserted wherever those lanes land, not just enforced at the point of edit. |
| crossfeed block ⇒ `iir2fir ≠ 2` | `iir2fir = 2` converts the matrix's parametric stages to linear phase, and linear phase means **constant group delay** — which deletes the 135 µs of low-frequency ITD that §3's head-shadow filter supplies. The magnitude response stays correct while the spatial cue degrades, so nothing on a response plot would show it. **`iir2fir = 1` is allowed**: the manual calls it "direct conversion, retain minimum-phase", and minimum phase preserves group delay for a given magnitude — which is precisely why `T_g` falls out of eq. (3) instead of being modelled separately. The conversion applies to parametric EQs, so `delay` stages are untouched. The setting exists for GPU offload; refusing it would lock those users out. |

Both are global `<matrix>` attributes that HQPTuner already exposes on the Matrix card, so both are reachable today by a user doing something otherwise reasonable — running linear-phase EQ, or loading a preset saved with crossfeed on.

## 10 · Genuinely open

Only two, and both bite the measured route alone:

1. **Does `expand_hf` rate-adapt a convolution IR**, or must the IR match the source rate? Decides whether the measured route ships one IR set or many.
2. **Dataset licences** (§6.3) — secondhand; each needs reading before anything is vendored.

Not blocking, and honest about their status: the daemon's `lp1` has been live-checked only to the extent that it parses and produces a lowpass shape — the numeric match against `dsp.js` is *not* asserted. The `/matrix/plot` oracle (`matrix-spec.md` round 3) can settle it, having confirmed the RBJ shelf/peak family at 0.019 dB, though it evaluates at a fixed ~96–99 kHz and so grounds coefficients rather than source-rate warping. Low risk: `lp1` carries the whole head-shadow decomposition, but it is also the least exotic filter in the set.

Where on the λ scale anyone wants to sit, and whether a measured HRTF beats the model, are listening questions. λ being continuous means they get settled by turning a knob rather than by committing to an architecture.

**Process note, recorded deliberately.** Delay resolution (§5) was chased through daemon probes when the authoritative answer sat in `hqplayer6desktop-manual.pdf` in the working directory — which `CLAUDE.md` names as the authority to consult *before* inferring wire behaviour. Read the manual section for a plugin before instrumenting it.

## 11 · Sources

- Brown, C. P. & Duda, R. O., "A Structural Model for Binaural Sound Synthesis", *IEEE Trans. Speech and Audio Processing* **6**(5), 1998, 476–488 — [PDF](https://www.ee.columbia.edu/~dpwe/papers/BrownD98-binsynth.pdf). Equations 1–5 and all constants above are from pp. 477–478.
- Bauer, B. B., "Stereophonic Earphones and Binaural Loudspeakers", *JAES* **9**(2), April 1961, 148–151 — [AES e-lib](https://www.aes.org/e-lib/download.cfm?ID=471). The origin of the ~0.4 ms LF crossfeed delay.
- [bs2b project page](https://bs2b.sourceforge.net/) — filter structure, the three presets, and the "azimuth 30 degrees" claim for the default.
- Aaronson, N. L. & Hartmann, W. M., "Testing, correcting, and extending the Woodworth model for interaural time difference", *JASA* 2014 — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3985894/). Kuhn's LF limit ITD = (3a/c)·sin θ and the Woodworth model's HF underestimate.
- Vickers, E., "Fixing the Phantom Center: Diffusing Acoustical Crosstalk" — [PDF](https://www.sfxmachine.com/docs/FixingThePhantomCenter.pdf). The phantom-centre comb and its ~2 kHz notch.
- [HeadWize crossfeed archive](https://headwizememorial.wordpress.com/tag/crossfeed/) — Linkwitz, Meier and Chu Moy topologies; Meier's frequency-dependent delay as an explicit anti-comb measure.
- HRTF datasets: [MIT KEMAR](https://sound.media.mit.edu/resources/KEMAR.html), [CIPIC](https://www.ece.ucdavis.edu/cipic/), [HUTUBS](https://depositonce.tu-berlin.de/items/dc2a3076-a291-417e-97f0-7697e332c960), [ARI](https://projects.ari.oeaw.ac.at/research/experimental_audiology/hrtf/database/hrtfBtEARI.html), [3D3A](https://3d3a.princeton.edu/3d3a-lab-head-related-transfer-function-database), [SADIE II](https://www.york.ac.uk/sadie-project/database_old.html).
