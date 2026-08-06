# Custom crossfeed — research findings and design options

Research output, 2026-07-22. Grounds question "should HQPTuner bypass HQPlayer's Bauer post-process and build own crossfeed in matrix pipelines?" in real psychoacoustic and filter math.

**Implemented.** Started as findings doc; design now ships as Structural mode of Crossfeed card. Implementation notes marked as such. Companion: `docs/matrix-spec.md` (matrix wire contract, probe findings, existing crossfeed-compensation design of record).

## Provenance

| Claim class | Status |
|---|---|
| Brown & Duda structural model (eqs. 1–5, numeric constants) | **Verified verbatim** from paper (IEEE TSAP 6(5), 1998, pp. 476–480) |
| Woodworth/Kuhn ITD limits | **Verified** — eq. (2) same paper, Kuhn's ~50 % LF excess quoted there |
| bs2b parameter model | **Verified** previously against libbs2b source; see `matrix-spec.md` |
| Matrix realizability | **Derived here** from wire grammar, then **validated live** — 24 rows applied and read back byte-exact, see §5 |
| Numeric agreement between structural model and bs2b default preset | **Computed here** — see §4, worth independent check |
| HRTF dataset licences | **Secondhand** from search summaries; each needs reading before vendoring |
| Delay-stage resolution | **Verified** — HQPlayer manual §7.2, `s` = "delay in number of samples at source rate" |
| Daemon accepts `delay` in a process chain | **Verified live** — all three unit forms (`s`/`t`/`d`+`v`) parse, magnitude-transparent |

---

## 1 · What crossfeed is trying to reproduce

Headphones deliver each channel to one ear only. Loudspeakers do not: each ear hears both speakers, far one **later** and **duller**. Crossfeed synthesizes second path. Two cues matter, behave differently with frequency:

- **ITD** — interaural time difference. Far ear's copy arrives later.
- **ILD / head shadow** — far ear's copy attenuated, more so with frequency, because head is only acoustic obstacle once size comparable to wavelength.

Below ~600 Hz head effectively transparent (no ILD), cue almost purely ITD. Above few kHz shadow dominates. Transition is whole design problem.

## 2 · ITD — the two limits

Brown & Duda work in **interaural-polar coordinates**: θ measured from interaural axis, not median plane. θ = 0° points at ear in question. Source at azimuth ±30° from front centre sits at θ = 60° for near ear, θ = 120° for far ear.

High-frequency (ray-tracing) limit, Woodworth & Schlosberg, eq. (2):

```
ΔT(θ) = −(a/c)·cos θ            for   0 ≤ |θ| < π/2
ΔT(θ) =  (a/c)·(|θ| − π/2)      for  π/2 ≤ |θ| < π
```

`a` = head radius, `c` = speed of sound. Paper's constants: **a = 8.75 cm** (average adult), **c ≈ 343 m/s**, giving **a/c = 255.1 µs**.

**On c, since HQPlayer names different one.** Manual's `delay` plugin defaults `v` to 343.956 m/s, tempting to match. Don't: `v` exists to convert `d=<metres>` into delay, and this design emits `t=<seconds>`, so `v` never consulted. Paper's 343 is what `a`, `α_min` and `θ_min` were fitted against on KEMAR data, and those constants travel together — mixing different c into them is false precision, not more precision. Gap quantified, not waved away: 0.28 % of c is **0.7 µs** of ITD, under 22.7 µs sample floor at 44.1 kHz (§5), and dominated ~37× by head-radius spread across adults (~7.5–9.5 cm, ±26 µs). Precision here bought by exposing `a`, which §6.2 does, not by refining c.

At low frequency delay is larger — Kuhn's result, quoted in paper as "approximately 50 % greater than the value predicted by (2) as µ → 0", where µ = ωa/c is normalized frequency and **µ = 1 corresponds to about 624 Hz**.

For ±30° speaker pair: near ear (θ=60°) sees ray delay of −127.6 µs, far ear (θ=120°) +133.6 µs, so **ITD of 261.1 µs**. This is number a fixed delay line would use. LF value larger — see §3.

## 3 · Head shadow — Brown & Duda's single-pole/single-zero filter

Eq. (3), head-shadow filter:

```
              1 + j·α(θ)·ω/(2ω₀)
H_HS(ω,θ) =  ─────────────────────  ,   0 ≤ α(θ) ≤ 2
                 1 + j·ω/(2ω₀)
```

eq. (4) `ω₀ = c/a`, zero's position set by eq. (5):

```
α(θ) = (1 + α_min/2) + (1 − α_min/2)·cos( (θ/θ_min)·180° )
```

**α_min = 0.1**, **θ_min = 150°**. Pole fixed at µ = 2; only zero moves with angle. DC gain 1 for every θ; high-frequency asymptote is α. So α = 2 is +6 dB HF boost (source at ear), α < 1 is cut.

Filter also carries group delay, eq. (3)'s consequence:

```
T_g = (1 − α)/(2ω₀) = ½·(a/c)·(1 − α)
```

paper notes this is exactly what supplies "the 50 % additional low-frequency delay observed by Kuhn". **LF ITD excess falls out of shadow filter — needs no separate model.**

Evaluated for ±30°:

| | near ear (θ=60°) | far ear (θ=120°) |
|---|---|---|
| α | 1.3436 | 0.2814 |
| DC gain | 0 dB | 0 dB |
| HF gain | +2.56 dB | −11.02 dB |
| group delay T_g | −43.8 µs | +91.7 µs |

Total LF ITD = 261.1 + 91.7 + 43.8 = **396.6 µs**, i.e. **52 % above HF value** — matches Kuhn's ~50 % independently.

Two corroborations. Bauer's original 1961 network delayed crossfeed signal "by about 0.4 ms below 1 kHz" — LF figure above. And ω₀/2π = 623.9 Hz is frequency where head starts to shadow at all, which is why every crossfeed design in literature places crossover between 650 and 900 Hz.

## 4 · What bs2b actually is, and its relation to this model

HQPlayer's `bauer` post-process is libbs2b (documented — see `matrix-spec.md`). Structure: first-order lowpass on cross path plus first-order high-boost on direct path, with scalar normalization. **No delay line**, but not delay-free: filters minimum-phase, so phase response supplies frequency-dependent delay — larger at LF, smaller at HF, qualitatively right shape. bs2b's own docs show this as "time delay response" curve.

Correcting earlier claim in this repo's discussion: bs2b does not "lack ITD"; it lacks **explicit, independently-controllable** ITD.

**Centre tilt is physically real, not bs2b defect.** For ±30° case above, ignoring delay (as bs2b does), centre response is (α_near + α_far)/2 = 0.8125 → **−1.80 dB at HF relative to DC**. bs2b's default preset (700 Hz / 4.5 dB) has computed centre tilt of **1.81 dB** (`lib/xfeed.js`, verified against source). Agreement to 0.01 dB, from independent derivations — and bs2b docs state default is "closest to the virtual speaker placement with azimuth 30 degrees".

**Reframes HQPTuner's existing compensation feature.** Crossfeed compensation does not correct error — it trades loudspeaker-accurate centre for neutral one. Legitimate, useful choice, and *tonal* choice, independent of any headphone EQ (which rides through untouched — EQ framing deliberately dropped in 0.4.0, should stay dropped). Feature's copy should not imply tilt is flaw. Worth wording pass whatever else decided.

## 5 · Realizability in HQPlayer's matrix — the key result

Matrix sums pipeline rows into shared mixdown, and `gainunit=Lin` accepts negative gains (phase inversion). Makes **parallel** structures expressible, not just cascades. Applied to eq. (3):

```
      1 + jαx                 1
H_HS = ───────  =  α + (1−α)·─────  ,   x = ω/(2ω₀)
       1 + jx               1 + jx
```

Constant plus scaled first-order lowpass. HQPlayer's `iir:type=lp1;f=F` is exactly that lowpass, −3 dB corner at 2ω₀/2π = **1248 Hz**. So:

> **Brown & Duda head-shadow filter is exactly realizable as two matrix rows — flat row at gain α, plus `lp1` row at gain (1−α). No fit, no approximation, no rate-bound raw biquads.**

ITD is `delay:t=<seconds>` stage. Manual §7.2 gives plugin arguments as `s` (samples **at source rate**), `t` (seconds), `d` (metres), `v` (velocity, default 343.956 m/s) — so `t` rate-independent as *specification*, but underlying primitive is sample-granular at source rate. Resolution therefore **22.7 µs at 44.1 kHz**, ~4 % of 261 µs ITD, improving directly with rate.

Matters less than it looks, because **ITD is not all in delay line**. Per §3, head-shadow filter's group delay supplies low-frequency excess — 135 µs of 397 µs total — and that comes from IIR, which is continuous. Delay stage carries only high-frequency ray component, and ITD sensitivity greatest below ~1.5 kHz, precisely where shadow filter does work. So quantized part of cue lands where ear cares least. If ever audible at redbook rates, `iir:type=ap` gives fractional, rate-independent delay in-band — fallback, not something to build on spec.

### Wire shape — 8 rows, stereo

With common delay normalized out (near ear τ = 0, far ear τ = 261 µs), `k` = global normalization, `α_n` = 1.3436, `α_f` = 0.2814:

| # | src | process | gain (Lin) | → out |
|---|---|---|---|---|
| 1 | L | *(empty)* | `α_n·k` | L |
| 2 | L | `iir:type=lp1;f=1248` | `(1−α_n)·k` | L |
| 3 | R | `delay:t=0.000261` | `α_f·k` | L |
| 4 | R | `iir:type=lp1;f=1248,delay:t=0.000261` | `(1−α_f)·k` | L |
| 5–8 | | mirror image | | R |

`k = 0.5` puts centre at unity gain at DC. Note `(1−α_n)` is **negative** (−0.3436) — near-ear row 2 phase-inverted, which makes near ear's mild HF *boost* come out right. Exactly the Lin-negative capability compensation block already relies on.

Per-ear EQ appends to all four rows feeding that ear — EQ distributes over sum, same trick `msCompile()` already uses.

Eight rows: same budget current compensation block spends, replacing numerically-fitted correction with exact structural model.

## 6 · The design — one topology, three controls, two ways to supply H

"Literal loudspeaker simulation" versus "flat centre by construction" is not fork — endpoints of one continuous parameter. Neither is "structural" versus "HRTF" — two ways of supplying same two transfer functions into same row structure. One design follows.

### 6.1 · Topology

Hold side path at physical value, put only **centre** on control:

```
G_S      = (H_n − H_f)/2                    side path — fixed, never moves
G_M(λ)   = λ·(H_n + H_f)/2 + (1 − λ)        centre path — λ = 1 literal, λ = 0 flat
```

Rows carry coefficient per (source, output) pair, follow directly:

```
A = (G_M + G_S)/2 = [(λ+1)·H_n + (λ−1)·H_f]/4 + (1−λ)/2      same-side  (L → L)
B = (G_M − G_S)/2 = [(λ−1)·H_n + (λ+1)·H_f]/4 + (1−λ)/2      opposite   (R → L)
```

Substituting `H_n = α_n + (1−α_n)·P` and `H_f = D·[α_f + (1−α_f)·P]` (P = `lp1`, D = delay) expands each coefficient into four row types — flat, `lp1`, delayed, delayed `lp1`. Eight rows per output ear, **16 rows** for stereo:

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

**λ = 1** zeroes rows 3–6, collapses to literal 8-row structure of §5 — full ±30° simulation, with its −1.80 dB centre tilt and phantom-centre comb.

**That comb is deep, and measured.** Over 20 Hz–20 kHz centre response at λ=1, 30° has **11.59 dB dip at 1426 Hz** — straight through vocal presence. Single largest coloration design produces, order of magnitude above tilt everything else here discusses. Reasoning about depth from two paths' HF level difference (13.6 dB) gives wrong answer: notch sits where shadow filter has barely begun to act and two paths still comparable.

**λ = 0** gives centre of exactly 1 at *every* frequency — delay term cancels between rows 3 and 7 identically, so no tilt and no comb, side path still fully processed. Verified numerically: at λ = 0 row coefficients sum to A + B = 1.000 at DC and at HF alike.

**Between them**, partial tilt and partial comb depth. λ is existing compensation slider, generalized: `s = 1 − λ` maps onto today's 0–150 % control with same sense (0 % = untouched crossfeed character, 100 % = neutral centre, above 100 % = overshoot brighter).

Cost of generality: 16 rows against 8. Matrix allows 128, engine's `pipelines` setting has 16 option, so free in practice.

### 6.2 · The centre control is a comb control

Measured, most useful thing to know about λ. Centre response's peak-to-trough ripple against λ, three angles:

| λ | ripple @ 22° | ripple @ 30° | ripple @ 45° |
|---|---|---|---|
| 0 % | 0.00 dB | 0.00 dB | 0.00 dB |
| 40 % | 3.01 dB | 3.03 dB | 3.18 dB |
| 70 % | 6.25 dB | 6.30 dB | 6.68 dB |
| 100 % | 11.46 dB | 11.59 dB | 12.63 dB |

**Relationship essentially angle-independent**: ripple falls below 3 dB at λ ≈ 39 % for every angle tested (39/39/38), below 6 dB at λ ≈ 67 % (68/67/65). So control behaves identically wherever angle sits — move geometry and centre setting needs no re-tuning to hold same artifact amount.

**What angle moves is where notch lands**: 2039 Hz at 22°, 1426 Hz at 30°, 952 Hz at 45°. That is mechanism behind wide-angle vocal oddity Phonitor users report — at wider angles notch drops onto vocal fundamentals and instrument body. Not that ripple grows; it moves somewhere far more damaging.

Note HF tilt runs *other* way — −2.08 dB at 22°, −1.80 at 30°, −1.14 at 45° — so any reasoning treating "wider needs more centre correction" as tilt story has sign backwards.

### 6.3 · Controls

Three continuous parameters, none invented — each falls out of model:

| control | what it sets | range |
|---|---|---|
| **θ** speaker angle | α_n and α_f via eq. (5), ITD via eq. (2). Physically this *is* crossfeed amount: θ → 0° collapses toward mono, θ → 90° approaches no crossfeed at all | 0–90°, ±30° nominal |
| **a** head radius | ω₀ = c/a, hence `lp1` corner; also scales ITD linearly | ~7–10 cm, 8.75 cm nominal |
| **λ** centre character | literal loudspeaker centre (λ=1) ↔ flat centre (λ=0), side path untouched throughout | 0–150 % as `s = 1 − λ` |

Nothing here needs deciding at design time. That is point: bs2b exposes "level in dB", coefficient of its own internal filter, means nothing physically; these are quantities listener can reason about.

### 6.4 · Presets (implementation)

Angle and centre only. **Head size excluded and persists across preset changes** — anatomy rather than taste, and the one parameter with physically correct per-person answer, setting both `lp1` corner and ITD scale. Centre values taken from ripple table above, not chosen by feel.

| Preset | Angle | Centre | Centre ripple | Notch | Rationale |
|---|---|---|---|---|---|
| **Standard** (default) | 30° | 70 % | 6.30 dB | 1426 Hz | ITU/SPL standard geometry, comb halved from literal |
| **Anechoic** | 30° | 100 % | 11.59 dB | 1426 Hz | literal — notch left bare, as anechoic pair would |
| **Intimate** | 22° | 70 % | 6.25 dB | 2039 Hz | closer stage, notch high and comparatively harmless |
| **Wide** | 45° | 50 % | 4.20 dB | 952 Hz | notch lands on vocal fundamentals, so bought down further |
| **Neutral center** | 30° | 0 % | 0.00 dB | — | zero centre coloration; nothing in hardware ships this |

Any manual touch of angle or centre falls to **Custom**, derived rather than stored, matching Bauer preset dropdown's convention.

Grounding, and its limit: SPL's Phonitor parameterizes same way (angle switch spanning 20–55°, marked at 20/30/40/55, 30° as SPL's own recommended starting point and fixed angle on Phonitor se). Its quoted delays do **not** match ours — SPL give 20–55° as 90–635 µs where Woodworth at a = 8.75 cm gives 176–454 µs by ray and 270–664 µs including shadow group delay. So parameterization shared; numbers not, and copy should not imply Phonitor equivalence.

Not adopted: bs2b's preset names (Jan Meier, Chu Moy). Those are parameter sets for different math and live in Bauer mode; reusing names would muddy A/B.

### 6.5 · Supplying H — modelled or measured

`H_n` and `H_f` enter algebra above as opaque transfer functions. Two realizations, same topology, same λ blend, same side-path arithmetic:

**Modelled** — `H = α + (1−α)·lp1`, two rows each, α and τ derived from θ and a. Exact, negligible CPU, and θ continuously sweepable because α and τ closed-form in it.

**Measured** — `H` is convolution stage pointing at HRTF impulse response, one row each. Captures pinna and torso cues model omits.

- Matrix supports convolution per row, and HQPTuner already has upload lane (`filterpark`, `POST /api/matrix/filter`). Uses **matrix pipeline convolution**, not HQPlayer's separate convolution-engine page — distinct subsystem HQPTuner deliberately does not expose, one manual advises against running alongside matrix anyway.
- Manual recommends 352.8/384 kHz impulses and provides `expand_hf` for lower-rate ones, suggesting one IR set can serve all source rates — **needs verification**.
- Dataset licensing (all secondhand, verify before use): MIT KEMAR — free with citation; CIPIC — public-domain subset, redistribution permitted; HUTUBS — CC BY; ARI — CC BY-SA (viral, problematic for vendoring); 3D3A — CC BY; SADIE II — licence not established.

Not equivalent in every respect, and differences real rather than matter of taste:

| | modelled | measured |
|---|---|---|
| rows for H | 2 per path | 1 per path |
| θ | continuous | per-angle lookup (datasets ship 5° increments) |
| group delay | continuous, supplies LF ITD excess | baked into IR |
| cost | negligible | FIR per row — real CPU, real latency |
| fidelity | no pinna, no torso | includes both |

Measured route not automatically better. Non-individualized HRTFs are known weak point — generic pinna cues frequently produce front-back confusion and in-head localization, and without room reflections or head tracking, externalization stays limited regardless of IR quality. Well-parameterized structural model can beat stranger's ears.

## 7 · What this replaces

| | today (bauer + compensation) | this design |
|---|---|---|
| crossfeed | libbs2b post-process, 4 attributes | 16 matrix rows |
| ITD | implicit in bs2b's minimum-phase filters | explicit, θ- and a-derived |
| centre tilt | fixed by preset, corrected by fitted 8-row block | λ, exact at every value |
| compensation feature | separate, with staleness detection and rebuild button | **subsumed** — it is λ |
| controls | crossover Hz, level dB | speaker angle, head radius, λ |
| lane | http (restart) | http (restart), plus live A/B via matrix profiles |

## 8 · Implementation

Ships as Structural mode of Crossfeed card. `lib/binaural/` holds model, compiler, recognizer, and `lib/binaural-setup.js` the presets; `lib/xfmode.js` the mode derivation and staging; `components/Crossfeed.js` the card; `components/CrossfeedGeometry.js` the geometry. Verified by `scripts/gates/check_binaural.py` (ten checks, node-driven) and `scripts/gates/check_xfeed.py`.

Three behaviours worth recording because all three got wrong first:

**Installing never refuses.** Earlier version returned issue and blocked mode switch when rows 0+1 were not readable EQ pair. Guard inherited from compensation block; control that silently declines to go where user pointed it is worse than one that goes and explains. Rows compiler cannot read as EQ pair are *set aside*: block installs carrying no EQ of its own, and says so.

**EQ carried per ear.** Chain and preamp both. Measured headphone correction often asymmetric, and refusing those profiles would have excluded exactly listeners most likely to want accurate crossfeed. EQ distributes over each output ear independently, so costs nothing structurally.

**Removal is arithmetic, not recall.** Crossfeed is transform layered on top of EQ. Turn on, transform applied; turn off, transform removed; EQ untouched by both. λ, θ and *a* define transform completely, so `recognizeRows` — exact inverse of `compileRows` — recovers per-ear chain and preamp from installed rows, and `removeStructural` writes them back out as pair. Nothing destroyed on way in, so nothing to remember on way out. See §8.1.

### 8.1 · Removal

`removeStructural` has exactly one path, no branch. Nothing stashed at install time, because nothing needs to be:

- Per-ear chain and preamp come from `rec` (`recognizeRows`, exact inverse of `compileRows`), so EQ handed back is whatever block carries **at moment it is turned off** — not what it carried when installed. EQ under installed block is not frozen: `structuralPlan` (`lib/eqimport.js`) loads profile onto live block by recompiling all sixteen rows, and card's own controls restage it on every nudge.
- Channels come from block's own rows (`rows[0]`, `rows[8]`), so block built on In 3 / In 4 comes back on In 3 / In 4 rather than canonicalized to In 1-first.
- Gain emitted on 1e-3 grid `recognizeRows` snaps preamp to. Rounding coarser than block demonstrably carries would silently edit user's number.

**What removal does not reproduce.** Exactly two rows come back, one per ear — head that was three rows before install is not recoverable, and neither are rows compiler *set aside*, which install does not carry into block. That is install's behaviour, not removal's: removal reads block in front of it and cannot know how block came to be.

Covered by `tests/js/xfmode.test.js`.

## 9 · Invariants

States implementation must make unreachable. Not open questions — each follows from something already established, and probing them would only confirm conclusion math already gives.

| invariant | why |
|---|---|
| crossfeed block ⇒ `post_bauer_enabled = 0` | Matrix runs *before* post-process, so both at once is two crossfeeds in series. Not a UI gray-out: preset snapshots carry `post_bauer_enabled`, and matrix-profile load clears post-process then has it re-applied from snapshot by `matrixlane.profile_action`. State can arrive without anyone touching a control, so invariant must be re-asserted wherever those lanes land, not just enforced at point of edit. |
| crossfeed block ⇒ `iir2fir ≠ 2` | `iir2fir = 2` converts matrix's parametric stages to linear phase, and linear phase means **constant group delay** — deletes the 135 µs of low-frequency ITD §3's head-shadow filter supplies. Magnitude response stays correct while spatial cue degrades, so nothing on a response plot would show it. **`iir2fir = 1` is allowed**: manual calls it "direct conversion, retain minimum-phase", and minimum phase preserves group delay for given magnitude — precisely why `T_g` falls out of eq. (3) instead of being modelled separately. Conversion applies to parametric EQs, so `delay` stages untouched. Setting exists for GPU offload; refusing it would lock those users out. |

Both are global `<matrix>` attributes HQPTuner already exposes on Matrix card, so both reachable today by user doing something otherwise reasonable — running linear-phase EQ, or loading preset saved with crossfeed on.

## 10 · Genuinely open

Only two, both bite measured route alone:

1. **Does `expand_hf` rate-adapt a convolution IR**, or must IR match source rate? Decides whether measured route ships one IR set or many.
2. **Dataset licences** (§6.5) — secondhand; each needs reading before anything vendored.

Not blocking, honest about status: daemon's `lp1` live-checked only to extent that it parses and produces lowpass shape — numeric match against `dsp.js` *not* asserted. `/matrix/plot` oracle (`matrix-spec.md` "Probe findings — `/matrix/plot` as a numeric oracle") can settle it, having confirmed RBJ shelf/peak family at 0.019 dB, though it evaluates at fixed ~96–99 kHz and so grounds coefficients rather than source-rate warping. Low risk: `lp1` carries whole head-shadow decomposition, but also least exotic filter in set.

Where on λ scale anyone wants to sit, and whether measured HRTF beats model, are listening questions. λ being continuous means they get settled by turning knob rather than committing to architecture.

## 11 · Sources

- Brown, C. P. & Duda, R. O., "A Structural Model for Binaural Sound Synthesis", *IEEE Trans. Speech and Audio Processing* **6**(5), 1998, 476–488 — [PDF](https://www.ee.columbia.edu/~dpwe/papers/BrownD98-binsynth.pdf). Equations 1–5 and all constants above from pp. 477–478.
- Bauer, B. B., "Stereophonic Earphones and Binaural Loudspeakers", *JAES* **9**(2), April 1961, 148–151 — [AES e-lib](https://www.aes.org/e-lib/download.cfm?ID=471). Origin of ~0.4 ms LF crossfeed delay.
- [bs2b project page](https://bs2b.sourceforge.net/) — filter structure, three presets, "azimuth 30 degrees" claim for default.
- Aaronson, N. L. & Hartmann, W. M., "Testing, correcting, and extending the Woodworth model for interaural time difference", *JASA* 2014 — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3985894/). Kuhn's LF limit ITD = (3a/c)·sin θ and Woodworth model's HF underestimate.
- Vickers, E., "Fixing the Phantom Center: Diffusing Acoustical Crosstalk" — [PDF](https://www.sfxmachine.com/docs/FixingThePhantomCenter.pdf). Phantom-centre comb and its ~2 kHz notch.
- [HeadWize crossfeed archive](https://headwizememorial.wordpress.com/tag/crossfeed/) — Linkwitz, Meier and Chu Moy topologies; Meier's frequency-dependent delay as explicit anti-comb measure.
- HRTF datasets: [MIT KEMAR](https://sound.media.mit.edu/resources/KEMAR.html), [CIPIC](https://www.ece.ucdavis.edu/cipic/), [HUTUBS](https://depositonce.tu-berlin.de/items/dc2a3076-a291-417e-97f0-7697e332c960), [ARI](https://projects.ari.oeaw.ac.at/research/experimental_audiology/hrtf/database/hrtfBtEARI.html), [3D3A](https://3d3a.princeton.edu/3d3a-lab-head-related-transfer-function-database), [SADIE II](https://www.york.ac.uk/sadie-project/database_old.html).