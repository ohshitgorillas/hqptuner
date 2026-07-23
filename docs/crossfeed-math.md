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
| Delay-stage sample quantization | **Unverified** — flagged as a probe in §8 |

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

The ITD is a `delay:t=<seconds>` stage, which is rate-independent (unlike `delay:s=<samples>`).

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

## 6. Three candidate designs

### A · Structural (literal loudspeaker simulation)

The 8 rows above. Physically motivated, every parameter traceable to head radius and speaker angle. Exposes **speaker angle** and **head radius** as the user controls, which are meaningful quantities, unlike bs2b's "level in dB".

- Centre response is *not* flat: −1.80 dB HF tilt plus a comb from the ITD, with the first null at 1/(2·261 µs) ≈ **1.9 kHz** (shallow, because the two paths differ in level by 13.6 dB there). Measured loudspeaker data puts the phantom-centre dip in the 2–3 kHz region, so this is the right order.
- That comb is **physically correct** — it is the real phantom-centre dip of a ±30° loudspeaker pair, not an artifact.
- The literature is split on whether reproducing it is desirable. Meier's design deliberately uses a frequency-dependent delay specifically to suppress comb effects, and several sources cite comb-filtering as the reason bs2b/Meier are preferred over naive delay-based crossfeeds.

### B · M/S (tonally neutral by construction)

Leave the mid path completely unprocessed and filter only the side path: `out_L = M + W(ω)·S`, `out_R = M − W(ω)·S`.

- Mid is **exactly** unity — no tilt, no comb, no compensation feature needed, ever. This is algebraically exact for any `W`, including one with a delay.
- But it is a **different philosophy**, not a normalization of design A. You cannot reach it by dividing A by its own mid response: with an ITD present the mid response has comb nulls, and its inverse is unstable. Mid-flatness has to be structural, which means giving up the literal HRTF pair.
- Loses the interaural time cue for centred content — which is arguably correct (a real centred source has zero ITD) but also loses the phantom-centre comb that a real ±30° pair produces.

### C · HRTF convolution

Put measured contralateral/ipsilateral impulse responses in the `process` chain as WAV convolution stages. Highest fidelity, includes pinna and torso cues that neither A nor B model.

- Matrix supports convolution per row; HQPTuner already has the upload lane (`filterpark`, `POST /api/matrix/filter`).
- HQPlayer's manual recommends 352.8/384 kHz impulses and provides `expand_hf` for lower-rate ones, which suggests one IR set can serve all source rates — **needs verification**.
- Dataset licensing (all secondhand, verify before use): MIT KEMAR — free with citation; CIPIC — public-domain subset, redistribution permitted; HUTUBS — CC BY; ARI — CC BY-SA (viral, problematic for vendoring); 3D3A — CC BY; SADIE II — licence not established.
- Caveat: non-individualized HRTFs are a well-known weak point. Generic pinna cues frequently produce front-back confusion and in-head localization, and without room reflections or head tracking, externalization is limited regardless of HRTF quality. A generic HRTF is not automatically better than a well-chosen structural model for this use case.

## 7. Comparison

| | A · structural | B · M/S | C · HRTF |
|---|---|---|---|
| rows | 8 | 6–8 | 4+ (per-row conv) |
| exactness | exact (algebraic) | exact (algebraic) | exact (measured) |
| centre tilt | −1.80 dB, physical | none, by construction | per dataset |
| ITD | explicit, controllable | in the side path only | measured, includes pinna |
| compensation feature | still wanted | **obsolete** | still wanted |
| user-facing controls | speaker angle, head radius | width, crossover | profile picker |
| CPU | negligible | negligible | real (FIR per row) |
| verification burden | model vs daemon | model vs daemon | dataset provenance |

## 8. Open questions — probes needed before any implementation

1. **Does `delay:t=` quantize to whole samples?** At 44.1 kHz one sample is 22.7 µs and the target ITD is 261 µs = 11.5 samples. ITD JND is on the order of 10–20 µs, so rounding is potentially audible at redbook rates and irrelevant at DSD rates. If it does quantize, `iir:type=ap` (allpass) is a fractional-delay fallback worth evaluating.
2. **Does the daemon's `lp1` match the bilinear first-order lowpass** `dsp.js` implements? The `/matrix/plot` oracle (`matrix-spec.md` round 3) can answer this directly — it already confirmed the RBJ shelf/peak family at 0.019 dB. Note the oracle evaluates at a fixed ~96–99 kHz, so it grounds coefficients but not source-rate warping.
3. **Does `expand_hf` genuinely rate-adapt a convolution IR**, or does an IR need to match the source rate? Decides whether design C is one IR set or many.
4. **Mutual exclusion with `bauer`.** The matrix runs *before* post-process, so a custom crossfeed with `post_bauer_enabled` still set is two crossfeeds in series. Whatever ships needs to make that state unreachable.
5. **Listening.** None of this settles whether A, B, or C sounds better; the phantom-centre comb in particular is a genuine accuracy-vs-neutrality fork that measurement cannot decide.

## 9. Sources

- Brown, C. P. & Duda, R. O., "A Structural Model for Binaural Sound Synthesis", *IEEE Trans. Speech and Audio Processing* **6**(5), 1998, 476–488 — [PDF](https://www.ee.columbia.edu/~dpwe/papers/BrownD98-binsynth.pdf). Equations 1–5 and all constants above are from pp. 477–478.
- Bauer, B. B., "Stereophonic Earphones and Binaural Loudspeakers", *JAES* **9**(2), April 1961, 148–151 — [AES e-lib](https://www.aes.org/e-lib/download.cfm?ID=471). The origin of the ~0.4 ms LF crossfeed delay.
- [bs2b project page](https://bs2b.sourceforge.net/) — filter structure, the three presets, and the "azimuth 30 degrees" claim for the default.
- Aaronson, N. L. & Hartmann, W. M., "Testing, correcting, and extending the Woodworth model for interaural time difference", *JASA* 2014 — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3985894/). Kuhn's LF limit ITD = (3a/c)·sin θ and the Woodworth model's HF underestimate.
- Vickers, E., "Fixing the Phantom Center: Diffusing Acoustical Crosstalk" — [PDF](https://www.sfxmachine.com/docs/FixingThePhantomCenter.pdf). The phantom-centre comb and its ~2 kHz notch.
- [HeadWize crossfeed archive](https://headwizememorial.wordpress.com/tag/crossfeed/) — Linkwitz, Meier and Chu Moy topologies; Meier's frequency-dependent delay as an explicit anti-comb measure.
- HRTF datasets: [MIT KEMAR](https://sound.media.mit.edu/resources/KEMAR.html), [CIPIC](https://www.ece.ucdavis.edu/cipic/), [HUTUBS](https://depositonce.tu-berlin.de/items/dc2a3076-a291-417e-97f0-7697e332c960), [ARI](https://projects.ari.oeaw.ac.at/research/experimental_audiology/hrtf/database/hrtfBtEARI.html), [3D3A](https://3d3a.princeton.edu/3d3a-lab-head-related-transfer-function-database), [SADIE II](https://www.york.ac.uk/sadie-project/database_old.html).
