# PSYCHOACOUSTICS.md — how big, how narrow, and how sure

Companion to `SOURCES.md` (citations), `PRIMER.md` (feature contract), `TRANSDUCERS.md` (measurement reality). Compiled 2026-07-25.

This document answers two questions the tuner implicitly answers every turn, and previously answered from convention rather than evidence:

1. **How large does a move have to be before anyone hears it?**
2. **How narrow can a move usefully be before it stops mattering?**

It also records, deliberately, what could **not** be verified — including a load-bearing claim in `SOURCES.md` that has now failed verification three times by independent routes.

**Verification legend** — as `SOURCES.md`, plus `[VA]` = read by a delegated research agent that returned verbatim quotes and a URL (same artefact class as `[V]`; the difference is who read it). Figures computed by us from a quoted formula are labelled **derived** in place and are never presented as source claims.

---

## 1. Auditory filter bandwidth — the real justification for low Q

`SOURCES.md` §2.5 rules that voicing moves default to broad, low-Q filters. That ruling previously rested on Toole alone, partly at `[S]`. It now has an independent, free, peer-reviewed anchor.

**Völk, F. (2015). "Updated analytical expressions for critical bandwidth and critical-band rate." *Fortschritte der Akustik – DAGA 2015*, Nürnberg, pp. 1181–1182. Deutsche Gesellschaft für Akustik.** `[VA]` — peer-reviewed conference proceedings, free and permanently hosted. The best free artefact found that prints all the canonical formulae side by side.

Verbatim, formulae as printed:

```
Glasberg & Moore (1990) ERB:        Δf_EM(f)/Hz = 24.7 (4.37 f/kHz + 1)
Glasberg & Moore (1990) ERB-rate:   z_E(f)/E    = 21.4 log₁₀(4.37 f/kHz + 1)
Moore & Glasberg (1987):            Δf_EM2(f)/Hz = 19.5 (6.046 f/kHz + 1)
Moore & Glasberg (1983) ERB-rate:   z_E1(f)/E   = 11.17 logₑ[(f/kHz + 0.312)/(f/kHz + 14.675)] + 43
Zwicker & Terhardt (1980) CB:       Δf_GZ(f)/Hz = 25 + 75[1 + 1.4 (f/kHz)²]^0.69
```

introduced as: "Equation 6 represents the current standard method for computing the ERB at a given frequency."

**ERB bandwidths at specific frequencies — DERIVED by us from the quoted formula, not transcribed from any source:**

| Frequency | ERB |
|---|---|
| 100 Hz | ≈ 35.5 Hz |
| 1 kHz | ≈ 132.6 Hz |
| 5 kHz | ≈ 564.4 Hz |

Corroboration from an independent open-access source: Lopez-Poveda et al. `[VA]` (peer-reviewed, PMC9167757) quote the same relation in Q form — **`Q_ERB = 1000F / [24.7(4.37F + 1)]`** — and report measured `Q_ERB` "approximately 4 at 200 Hz and approximately 13 at 1000 Hz under forward masking."

**Zwicker's 24-band Bark table** was captured verbatim from a HEAD acoustics application note `[VA]` — **vendor documentation transcribing Zwicker (1961), not a primary source, and must be cited that way.** Selected rows (z / lower edge / Δf): 1→100 Hz, 5→510 Hz (Δf = 100 Hz for bands 1–4, 110 Hz for band 5), 9→1080 Hz (Δf 160), 13→2000 Hz (Δf 280), 17→3700 Hz (Δf 700), 20→6400 Hz (Δf 1300), 24→15500 Hz. Völk quotes Fastl & Zwicker (2007, p. 158) directly on the low-frequency floor: "it is attractive to add the inaudible range from 0 Hz to 20 Hz to that critical band, and to assume that the lowest critical band ranges from 0 Hz to 100 Hz."

### What this licenses

A filter much narrower than one ERB is being placed *inside* a single auditory filter, where the ear cannot resolve it as a separate spectral feature. At 1 kHz an ERB is ~133 Hz wide; a peaking filter at 1 kHz has a −3 dB bandwidth of `f₀/Q`, so **Q ≈ 7.5 is roughly one ERB at 1 kHz**, and anything substantially narrower is operating below the ear's resolution.

This is a *supporting* argument for the existing low-Q default, not a new clamp, and it must not be over-read: an ERB is the auditory filter's bandwidth, not a hard audibility threshold for a spectral feature, and narrow high-Q *resonances* in a transducer are genuinely audible (`TRANSDUCERS.md` §1.1) which is exactly why narrow corrective filters have a legitimate use. The honest statement is that **broad moves act across many auditory filters and narrow ones act within one**, which is why broad colourations are the ones a listener notices over a whole album — and why `SOURCES.md`'s "broader beats narrower" ruling is right for *voicing* while narrow filters remain correct for *named resonances*.

---

## 2. Equal-loudness contours — why level changes tonal balance

**Suzuki, Y., Takeshima, H. & Kurakata, K. (2024). "Revision of ISO 226 'Normal Equal-Loudness-Level Contours' from 2003 to 2023 edition: The background and results." *Acoustical Science and Technology* 45(1). doi:10.1250/ast.e23.66.** `[VA]` — peer-reviewed invited review by the ISO 226 project leaders themselves; free, permanently hosted on J-STAGE.

Verbatim:

> "The loudness level of a sound is defined as the sound pressure level of a 1-kHz pure tone that sounds equally loud."

> "The differences from the 2003 edition are only 0.6 dB at most, and the 2023 standard can be regarded as the same as the 2003 edition in terms of practical use."

> "the experimental equal-loudness level values used to derive ELLCs typically have a standard deviation of about 5–6 dB."

That last figure is the important one for us and it is a **humility constraint**: the underlying data behind the canonical equal-loudness curves carries a 5–6 dB standard deviation across listeners. Any claim the tuner makes about how loudness affects a particular user's perceived balance is downstream of that spread.

**The contour table itself was not obtained.** The paper does not print it; ISO 226 is paywalled `[S]` (scope confirmed from ISO's own catalogue: "combinations of sound pressure levels and frequencies of pure continuous tones which are perceived as equally loud", free progressive plane wave, frontal, binaural, "otologically normal persons in the age range from 18 years to 25 years inclusive"). **The commonly quoted "bass rises N dB between 60 and 80 phon" figure is therefore NOT sourced here and must not be stated.** Reading it off a graph was explicitly refused.

Fletcher & Munson (1933) `[VA]` is free and citable for the origin — *Bell System Technical Journal* 12(4), 377–430, full text at archive.org — but the archived text is OCR of a 1933 scan and **no contour numbers have been transcribed from it.**

---

## 3. Level matching in listening comparison

**Recommendation ITU-R BS.1116-3 (02/2015)** `[VA]` — standards-body, free.

**Finding: BS.1116-3 contains no numeric level-matching tolerance.** There is no "0.2 dB" anywhere in the document. What it mandates is *subjective* loudness matching by an expert panel:

> "For the purpose of preparing subjective comparison test tapes, the loudness of each excerpt needs to be adjusted subjectively by the group of skilled subjects prior to recording it on the test media."

> "For all test sequences, therefore, the group of skilled subjects shall convene and come to a consensus on the relative sound levels of the individual test excerpts."

> Headphones specifically: "The level should be adjusted in such a way that a loudness equal to the reference sound field produced by loudspeakers is achieved."

BS.1534-3 (MUSHRA) `[VA]` carries the parallel sentence, same pattern, also with no dB tolerance found.

**Consequence for the tuner.** Any EQ change alters perceived loudness, and the loudness change biases the user's own A/B judgement of the tonal change. The standards do not offer a numeric tolerance to appeal to; they mandate deliberate level matching by trained listeners. The tuner's headroom recompute (`SOURCES.md` §1.1, Guardrails) is the closest thing it has to this discipline, and it is doing gain-staging, not loudness matching — those are different things and should not be conflated in user-facing copy.

---

## 4. Resonance audibility — the primary, and what it settles

> **Revised 2026-07-25, second pass.** An earlier version of this section demoted two figures to `[X]` on the grounds that three automated routes had failed to reach Toole & Olive (1988). The paper was then obtained by hand and **one of the two figures is the authors' own summary item.** The demotion was a reasoning error — failure to retrieve is evidence about the fetcher, not about the claim — and it is recorded at `SOURCES.md` §2.5 finding 2 rather than quietly deleted. The material below is now read from the primary.

### 4.0 The numbers, from the primary `[V]`

**Toole, F. E. & Olive, S. E. (1988). "The Modification of Timbre by Resonances: Perception and Measurement." *JAES* 36(3), 122–142.** Read in full from a hand-fetched PDF. *(The text layer is a font subset with no Unicode map — `pdftotext` yields garbage. Read the rendered pages.)*

The authors' summary of audibility without time delay, §6 p. 138, items 1, 2 and 5 verbatim:

> "1) Low-*Q* resonances, producing broad peaks in the measurements, are more easily heard than high-*Q* resonances producing narrow peaks of similar amplitude.
> 2) The detectability of resonances decreases approximately 3 dB for each doubling of the *Q* value. […]
> 5) The duration of ringing is itself an unreliable indicator of the audibility of these resonances."

**The threshold tolerances, §4.1 p. 134** — amplitude response at threshold for the *least* revealing programme material (popular music):

| Q | Tolerance at threshold |
|---|---|
| 1 | ± 1.5 dB |
| 10 | ± 3 dB |
| 50 | ± 5 dB |

Verbatim: "the *Q* = 1 response curve is about ± 1.5 dB, the *Q* = 10 curve is ± 3 dB, and the *Q* = 50 curve is ± 5 dB."

Expressed against programme spectrum level instead, p. 124: "A resonance with *Q* = 1 […] can be heard in noise when its maximum steady-state level is 25 dB below the spectrum level of the program, while one with *Q* = 50 can approach to within 10 dB […] before being heard."

**Programme material dominates**, p. 123: "All resonances were most easily heard with white noise as a test signal, with reduced sensitivity when using classical (symphonic) music, and much reduced sensitivity when using popular music." Our users listen to music. Noise-derived thresholds are lower bounds.

**Peaks beat dips**, p. 123, summarising Bücklein: "peaks in the frequency response are more easily heard than the equivalent dips, and that both peaks and dips become more audible as their width increases."

**Magnitude, not phase, and not ringing duration**, p. 124: "the amplitude response appears to be more directly related to the audible effect"; and p. 135: "it is the *initial* amplitude, not the duration, of the ringing that is related to the auditory detection process."

### 4.1 Corroboration from the free 2015 review

**Toole, F. E. (2015). "The Measurement and Calibration of Sound Reproducing Systems." *JAES* 63(7/8), 512–541.** `[V]` — peer-reviewed, free, read in full. Cites Toole & Olive (1988) as its reference [25] throughout, making it the best available proxy for that paywalled primary.

Directly supporting the low-Q voicing ruling:

> "it is the spectral bump that is the most reliable indicator of audibility. The low-Q resonance will be the dominant audible problem because its amplitude is many times the detection threshold [25]. The other resonances, though, are likely above the threshold of detection for complex music."

and on broadband deviations:

> "Both of these deviations are above audible thresholds for broadband (low-Q) spectral deviations [25]."

On the state of target-curve agreement, which bears on §5 below:

> "To date there is some evidence of agreement that the target curve should exhibit a downward slope over at least a portion of the frequency range. Most combine flat, tilted, and curved portions. None have yet involved a target that rises towards high frequencies."

### 4.2 What remains unsourced

**The "5 kHz, Q = 1, ~0.25 dB with pink noise" figure is not in the 1988 paper.** It was carried at `[S]` on the strength of search-summary text; two research lanes never found it in any fetched artefact, and reading the primary in full did not turn it up. **It is unsourced. Do not state it.** The paper's own numbers (§4.0) are better anyway, because they are expressed against programme spectrum level and against Q rather than as a bare absolute.

**Bücklein (1981)**, *JAES* 29(3), 126–131 — still `[X]`, AES paywall. Its peaks-versus-dips finding is nonetheless usable at one remove, because Toole & Olive summarise it directly in a paper we have read in full (§4.0). Its own dB thresholds remain unobtained.

### 4.3 Spectral tilt and ripple — the shelf-move evidence `[V]`

**Moore, B. C. J. & Tan, C.-T. (2003). "Perceived naturalness of spectrally distorted speech and music." *JASA* 114(1), 408–419.** DOI 10.1121/1.1577552. Hand-fetched; clean text layer; read directly. Peer-reviewed, and the closest thing in the literature to a *tilt* threshold — which matters because **every shelf move the tuner makes is a tilt.**

Method: 168 filter conditions, ten listeners, naturalness rated 1–10, levels "adjusted to give approximately equal loudness in all conditions" (note the level-matching discipline, §3). Reliability is high — the cross-session correlation was "0.97 for music and 0.97 for speech", and music-versus-speech agreement was 0.96.

**Tilts are specified in dB/ERB_N, not dB/octave.** Conditions were ±0.1, 0.2, 0.5 and 1 dB/ERB_N, applied either wide-range (87–6981 Hz ≈ 3–32 ERB_N) or over one of three subranges. **Converting before use is mandatory:** the wide range spans ~29 ERB_N, so 0.1 dB/ERB_N ≈ 2.9 dB end-to-end and 1 dB/ERB_N ≈ 29 dB end-to-end. A "1 dB/ERB_N tilt" is an enormous move, not a subtle one.

Findings, from §V Conclusions and §III.B verbatim:

* **Direction does not matter.** "The effects were similar for positive and negative tilts"; the ANOVA main effect of tilt direction "was not significant" for either music or speech.
* **Extent matters more than location.** Wide-range tilt scored 5.8 (music) / 5.7 (speech) against 7.2–7.8 for the subranges. The authors attribute this to end-to-end level difference: "for a fixed tilt value in dB/ERB_N, the difference in level between the start and end of the tilt was greater" over the wide range.
* **High-frequency-only tilt is nearly free.** Tilts "restricted to the high-frequency range (2503–6981 Hz) have relatively little perceptual effect, until they are rather extreme."

**On ripple — correcting a misreading of the abstract.** An earlier draft of this file said ripple denser than 0.2 ripples/ERB_N "stops degrading quality further", implying a ceiling. The full text says the opposite of a ceiling: **0.2 ripples/ERB_N is the *worst* density, and denser ripple is less damaging.** Verbatim: "naturalness at first decreased with increasing ripple rate, but then increased again." Mean ratings for music at 0.05 / 0.1 / 0.2 / 0.5 ripples/ERB_N were **6.8, 6.1, 5.5, 6.2**; for speech, 7.2, 6.3, 5.7, 5.9.

Two calibrating remarks from the authors, worth keeping because they place our own use case: a 5 dB peak-to-valley ripple is what "occur[s] quite commonly in the frequency response of good-quality transducers" and has "only a moderate effect on perceived naturalness"; a 10 dB ripple is "the kind of spectral ripple that might be found in the response of lower-quality transducers, such as those in medium quality headphones."

**Bandwidth thresholds**, from the Conclusions — useful because they bound where extension stops paying: for music, little effect raising the lower cutoff from 55 to 123 Hz "but further increases led to a degradation", and little effect lowering the upper cutoff from 16 854 to 10 869 Hz "but further decreases led to a degradation."

### 4.4 Still not obtained

A published just-noticeable difference for **broadband level**. Zeng (2020, *Frontiers in Psychology*, open access) `[VA]` gives near-miss exponents (α = −0.03 broadband noise, −0.09 for a 1 kHz tone) but not the plain dB figure. The commonly cited "~1 dB" was never traced to a fetched artefact and is **not** stated here.

A lead surfaced in Moore & Tan's reference list and not yet pursued: **Bech, S. (2002), "Requirements for low-frequency sound reproduction, Part I: The audibility of changes in passband amplitude ripple and lower system cutoff frequency and slope," *JAES* 50, 564–580** — by title, the most directly on-point source yet identified for ripple audibility thresholds.

---

## 5. The practical floor: three independent lower bounds

The tuner should know how small a move can be before it is indistinguishable from noise — not the ear's noise, but the *system's*. Three independent bounds converge, and none of them is a psychoacoustic threshold:

| Bound | Value | Source | What it limits |
|---|---|---|---|
| **Measurement reseat variance** | up to **2 dB** σ, 500 Hz–5 kHz, worse outside | Struck / CJS Labs `[VA]` (`TRANSDUCERS.md` §3.1) | The AutoEq curve being amended |
| **Coupler validity ceiling** | **8 kHz** qualified, **10 kHz** confidence floor | B&K, COMSOL, audioXpress `[VA]` (`TRANSDUCERS.md` §4) | Where the curve means anything at all |
| **Practitioner move size on a finished master** | **1–3 dB**, broad Q, cut-preferred | four independent mastering sources `[VA]` (`SOURCES.md` §7) | What a competent human would do |
| **Equal-loudness data spread** | **5–6 dB** σ across listeners | Suzuki et al. 2024 `[VA]` (§2) | How confidently level-dependence can be claimed |

**The synthesis worth carrying into the system prompt.** For an over-ear, a correction smaller than ~2 dB in the midrange sits inside the reseat noise of the measurement its baseline came from, and any correction above 8 kHz sits above the frequency where that measurement was qualified. That does not make such moves wrong — the user's ears are the authority, and a sub-2 dB move they can hear is a real move. It makes **confident numerical narration** of such moves wrong. The tuner may make a 1 dB change; it may not imply that 1 dB is precisely resolved by the data underneath it.

This is also the honest frame for the project's **±6 dB per-turn policy** (`SOURCES.md` Guardrails). That figure is provenanced to AutoEq's `DEFAULT_MAX_GAIN`, i.e. to a tool correcting a *transducer*. Every mastering-stage source found says 1–3 dB for voicing a *finished master*. Both are right about their own job, and our chain does both at once — the policy is not wrong, but it should be understood as a transducer-correction envelope being used for voicing, not as a voicing convention.

---

## 6. Open

- **Toole & Olive (1988) full text** — the single highest-value outstanding item in the whole research base, since the Q-audibility numbers in §4.2 rest on it. Free at pearl-hifi.com; 403 to this fetcher; a browser would likely get it.
- **Bücklein (1981)** dB thresholds for peaks versus dips — paywalled.
- **Moore & Tan (2003)** full text — the tilt-JND question.
- **Broadband level JND** from a fetchable open-access artefact.
- **ISO 226 contour values** — the numeric table. `iso226.m`-style third-party transcriptions of the α_f / L_U / T_f parameter tables exist and would be citable at `[S]` with the chain stated; not yet captured.
- **Upward spread of masking** with numbers — Zwicker & Fastl is the textbook home; free lecture-note and MPEG psychoacoustic-model reproductions were not reached.
- **Olive, Schuck, Sally & Bonneville (1994)**, "The Effects of Loudspeaker Placement on Listener Preference Ratings", JAES — paywalled. *(Authorship corrected: an earlier research brief mis-attributed this to Olive/Toole/Welti.)*
