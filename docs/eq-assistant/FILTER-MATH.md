# FILTER-MATH.md — biquad response, what "Q" means, and headroom

Companion to `SOURCES.md` (citations), `docs/protocol.md` (wire truth), `PRIMER.md` (feature contract). Compiled 2026-07-25.

The tuner's `evaluate_chain` tool computes the summed magnitude response of a filter chain in order to measure a candidate change and to recompute the required negative preamp. That computation is only meaningful if our `q` means the same thing the engine's `q` means. This document is the primary-source basis for that arithmetic — and it names, explicitly, the one link in the chain that is still asserted rather than sourced.

**Verification legend** — as `SOURCES.md`, plus `[VA]` = read by a delegated research agent that returned verbatim quotes and a URL (same artefact class as `[V]`; the difference is who read it).

---

## 1. RBJ Audio EQ Cookbook — the primary, finally read `[VA]`

* **Citation.** Bristow-Johnson, R. *Cookbook formulae for audio EQ biquad filter coefficients.* Maintained by the W3C Audio Working Group as the Audio-EQ-Cookbook appendix.
* **Artefact read.** `https://webaudio.github.io/Audio-EQ-Cookbook/Audio-EQ-Cookbook.txt` (8845 bytes, HTTP 200). Identical copy at `raw.githubusercontent.com/webaudio/Audio-EQ-Cookbook/main/Audio-EQ-Cookbook.txt`.
* **Reliability.** De-facto industry reference / primary source document, hosted by a standards body. Not peer-reviewed. It is the acknowledged source of the Web Audio API's normative biquad formulae (§3) and is cited as ref [9] by Orfanidis (§2).
* **Status change.** This **supersedes the `[S]` citation in `SOURCES.md` §1.2**, which recorded that the primary had not been reached. Every formula below is transcribed from the artefact.

Preamble, verbatim: "All filter transfer functions were derived from analog prototypes (that are shown below for each EQ filter type) and had been digitized using the Bilinear Transform."

### 1.1 The three bandwidth parameterisations — and two traps

Verbatim:

```
    Q (the EE kind of definition, except for peakingEQ in which A*Q is
        the classic EE Q.  That adjustment in definition was made so that
        a boost of N dB followed by a cut of N dB for identical Q and
        f0/Fs results in a precisely flat unity gain filter or "wire".)

     _or_ BW, the bandwidth in octaves (between -3 dB frequencies for BPF
        and notch or between midpoint (dBgain/2) gain frequencies for
        peaking EQ)

     _or_ S, a "shelf slope" parameter (for shelving EQ only).  When S = 1,
        the shelf slope is as steep as it can be and remain monotonically
        increasing or decreasing gain with frequency.  The shelf slope, in
        dB/octave, remains proportional to S for all other values for a
        fixed f0/Fs and dBgain.
```

**Trap 1: for a peaking filter the cookbook's Q is not the classic EE Q — the classic EE Q is `A*Q`.** The redefinition exists so that a +N dB boost and a −N dB cut at identical Q cancel exactly.

**Trap 2: peaking bandwidth is measured between the `dBgain/2` midpoint gain frequencies, not the −3 dB points.** The −3 dB definition applies to band-pass and notch only.

Both traps matter to us because a "Q" copied between tools that disagree on either convention is silently a different filter.

### 1.2 Intermediate variables — verbatim

```
    A  = sqrt( 10^(dBgain/20) )
       =       10^(dBgain/40)     (for peaking and shelving EQ filters only)

    w0 = 2*pi*f0/Fs

    alpha = sin(w0)/(2*Q)                                       (case: Q)
          = sin(w0)*sinh( ln(2)/2 * BW * w0/sin(w0) )           (case: BW)
          = sin(w0)/2 * sqrt( (A + 1/A)*(1/S - 1) + 2 )         (case: S)

        FYI: The relationship between bandwidth and Q is
             1/Q = 2*sinh(ln(2)/2*BW*w0/sin(w0))     (digital filter w BLT)
        or   1/Q = 2*sinh(ln(2)/2*BW)             (analog filter prototype)

        The relationship between shelf slope and Q is
             1/Q = sqrt((A + 1/A)*(1/S - 1) + 2)
```

### 1.3 The three stage types we emit — verbatim

```
peakingEQ:  H(s) = (s^2 + s*(A/Q) + 1) / (s^2 + s/(A*Q) + 1)

            b0 =   1 + alpha*A          a0 =   1 + alpha/A
            b1 =  -2*cos(w0)            a1 =  -2*cos(w0)
            b2 =   1 - alpha*A          a2 =   1 - alpha/A
```

```
lowShelf: H(s) = A * (s^2 + (sqrt(A)/Q)*s + A)/(A*s^2 + (sqrt(A)/Q)*s + 1)

            b0 =    A*( (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*alpha )
            b1 =  2*A*( (A-1) - (A+1)*cos(w0)                   )
            b2 =    A*( (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*alpha )
            a0 =        (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*alpha
            a1 =   -2*( (A-1) + (A+1)*cos(w0)                   )
            a2 =        (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*alpha
```

```
highShelf: H(s) = A * (A*s^2 + (sqrt(A)/Q)*s + 1)/(s^2 + (sqrt(A)/Q)*s + A)

            b0 =    A*( (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*alpha )
            b1 = -2*A*( (A-1) + (A+1)*cos(w0)                   )
            b2 =    A*( (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*alpha )
            a0 =        (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*alpha
            a1 =    2*( (A-1) - (A+1)*cos(w0)                   )
            a2 =        (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*alpha
```

---

## 2. Why "Q" is convention-dependent — Orfanidis `[VA]`

* **Citation.** Orfanidis, S. J. "Digital Parametric Equalizer Design With Prescribed Nyquist-Frequency Gain." *JAES* 45(6), 444–454, June 1997. Presented at the 101st AES Convention, November 1996.
* **Artefact read.** The author's preprint PDF (mirrored; title, author, affiliation and the AES footnote all match the JAES record). **Page references are preprint pages, not JAES pagination.** The JAES version is paywalled `[X]` and was not purchased.

This is the authoritative statement that bandwidth — and therefore Q — has no single definition. Verbatim, §5 "Bandwidth":

> "As discussed by Bristow-Johnson [9], there is considerable variation in the literature in the definition of bandwidth Δω and bandwidth gain G_B."

> "For a boost, one may define G_B to be 3-dB below the peak gain, G_B² = G²/2, or take it to be 3-dB above the reference, G_B² = 2G_0², or, define it as the arithmetic mean of the peak and reference gains, G_B² = (G_0² + G²)/2, or as the geometric mean, G_B² = G_0 G, which is the arithmetic mean of the gains in dB scales."

and the reason RBJ's convention is the one that makes boost and cut cancel:

> "The weighted geometric mean is attractive because a boost and a cut by equal and opposite gains in dB cancel exactly [9] (their transfer functions are inverses of each other.)"

His closing position, §7:

> "Given the wide variety of possibilities in choosing G_B, it is perhaps best to leave G_B as a free parameter to be chosen by the user."

**Honest limitation, recorded rather than glossed:** the paper **never writes "Q"** and never states a `Q = ω₀/Δω` relation. It parameterises by {f_s, f_0, Δf, G_0, G_1, G, G_B}. The Q↔bandwidth bridge comes from the cookbook (§1.2), which Orfanidis cites as ref [9]: Bristow-Johnson, "The Equivalence of Various Methods of Computing Biquad Coefficients for Audio Parametric Equalizers," 97th AES Convention, 1994, **AES Preprint 3906 — paywalled, not retrieved `[X]`.** That preprint is the document that would settle the Q-convention question outright.

The octave-bandwidth relation does close the loop with the cookbook. Orfanidis Eq. (41), verbatim, is the prewarped form "Bristow-Johnson [9] suggests":

```
    Delta_Omega = 2*Omega_0 * sinh( (omega_0/sin omega_0) * (ln 2 / 2) * Delta_y )   (41)
```

— the same `sinh(ln(2)/2 · BW · w0/sin(w0))` factor that appears in the cookbook's `alpha` (case: BW).

Also useful, §7 verbatim, and relevant to why headphone correction is normally minimum-phase:

> "We note finally that the transfer function (20) is a minimum phase transfer function, so that both H(z) and its inverse 1/H(z) are stable and causal."

---

## 3. W3C Web Audio API — normative, and it hard-codes S = 1 `[VA]`

* **Citation.** *Web Audio API*, W3C. BiquadFilterNode §1.13 and Filter Characteristics §1.13.5. Published Recommendation (1.0, 17 June 2021) at `w3.org/TR/webaudio/`.
* **Retrieval note, stated honestly:** the rendered single-page spec exceeded the fetch tool's limit on three attempts. The text was read from the spec's **Bikeshed source of record** (`index.bs`), the file the published HTML is generated from.
* **Reliability.** Standards-body, normative.

Provenance statement, verbatim:

> "The formulas in this section describe the filters that a conforming implementation MUST implement… They are inspired by formulas found in the Audio EQ Cookbook."

Intermediate variables, verbatim — note the fourth line:

```
    A = 10^(G/40)
    ω₀ = 2π f₀/F_s
    α_Q = sin ω₀ / (2Q)
    α_QdB = sin ω₀ / (2 · 10^(Q/20))
    S = 1
    α_S = (sin ω₀ / 2) · sqrt( (A + 1/A)(1/S − 1) + 2 )
```

The source even carries an editorial comment on that line: `<!-- Should \alpha_S be simplified since S is always 1?-->`

**So a Web Audio shelf is not parameterisable by Q at all — S is fixed at 1.**

---

## 4. Shelf Q — what 0.7 actually means

`SOURCES.md`'s guardrail table fixes **shelf Q at 0.7**, provenanced to AutoEq's `DEFAULT_SHELF_FILTER_MAX_Q` and to every shipped oratory1990 shelf being `Q 0.70`. That is an appeal to convention. It now has a reason.

**Derived (arithmetic, not a quote):** substituting S = 1 into the cookbook's relation

```
    1/Q = sqrt((A + 1/A)*(1/S - 1) + 2)
```

collapses the `(1/S − 1)` term to zero **for any gain A**, leaving `1/Q = √2`, i.e. **Q = 1/√2 ≈ 0.7071**.

Combined with the cookbook's own words — "When S = 1, the shelf slope is as steep as it can be and remain monotonically increasing or decreasing gain with frequency" — this gives:

> **Q = 0.707 ⇔ S = 1 ⇔ the steepest shelf that does not overshoot, independent of gain.**

The cookbook does not use the word "Butterworth"; **do not attribute it to RBJ.**

**Open gap, flagged not papered over.** No source was found that *names* a canonical "shelf Q" and reconciles vendor differences. Orfanidis' free *Introduction to Signal Processing* EQ chapter, which might have, is unreachable — `eceweb1.rutgers.edu/~orfanidi/` returns HTTP 403 with the body "Server unable to read htaccess file, denying access to be safe" on every sub-path. **Server misconfiguration, not a paywall** `[X]`.

Equalizer APO (§5) exposes all three conventions side by side, which is direct evidence that "slope in dB/oct" and "Q" are alternative spellings of one parameter: its documented `LSC` examples give the *same* filter as both `LSC 10.8 dB Fc 300 Hz Gain 5.0 dB` and `LSC Fc 300 Hz Gain 5.0 dB Q 0.6473`.

---

## 5. Equalizer APO — the `ParametricEQ.txt` grammar `[VA]`

* **Citation.** Dahlinger, J. *Equalizer APO Documentation Wiki — "Configuration reference."* `sourceforge.net/p/equalizerapo/wiki/Configuration reference/`
* **Reliability.** Primary project documentation, and the de-facto industry reference: it is the format AutoEq, REW and oratory1990 files are written in — i.e. **the format the app already parses.**

File format, verbatim:

> "The configuration files of Equalizer APO are organized as lines of the following format: `Command: Parameters`. All lines not conforming to this format are silently ignored… Lines that contain any command name not supported are also silently ignored."

**`Preamp:` — the headroom directive**, verbatim:

> "Sets a preamplification value in decibels. **This is useful when you are using filters with positive gain, to make sure that no clipping occurs.** Since version 0.8, when multiple preamps apply to the same channel, the resulting preamp is the sum in dB."

**`Filter` syntax**, verbatim, both variants:

> `Filter <n>: ON <Type> Fc <Frequency> Hz Gain <Gain value> dB Q <Q value>` `Filter <n>: ON <Type> Fc <Frequency> Hz Gain <Gain value> dB BW Oct <Bandwidth value>` "The first parameter variant (with Q) is the filter text format used by Room EQ Wizard for equalizer type 'Generic'… **The filter number (n) is not interpreted and can be omitted.**"

**Filter type tokens** (X = required, O = optional):

| Token(s) | Description (verbatim) | Fc | Gain | Q/BW |
|---|---|---|---|---|
| `PK`, `Modal`, `PEQ` | "Peaking filter (Parametric EQ)" | X | X | X |
| `LP`, `LPQ` | "Low-pass filter" | X | — | O |
| `HP`, `HPQ` | "High-pass filter" | X | — | O |
| `BP` | "Band-pass filter (not from DCX2496)" | X | — | O |
| `LS`, `LSC x dB` | "Low-shelf filter (with center freq., x dB per oct. (LSC))" | X | X | O |
| `HS`, `HSC x dB` | "High-shelf filter (with center freq., x dB per oct. (HSC))" | X | X | O |
| `LS 6dB`, `LS 12dB` | "Low-shelf filter (6 / 12 dB per octave with corner freq.)" | X | X | — |
| `HS 6dB`, `HS 12dB` | "High-shelf filter (6 / 12 dB per octave with corner freq.)" | X | X | — |
| `NO` | "Notch filter" | X | — | O |
| `AP` | "All-pass filter" | X | — | X |

Note there is **no `IIR` row** — generic IIR is a separate command form (`Filter <n>: ON IIR Order <m> Coefficients …`), and the wiki advises against using it for biquads "because the execution time will be higher". Q on `LSC`/`HSC` is annotated as optional **since version 1.2.1**.

`GraphicEQ`, verbatim, for completeness: "The gain values are interpolated linearly in the logarithmic frequency spectrum… **Outside of the specified bands, the frequency response is flat.**"

---

## 6. Headroom and true peak

`SOURCES.md` §1.1 establishes the rule the tuner must follow — AutoEq emits `Preamp: {-compound.max_gain:.1f} dB`, i.e. the negative of the maximum of the **summed** magnitude response of the whole filter set, verified against the shipped HD 650 preset (largest band +6.4 dB, preamp −6.1 dB, because a −3.1 dB band partially cancels it).

EQ APO's own documentation (§5) states the same purpose in the tool's own words: a negative preamp exists "to make sure that no clipping occurs" with positive-gain filters.

**A widely-repeated wrong rule, worth citing as countered.** SoundGuys `[VA]` (consumer-audio editorial) instructs users to "bring that setting down by the same amount as your largest boost", with the worked example of boosting 200 Hz by 3 dB → "bring the overall preamp gain to -3dB". That is the *largest single band* rule, and the HD 650 preset disproves it directly. Our §1.1 derivation is correct and this is a useful illustration of the common error.

**True peak.** ITU-R BS.1770-5 Annex 2 `[VA]` (standards-body, free) is the reference for inter-sample peaks — the true-peak definition, the 12.04 dB step, 4× oversampling, and the `dB TP` unit. Relevant because a chain that is exactly 0 dBFS on samples can exceed 0 dBFS between them.

**Open, and honestly so:** no source was found that states an agreed headroom margin for inter-sample peaks in headphone EQ. The clearest statement located was a forum admission `[VA]`, quoted here only as evidence that no standard exists: "I don't think there's an agreed-upon upper limit for how much headroom is needed to accommodate any possible intersample or filtering induced peak."

---

## 7. The weak link in our measurement path

Everything above establishes what RBJ, W3C and EQ APO mean by `q`. **It does not establish what HQPlayer means by `q`.**

`SOURCES.md` §1.2 states that HQPlayer's `iir:` stage response math "is the standard RBJ biquad set", and sources that to **the commissioning brief** — not to HQPlayer documentation, not to measurement.

**Partially closed, 2026-07-25** `[V]`. `hqplayerd-readme.txt` (the Embedded daemon config reference, in the working directory) documents the plugin's arguments verbatim:

```
Plugin "iir" arguments:
	type=lp|lp1|hp|hp1|bp|ap|notch|peak|lshelf|hshelf|biquad
	f=<frequency>
	bw=<bandwidth>
	s=<slope>
	q=<Q>
	g=<gain dB>
	b0=<b0> b1=<b1> b2=<b2> a0=<a0> a1=<a1> a2=<a2>
```

This is materially stronger evidence than the brief. HQPlayer exposes **exactly the cookbook's three alternative bandwidth parameterisations** — `bw` in octaves, `s` shelf slope, `q` — and `s` is an RBJ-specific parameter that few implementations expose at all. The type list maps one-to-one onto the cookbook's set (LPF/HPF/BPF/notch/APF/peakingEQ/ lowShelf/highShelf), with `lp1`/`hp1` first-order variants and a raw `biquad` escape hatch added. Offering all three of Q, BW and S for the same filter is the cookbook's own structure, not a coincidence.

**What is still not established: the peaking-Q convention.** The readme documents the parameter *names*, not whether `q` is the cookbook's Q or the classic EE Q — which differ by a factor of `A` (§1.1). Nothing in the readme states which, and no bandwidth-gain definition appears anywhere in it.

**This is now the weakest link in the tuner's measurement path**, because every `evaluate_chain` figure depends on it. If HQPlayer's peaking `q` were the classic EE Q rather than the cookbook's (they differ by a factor of `A`, §1.1), every measured candidate would be subtly wrong in a gain-dependent way — worst at large gains, invisible at small ones.

**Manual checked, 2026-07-25** `[V]`. `hqplayer6desktop-manual.pdf` tabulates the per-type parameters, and the split is the cookbook's exactly:

| Type | Parameters as printed |
|---|---|
| `peak` | `f=frequency` · **`q=Q OR bw=bandwidth`** · `g=gain` |
| `lshelf` | `f=frequency` · **`q=Q OR s=slope`** · `g=gain` |
| `hshelf` | `f=frequency` · **`q=Q OR s=slope`** · `g=gain` |
| `notch`, `bp` | `f=frequency` · `q=Q OR bw=bandwidth` |

That is a stronger signal than the readme's flat argument list, because it reproduces RBJ's *type-specific* split rather than merely offering all three parameters everywhere: **`bw` is offered for peaking and notch/bandpass, `s` only for the shelves** — and `s` is shelving-only in the cookbook (§1.1). An implementation that had merely borrowed the parameter names would have no reason to restrict `s` that way.

**Still not established, after checking both documents: the bandwidth-gain convention.** Neither the readme nor the manual states whether `q` is the cookbook's Q or the classic EE Q (they differ by a factor of `A`), nor at what gain the bandwidth is measured. Status: **strongly indicated by the parameter structure, still unverified.**

One route remains:

1. ~~A statement in `hqplayer6desktop-manual.pdf`~~ — **checked, does not contain one.**
2. An empirical check: emit a known peaking stage, read the realised response, and compare against both conventions. The gain-dependence makes them easy to distinguish — measure at a large `g` where `A` is far from 1. Note this is a *write* against the production daemon, so it follows the dev-probe pattern in `scripts/capture_pcm_enums.py`: check state, restore what you change, verify the restore by readback.

Until one of those is done, treat the peaking-Q convention as **strongly indicated by the parameter set, and unverified**, and do not present `evaluate_chain` figures to the user with more precision than that supports. The practical exposure is small at the gains this feature emits — the two conventions diverge by a factor of `A`, which at ±3 dB is ~1.19 and at ±1 dB is ~1.06 — but it is a systematic error, not noise, and it grows with gain.

---

## 8. Open

- **AES Preprint 3906** (Bristow-Johnson 1994) — the primary that would settle the Q-convention question. Paywalled; a purchase decision.
- **Orfanidis, *Introduction to Signal Processing*, EQ chapter** — free but the host is misconfigured (403 on every sub-path).
- **Lipshitz, Pocock & Vanderkooy (1982)** on the audibility of phase distortion — abstract only, `[S]`; the paper is paywalled.
- **Rane technical notes** (constant-Q, Linkwitz-Riley) — reached only through a summarising fetch, so quotes are unverified against raw bytes `[S]`.
- **HQPlayer's own `iir` bandwidth convention** — §7. The highest-value item here, and the only one answerable from files already on this machine.
