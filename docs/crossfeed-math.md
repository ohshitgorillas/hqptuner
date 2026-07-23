# Custom crossfeed — research findings and design options

Research phase output, 2026-07-22. Grounds the question "should HQPTuner bypass HQPlayer's Bauer post-process and build its own crossfeed in matrix pipelines?" in the actual psychoacoustic and filter mathematics.

**This is a findings document, not an approved design.** No decision is taken here. Companion reading: `docs/matrix-spec.md` (matrix wire contract, probe findings, the existing crossfeed-compensation design of record).

## Provenance

| Claim class | Status |
|---|---|
| Brown & Duda structural model (eqs. 1–5, numeric constants) | **Verified verbatim** from the paper (IEEE TSAP 6(5), 1998, pp. 476–480) |
| Woodworth/Kuhn ITD limits | **Verified** — eq. (2) in the same paper, Kuhn's ~50 % LF excess quoted there |
| bs2b parameter model | **Verified** previously against the libbs2b source; see `matrix-spec.md` |
| Matrix realizability | **Derived here** from the wire grammar; the decomposition is algebra, not a fit — but it has **not been run against the daemon** |
| Numeric agreement between the structural model and bs2b's default preset | **Computed here** — see §4, worth an independent check |
| HRTF dataset licences | **Secondhand** from search summaries; each needs reading before any vendoring |
| Delay-stage resolution | **Verified** — HQPlayer manual §7.2, `s` = "delay in number of samples at source rate" |
| Daemon accepts `delay` in a process chain | **Verified live** — all three unit forms (`s`/`t`/`d`+`v`) parse and are magnitude-transparent |

---

## 1. What crossfeed is trying to reproduce

Headphones deliver each channel to one ear only. Loudspeakers do not: each ear hears both speakers, the far one **later** and **duller**. Crossfeed synthesizes that second path. Two cues matter, and they behave differently with frequency:

- **ITD** — interaural time difference. The far ear's copy arrives later.
- **ILD / head shadow** — the far ear's copy is attenuated, increasingly so with frequency, because the head is only an acoustic obstacle once its size is comparable to the wavelength.

Below roughly 600 Hz the head is effectively transparent (no ILD) and the cue is almost purely ITD. Above a few kHz the shadow dominates. The transition is the whole design problem.

## 2. ITD — the two limits

Brown & Duda work in **interaural-polar coordinates**: θ is measured from the interaural axis, not the median plane. θ = 0° points at the ear in question. A source at azimuth ±30° from front centre therefore sits at θ = 60° for the near ear and θ = 120° for the far ear.

The high-frequency (ray-tracing) limit, Woodworth & Schlosberg, eq. (2):

```
ΔT(θ) = −(a/c)·cos θ            for   0 ≤ |θ| < π/2
ΔT(θ) =  (a/c)·(|θ| − π/2)      for  π/2 ≤ |θ| < π
```

with `a` = head radius, `c` = speed of sound. The paper's stated constants: **a = 8.75 cm** (average adult), **c ≈ 343 m/s**, giving **a/c = 255.1 µs**.

At low frequency the delay is larger — Kuhn's result, quoted in the paper as "approximately 50 % greater than the value predicted by (2) as µ → 0", where µ = ωa/c is normalized frequency and **µ = 1 corresponds to about 624 Hz**.

For a ±30° speaker pair: the near ear (θ=60°) sees a ray delay of −127.6 µs, the far ear (θ=120°) +133.6 µs, for an **ITD of 261.1 µs**. This is the number a fixed delay line would use. The LF value is larger — see §3.

## 3. Head shadow — Brown & Duda's single-pole/single-zero filter

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

## 4. What bs2b actually is, and its relation to this model

HQPlayer's `bauer` post-process is libbs2b (documented — see `matrix-spec.md`). Its structure is a first-order lowpass on the cross path plus a first-order high-boost on the direct path, with a scalar normalization. **It has no delay line**, but it is not delay-free: its filters are minimum-phase, so their phase response supplies a frequency-dependent delay — larger at LF, smaller at HF, which is qualitatively the right shape. bs2b's own documentation shows this as a "time delay response" curve.

Correcting an earlier claim in this repo's discussion: bs2b does not "lack ITD"; it lacks an **explicit, independently-controllable** ITD.

**The centre tilt is physically real, not a bs2b defect.** For the ±30° case above, ignoring the delay (as bs2b does), the centre response is (α_near + α_far)/2 = 0.8125 → **−1.80 dB at HF relative to DC**. bs2b's default preset (700 Hz / 4.5 dB) has a computed centre tilt of **1.81 dB** (`lib/xfeed.js`, verified against the source). Agreement to 0.01 dB, from completely independent derivations — and bs2b's documentation states its default is "closest to the virtual speaker placement with azimuth 30 degrees".

**This reframes HQPTuner's existing compensation feature.** Crossfeed compensation does not correct an error — it trades a loudspeaker-accurate centre for a neutral one. That is a legitimate and useful choice, and it is a *tonal* choice, independent of any headphone EQ (which rides through untouched — the EQ framing was deliberately dropped in 0.4.0 and should stay dropped). What the feature's copy should not do is imply the tilt is a flaw. Worth a wording pass whatever else is decided.

## 5. Realizability in HQPlayer's matrix — the key result

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

## 6 · Candidate designs

### A · Structural, with the centre on a continuous control

An earlier draft of this document posed "literal loudspeaker simulation" and "flat centre by construction" as two competing designs. They are not — they are the endpoints of one parameter, and the blend is exact at every point on it.

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

**λ = 1** zeroes rows 3–6 and collapses to the literal 8-row structure of §5 — the full ±30° simulation, with its −1.80 dB centre tilt and the phantom-centre comb (first null at 1/(2·261 µs) ≈ **1.9 kHz**, shallow because the two paths differ by 13.6 dB there; measured loudspeaker data puts the dip in the 2–3 kHz region, so the order is right).

**λ = 0** gives a centre of exactly 1 at *every* frequency — the delay term cancels between rows 3 and 7 identically, so there is no tilt and no comb, with the side path still fully processed. Verified numerically: at λ = 0 the row coefficients sum to A + B = 1.000 at DC and at HF alike.

**Between them**, partial tilt and partial comb depth. λ is the existing compensation slider, generalized: `s = 1 − λ` maps onto today's 0–150 % control with the same sense (0 % = untouched crossfeed character, 100 % = neutral centre, above 100 % = overshoot brighter).

Cost of the generality: 16 rows against 8. The matrix allows 128, and the engine's `pipelines` setting has a 16 option, so this is free in practice.

Two further controls fall out of the model rather than being invented: **speaker angle** θ (sets α_n, α_f and τ through eqs. 2 and 5) and **head radius** a (sets ω₀ and scales τ). Both are physically meaningful in a way bs2b's "level in dB" is not.

### C · HRTF convolution

Put measured contralateral/ipsilateral impulse responses in the `process` chain as WAV convolution stages. Highest fidelity, includes pinna and torso cues that neither A nor B model.

- Matrix supports convolution per row; HQPTuner already has the upload lane (`filterpark`, `POST /api/matrix/filter`).
- HQPlayer's manual recommends 352.8/384 kHz impulses and provides `expand_hf` for lower-rate ones, which suggests one IR set can serve all source rates — **needs verification**.
- Dataset licensing (all secondhand, verify before use): MIT KEMAR — free with citation; CIPIC — public-domain subset, redistribution permitted; HUTUBS — CC BY; ARI — CC BY-SA (viral, problematic for vendoring); 3D3A — CC BY; SADIE II — licence not established.
- Caveat: non-individualized HRTFs are a well-known weak point. Generic pinna cues frequently produce front-back confusion and in-head localization, and without room reflections or head tracking, externalization is limited regardless of HRTF quality. A generic HRTF is not automatically better than a well-chosen structural model for this use case.

## 7. Comparison

| | A · structural | C · HRTF |
|---|---|---|
| rows | 16 (8 at λ=1) | 4+ (per-row conv) |
| exactness | exact (algebraic) at every λ | exact (measured) |
| centre | λ-controlled, −1.80 dB to flat | per dataset |
| ITD | explicit, controllable | measured, includes pinna |
| compensation feature | **subsumed** — it becomes λ | still wanted |
| user-facing controls | speaker angle, head radius, λ | profile picker |
| CPU | negligible | real (FIR per row) |
| verification burden | model vs daemon | dataset provenance |

## 8. Open questions — probes needed before any implementation

1. ~~**Does `delay:t=` quantize to whole samples?**~~ **Resolved from the manual (§7.2), not by probing** — the primitive is samples at source rate; see §5 for the resolution figure and why it lands where the ear cares least. Worth recording how this was mishandled: the question was chased through daemon probes when the authoritative answer was in `hqplayer6desktop-manual.pdf`, in the working directory, which `CLAUDE.md` names as the authority to consult *before* inferring wire behaviour. Read the manual section for a plugin before instrumenting it.
2. **Does the daemon's `lp1` match the bilinear first-order lowpass** `dsp.js` implements? Live-checked only to the extent that it parses and produces a lowpass shape; the numeric match is *not* asserted. The `/matrix/plot` oracle (`matrix-spec.md` round 3) can settle it — it confirmed the RBJ shelf/peak family at 0.019 dB — but note the oracle evaluates at a fixed ~96–99 kHz, so it grounds coefficients, not source-rate warping. Low risk: `lp1` is the one primitive the whole head-shadow decomposition rests on, but it is also the least exotic filter in the set.
3. **Does `expand_hf` genuinely rate-adapt a convolution IR**, or does an IR need to match the source rate? Decides whether design C is one IR set or many. Only blocks the HRTF variant.
4. **Mutual exclusion with `bauer`.** The matrix runs *before* post-process, so a custom crossfeed with `post_bauer_enabled` still set is two crossfeeds in series. A UI concern rather than a modelling one, but whatever ships needs to make that state unreachable.
5. **Listening.** The model says nothing about where on the λ scale anyone wants to sit, or whether a measured HRTF beats the structural model. Those are listening questions — but λ being continuous means they are settled by turning a knob rather than by picking an architecture up front.

## 9. Sources

- Brown, C. P. & Duda, R. O., "A Structural Model for Binaural Sound Synthesis", *IEEE Trans. Speech and Audio Processing* **6**(5), 1998, 476–488 — [PDF](https://www.ee.columbia.edu/~dpwe/papers/BrownD98-binsynth.pdf). Equations 1–5 and all constants above are from pp. 477–478.
- Bauer, B. B., "Stereophonic Earphones and Binaural Loudspeakers", *JAES* **9**(2), April 1961, 148–151 — [AES e-lib](https://www.aes.org/e-lib/download.cfm?ID=471). The origin of the ~0.4 ms LF crossfeed delay.
- [bs2b project page](https://bs2b.sourceforge.net/) — filter structure, the three presets, and the "azimuth 30 degrees" claim for the default.
- Aaronson, N. L. & Hartmann, W. M., "Testing, correcting, and extending the Woodworth model for interaural time difference", *JASA* 2014 — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3985894/). Kuhn's LF limit ITD = (3a/c)·sin θ and the Woodworth model's HF underestimate.
- Vickers, E., "Fixing the Phantom Center: Diffusing Acoustical Crosstalk" — [PDF](https://www.sfxmachine.com/docs/FixingThePhantomCenter.pdf). The phantom-centre comb and its ~2 kHz notch.
- [HeadWize crossfeed archive](https://headwizememorial.wordpress.com/tag/crossfeed/) — Linkwitz, Meier and Chu Moy topologies; Meier's frequency-dependent delay as an explicit anti-comb measure.
- HRTF datasets: [MIT KEMAR](https://sound.media.mit.edu/resources/KEMAR.html), [CIPIC](https://www.ece.ucdavis.edu/cipic/), [HUTUBS](https://depositonce.tu-berlin.de/items/dc2a3076-a291-417e-97f0-7697e332c960), [ARI](https://projects.ari.oeaw.ac.at/research/experimental_audiology/hrtf/database/hrtfBtEARI.html), [3D3A](https://3d3a.princeton.edu/3d3a-lab-head-related-transfer-function-database), [SADIE II](https://www.york.ac.uk/sadie-project/database_old.html).
