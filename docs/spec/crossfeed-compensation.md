# Crossfeed compensation (M/S) — design of record

Compensation for the tonal tilt HQPlayer's Bauer crossfeed puts on headphone EQ. The structural crossfeed that generalizes it is `docs/research/crossfeed-math.md`; the matrix wire it compiles to is `docs/spec/protocol.md` §3.7.

## Motivation

AutoEq and REW profiles are measured and targeted for raw headphone drive. The Bauer post-process re-tilts the perceived response, so an imported EQ never lands on its target while crossfeed is enabled. Compensation restores the EQ target's tonality for correlated (center) content while keeping crossfeed's intended spatial effect, the narrowing of low-frequency stereo width.

## Model

HQPlayer's `bauer` is libbs2b (`bs2b.c`/`bs2b.h`, Boris Mikhaylov, MIT). The manual's third-party license list attributes bs2b verbatim (§11.8, "Copyright (c) 2005 Boris Mikhaylov", full MIT text). The preset trio (default 700 Hz / 4.5 dB, cmoy 700 / 6.0, jmeier 650 / 9.5) and the parameter ranges (fcut 300–2000 Hz, feed 1–15 dB, 0.1 steps) match bs2b's constants and valid ranges exactly. MIT permits modification, so the shipped curve's match to bs2b is not independently confirmed.

From `(fc, feed)`:

```
GB_lo = -5·feed/6 - 3        (dB, crossfeed path LF gain)
GB_hi =  feed/6  - 3         (dB, direct path LF gain; GB_hi - GB_lo = feed)
G_lo  = 10^(GB_lo/20)
G_hi  = 1 - 10^(GB_hi/20)
Fc_hi = fc · 2^((GB_lo - 20·log10(G_hi))/12)
norm  = 1/(1 - G_hi + G_lo)
```

Per channel, the crossfeed path is a first-order lowpass at `fc` with DC gain `G_lo`, and the direct path is a first-order high boost at `Fc_hi` (DC `1-G_hi`, HF 1), both scaled by `norm`. The 2×2 system is symmetric, so it diagonalizes exactly in mid/side:

```
R_M(f) = norm · (H_hi + H_lo)    — center path: LF exactly 0 dB (by construction), HF 20·log10(norm)  → the warm tilt
R_S(f) = norm · (H_hi - H_lo)    — side path: LF narrowed (the intended spatial effect), untouched by this feature
```

Preset tilts: default +1.81 dB (LF 0, HF −1.81) with its transition around 700–1000 Hz, cmoy +1.53 dB, jmeier +1.08 dB. **The daemon does not surface preset internals**: switching bauer to cmoy leaves the form's frequency and level at their stored values, so the preset-to-`(fc, feed)` mapping comes from the bs2b constants, never from readback.

## Compensation

`C(f) = (1/R_M(f))^s`, with the strength `s` from 0 to 150 % in 1 % steps, default 100 %, and the computed tilt shown beside it. It is **anchored at 0 dB in the low frequencies (a boost)**, so the balance of center level against width holds at every `s`.

It is realized as **two cascaded parametric shelf stages**, an analytic two-real-pole, two-real-zero decomposition of `R_M` fitted to the daemon's RBJ shelf primitives. **One analytic seed suffices**: `0.54·fc` at `q 0.58` for the first stage and `0.8·Fc_hi` at `q 0.66` for the second descend to 0.031 dB or better on all three presets and at the corners of the parameter range. Strength is a **linear scaling of the 100 % fit's gains, with no refit** (within 0.046 dB of the exact `C^s` over 25–150 %). Only rate-independent parametric stages are used: a raw biquad is bound to a sample rate, and the matrix runs at the source rate.

**Wire quantization sets the step.** Stage gains are emitted at 2 decimal places, so the 1 % strength step is what survives the daemon, not a UI preference, and recognition snaps `s` to the same 1 % grid so the block round-trips.

## Wire shape

A stereo pair (rows for channels i and i+1) compiles to 8 pipelines, with `k = 10^(preamp_dB/20)`:

| # | src | process | gain | out |
|---|-----|---------|------|-----|
| 1 | i   | EQ chain + comp | Lin +0.5k | i |
| 2 | i+1 | EQ chain + comp | Lin +0.5k | i |
| 3 | i   | EQ chain        | Lin +0.5k | i |
| 4 | i+1 | EQ chain        | Lin −0.5k | i |
| 5 | i   | EQ chain + comp | Lin +0.5k | i+1 |
| 6 | i+1 | EQ chain + comp | Lin +0.5k | i+1 |
| 7 | i   | EQ chain        | Lin −0.5k | i+1 |
| 8 | i+1 | EQ chain        | Lin +0.5k | i+1 |

Out i is M′+S and out i+1 is M′−S; compensation sits on the M rows only.

**The rows are literal and badged.** The pipeline list shows the real 8 rows with a "crossfeed comp s %" badge, and changing the strength regenerates the block as one staged operation. Recognition is structural: the row pattern, the Lin gain magnitudes, a shared EQ prefix and the compensation suffix on the M rows. A hand edit that breaks the pattern drops the badge and the strength control, and the rows stand as ordinary pipelines, never blocked and never rewritten. Pair detection accepts either row order (live configs arrive with In 2 first); compilation always emits In 1 first. Multichannel is out of scope.

**Staleness is computed, never stored.** Recognition refits for the current crossfeed parameters and compares the stored shelf frequency and Q (tolerance 0.5 Hz, 0.005 Q). A mismatch marks the block stale, offers a rebuild at the preserved strength, and never recomputes on its own.

## UI

The compensation control carries the strength (0–150 %, 1 % steps, previewed while dragging and committed on release), a tilt readout, Turn on / Turn off / Rebuild when stale, and a small correction plot (crossfeed dip, correction, net result, ±3 dB). It grays with a reason when bauer is off.

The response plot carries three magnitude-only traces:

1. **Corrected center**, `EQ × R_M × C`: the primary trace, flattening live as the strength moves.
2. **Side through crossfeed**, `EQ × R_S`, muted: visibly untouched, showing the width narrowing that is kept on purpose.
3. **Uncorrected center**, the `s = 0` ghost, for before and after.

## Open items

- Measurement-rig confirmation of the shipped bauer curve.
- Multichannel (stereo pair only today).
- Interaction with a hand-edited EQ chain inside a recognized block.
