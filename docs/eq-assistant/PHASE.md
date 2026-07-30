# PHASE.md — what phase does on this chain, and who can hear it

Companion to `SOURCES.md` (citations), `PSYCHOACOUSTICS.md` (magnitude thresholds), `FILTER-MATH.md` (the biquad arithmetic), `PRIMER.md` (feature contract), `HEARING.md` (the listener), `docs/crossfeed-math.md` (the M/S transform). Compiled 2026-07-26.

**Verification legend** — as `SOURCES.md`, plus `[VA]` = read by a delegated research agent that returned verbatim quotes and a URL or page number (same artefact class as `[V]`; the difference is who read it). Figures computed by us are labelled **derived** in place and are never presented as source claims.

This document answers four questions, in the order an agent needs them:

1. Is the phase shift of an EQ band something the tuner *chooses*? (No — §1.)
2. How much phase and group delay does our actual chain produce? (§2.)
3. Is that audible? (§3, §4.)
4. Where does phase stop being a non-issue? (§7 asymmetry, §8 crossfeed.)

**The headline, and it is a correction rather than a confirmation.** The research base previously justified magnitude-only evaluation by citing Moulana (1975) at one remove through Toole & Olive. We now have the primary, and **there was no phase experiment in it** (§6). The magnitude-only architecture is still right, but for two better reasons that were never written down: a minimum-phase filter's phase is not an independent choice (§1), and our chain's measured group delay sits under every published audibility threshold (§4).

---

## 1. Phase is not a lever — the structural answer

HQPlayer's `iir:type=peak|lshelf|hshelf` stages are RBJ-cookbook biquads (`FILTER-MATH.md` §1), and those are minimum-phase — `FILTER-MATH.md` §2 already quotes Orfanidis on the peaking form: "the transfer function (20) is a minimum phase transfer function, so that both H(z) and its inverse 1/H(z) are stable and causal." That property is the definition, and it holds for cuts as well as boosts.

**For a minimum-phase system the phase is entailed by the magnitude.** MIT OCW 6.341 *Discrete-Time Signal Processing* Lecture 3 `[VA]`, keyed to Oppenheim/Schafer §5.5–5.6, verbatim:

> "Generally, several different systems can have different phase responses and yet have the same magnitude response. However, for a minimum-phase signal h[n], the frequency response can be uniquely recovered (to within a sign change) from the magnitude alone. This also means that you cannot specify both magnitude and phase independently for a minimum-phase system."

The mechanism, from Smith, J. O. III, *Introduction to Digital Filters with Audio Applications* (CCRMA, free) `[VA]`: "for minimum-phase spectra, the cepstrum is causal, and this means that the log-magnitude and phase form a Hilbert-transform pair." The classical continuous-time form is Bode's gain-phase relation, stated in MIT OCW 16.06 Lecture 23 `[VA]` as "For any stable, minimum phase system, the phase of G(jω) can be determined uniquely from the magnitude of G(jω)", with the integral and its weighting kernel `W(u) = log(coth(|u|/2))`; the same lecture notes that "92% of area of W(u) is within ±1 decade of the center", which is what makes the relation locally usable rather than only globally true. Åström & Murray, *Feedback Systems* §9.4 `[VA]` gives the same integral. (**Errata note:** the 2006 pre-publication draft of Åström & Murray follows the correct statement with a sentence saying "left half plane" where it must read *right*. Cite the correct sentence, not the one after it.)

**So there is no phase/magnitude trade to make, and nothing for the tuner to decide.** Choosing `f`, `g`, `q` fixes the phase response completely. A model asked "could you get this magnitude with less phase shift?" must answer no — not as a policy, as arithmetic.

**Two corollaries the tuner should know:**

* **Our EQ is already the minimum-dispersion realisation.** MIT 6.341, same lecture: "among all causal systems with the same frequency response magnitude, the minimum-phase one has the smallest group delay at all frequencies." A linear-phase EQ producing the same curve would have *more* delay, not less, and would add pre-ringing.
* **EQ cannot pre-ring.** A minimum-phase filter's energy all arrives after the excitation, so every EQ band's ringing is post-transient. Pre-echo is available only from the oversampling filter (`PRIMER.md`, "Advising on things it cannot change"), never from a band. Do not let a filter-phase conversation migrate into an EQ one — see §9.

**Cascade behaviour.** Kabal, P. (2011), *Minimum-Phase & All-Pass Filters*, McGill technical report, CC-BY `[VA]`: "The phase response for the overall filter is the sum of the phases for each section." A cascade of minimum-phase sections is itself minimum-phase — this follows immediately from the zeros-inside-the-unit-circle definition and from Smith's statement that minimum-phase filters form a group under convolution, but **no source we reached states it in those words**; treat it as an entailment, not a quotation.

**Load-bearing caveats, all quoted in the lane report:** the decomposition requires causal, stable, and **no zeros on the unit circle** (Smith; Kabal keeps a separate `B_uc(z)` factor for them and states "A system with a zero on the unit circle is not strictly minimum-phase"); recovery of the response from the magnitude is only "to within a sign change"; and Bode's integral formally needs the log-magnitude slope at all frequencies. None of these is violated by an RBJ peaking or shelving section at audio gains.

**Not obtained:** Bode (1940, 1945) themselves — no free copy reached, so **no page citations to Bode**. Oppenheim & Schafer directly — only OCW material keyed to it.

---

## 2. How much phase, and how much group delay — derived

**Method.** Group delay computed exactly as `τ(ω) = −[Im(N′/N) − Im(D′/D)]/f_s` on the RBJ coefficients of `FILTER-MATH.md` §1.3, where `N` and `D` are the numerator and denominator evaluated at `z = e^{jω}`. No phase unwrapping is involved, so there are no unwrap artefacts. All figures **derived** by us at `f_s = 44100` unless stated; 600-point log grid, 20 Hz–20 kHz.

### 2.1 Phase deviation depends only on gain

A peaking band's phase is **exactly zero at its centre frequency**, and swings to equal and opposite extrema either side of it. The size of that swing is `atan(A) − atan(1/A)` where `A = 10^(g/40)` — **Q and centre frequency drop out entirely.**

| band gain | max phase deviation |
|---|---|
| ±1 dB | 3.3° |
| ±3 dB | 9.9° |
| ±6 dB | 19.4° |
| ±12 dB | 36.8° |

Derived analytically and confirmed numerically: the figure is identical across every Q from 0.5 to 5.75 and every centre frequency from 60 Hz to 8.8 kHz. **Q decides where the phase swings and how wide the swing is in frequency; gain alone decides how far.**

### 2.2 Group delay scales as Q/f₀

The opposite dependence. At ±6 dB, peak group delay is well approximated by **τ_peak ≈ 0.225·Q/f₀ seconds**, and it changes sign with the sign of the gain (a boost delays, a cut advances, at the centre).

| f₀ | Q 0.7 | Q 1.0 | Q 1.42 | Q 2.5 | Q 4.0 | Q 5.75 |
|---|---|---|---|---|---|---|
| 60 Hz | 2722 µs | 3808 µs | 5354 µs | 9366 µs | 14967 µs | 21467 µs |
| 120 Hz | 1361 µs | 1904 µs | 2678 µs | 4685 µs | 7478 µs | 10703 µs |
| 1 kHz | 164 µs | 229 µs | 322 µs | 564 µs | 901 µs | 1293 µs |
| 3 kHz | 56 µs | 78 µs | 110 µs | 193 µs | 308 µs | 439 µs |
| 8.8 kHz | 24 µs | 34 µs | 48 µs | 84 µs | 134 µs | 192 µs |

The `0.225·Q/f₀` law is good to a few percent below about 3 kHz (predicted 225 µs against 229 µs measured at Q 1 / 1 kHz; 75 µs against 78 µs at 3 kHz) and then runs low as bilinear prewarping stretches the response — 26 µs predicted against 34 µs measured at 8.8 kHz. Use the table near Nyquist, the law below it.

Gain dependence of the delay, at f₀ = 1 kHz and Q 1: 38 µs at ±1 dB, 113 µs at ±3 dB, 229 µs at ±6 dB, 483 µs at ±12 dB — i.e. proportional to `A − 1/A`, not to gain in dB.

**One asymmetry worth naming.** At Q ≲ 0.5 a boost's largest group-delay excursion is a *negative* one lying well below f₀ rather than the positive peak at f₀ (at f₀ = 1 kHz, Q 0.5, +6 dB: +122 µs at the centre but −223 µs at the bottom of the grid). Broad bands advance the far low end. Report the swing, not one side of it.

### 2.3 Shelves, Q 0.70

| stage | peak group delay | max phase |
|---|---|---|
| `lshelf f=105 g=+6.4` | 1064 µs at 49 Hz | 29.1° |
| `hshelf f=10000 g=-2.1` | 3.6 µs at 6.2 kHz | 9.7° |
| `hshelf f=700 g=+6.0` | −150 µs at 326 Hz | 27.3° |

### 2.4 The real chain

Measured on the shipped oratory1990 **Sennheiser HD 650** `ParametricEQ.txt` — the same 10-band preset `SOURCES.md` §1.1 verifies the headroom rule against (largest band +6.4 dB, `Preamp: -6.1 dB`).

| chain | τ max | τ min | 300 Hz–1 kHz spread | max phase |
|---|---|---|---|---|
| HD 650, 10 bands | 4061 µs @ 37 Hz | −764 µs @ 133 Hz | **156 µs** | 34.0° @ 83 Hz |
| + crossfeed compensation, 100 % | 4008 µs @ 37 Hz | −816 µs @ 133 Hz | **183 µs** | 32.4° @ 82 Hz |
| compensation alone | 11 µs @ 1057 Hz | −54 µs @ 42 Hz | 40 µs | 6.5° @ 643 Hz |

Compensation shelves taken from the shipped implementation (`fitComp(700, 4.5)` in `hqptuner/static/lib/xfeed.js`): `hshelf f=378 q=0.575 g=+0.904` and `hshelf f=803.3 q=0.668 g=+0.904`, max fit error 0.0125 dB.

**Rate independence.** Recomputing the whole cascade at `f_s = 192000` moves every figure by ≤ 2 µs. In-band group delay is a property of the parametrics, not of the sample rate — which matches `docs/crossfeed-math.md`'s treatment of the analog-prototype math as rate-independent.

**Where the delay lives:** almost all of it is the low bass, and it is dominated by the two highest-Q low-frequency stages (the Q 3.96 band at 37 Hz and the Q 0.50 band at 118 Hz against the 105 Hz shelf). Across the entire midrange the chain is flat to within a sixth of a millisecond.

---

## 3. Audibility thresholds for group delay

### 3.1 The primary `[V]`

**Liski, J., Mäkivirta, A. & Välimäki, V. (2021). "Audibility of Group-Delay Equalization." *IEEE/ACM Transactions on Audio, Speech, and Language Processing* 29, 2189–2201.** doi:10.1109/TASLP.2021.3087969. CC BY 4.0. Read in full from the rendered pages — the PDF's text layer is a font subset with no usable Unicode map.

ABX, twelve usable subjects of thirteen, 80 dB SPL (85 for the unit impulses), **Sennheiser HD-650 headphones** — the same model as the preset measured in §2.4. Group-delay peaks were produced with cascaded allpass pairs, one applied time-reversed to cancel the low-frequency excess so that only a local peak remains, at five centre frequencies with both signs. Threshold criterion is the 75 % point of a fitted sigmoid.

**Table III, verbatim — negative threshold above, positive below, in ms:**

| Signal | 500 Hz | 1 kHz | 2 kHz | 3 kHz | 4 kHz | Mean |
|---|---|---|---|---|---|---|
| Unit impulse | −0.84 / 0.96 | −0.51 / 0.77 | −0.68 / 0.69 | −0.65 / 0.64 | −0.77 / 0.75 | −0.69 / 0.76 |
| Pink impulse | −0.45 / 1.09 | −0.49 / 0.83 | −0.46 / 0.48 | −0.64 / 0.33 | −0.76 / 0.46 | −0.56 / 0.64 |
| Castanet | −1.61 / 3.15 | −0.94 / 2.10 | −2.18 / 1.65 | −1.19 / 1.61 | −1.41 / 1.61 | −1.47 / 2.00 |
| Hi-hat | −1.41 / 2.77 | −0.99 / 4.55 | −2.05 / 3.00 | −2.27 / 1.41 | −2.28 / 2.13 | −1.80 / 2.77 |

Conclusion, verbatim: "the audibility thresholds for local group-delay variation are less than ±1 ms for the most critical signals, and approximately 1.5 ms to 4.5 ms for a local positive group-delay peak and between −1.0 ms and −2.3 ms for a local negative group-delay peak for real-life signals."

Three findings beyond the numbers:

* **Negative group delay is more audible than positive**, and the paper says earlier work "primarily focused on the positive group delay alone." Below 1 kHz especially: "the audibility of group-delay peaks is greater with negative peaks than positive peaks."
* **Signal dominates.** Impulse-like signals give the lowest thresholds; a synthetic hi-hat decaying 60 dB in 80 ms "hides" the variation, and the recorded castanet is harder than the synthetic signals. Music is the forgiving case, exactly as for magnitude (`PSYCHOACOUSTICS.md` §4.0).
* **A useful calibration on the transducer itself:** across three pairs of HD-650, "The group delay varied by ±0.025 ms in the range from 1.5 kHz to 4 kHz and by less than ±0.1 ms below 1.5 kHz."

### 3.2 Prior studies, transcribed numerically by Liski et al.

Liski's Fig. 1 and §I collect earlier thresholds, which is how we have numbers for four artefacts that are otherwise paywalled or figure-only. All are peak group delay in ms, headphones unless stated:

| Study | Thresholds |
|---|---|
| Green | ~2 ms at 625, 1875, 4062 Hz |
| Jensen & Møller | 4.7 / 2.3 / 1.5 / 1.6 / 1.6 ms at 250 / 500 / 800 / 1200 / 2000 Hz |
| **Blauert & Laws** | **3.2 / 2.1 / 0.9 / 1.3 / 1.9 ms at 0.5 / 1 / 2 / 4 / 8 kHz** |
| Deer et al. | 2 ms at 2 kHz |
| Hoshino & Takegahara | 2 ms at 10, 12, 15, 20 kHz |
| **Minnaar / Møller et al.** | **constant +1.5 ms (+1.6 ms as reported in one of the papers) and −1.2 ms** across 1, 2, 4, 8, 12 kHz, causal and non-causal |
| **Flanagan, Moore & Stone** | **~+1.6 ms at all frequencies** over headphones; only slightly higher for loudspeakers in a low-reverberant room |

Also from Liski: "The minimum integration time of the auditory system has been shown to be about 2 ms", which is "of a magnitude similar to many reported group-delay audibility thresholds" — a plausible floor for why the numbers cluster where they do. And Minnaar's mechanism note, which rhymes with Toole & Olive on resonances: it is "the decay of the sinusoidal component in the impulse response" that "determines the perceived difference", not the group-delay peak as such.

### 3.3 Blauert & Laws, from the primary `[VA]`

**Blauert, J. & Laws, P. (1978). "Group delay distortions in electroacoustical systems." *JASA* 63(5), 1478–1483.** The publisher PDF is 403; a complete scanned reprint was read in full by a delegated lane.

Their untrained thresholds appear only as a graph (Fig. 7), and Liski's transcription above is the citable numeric form. What the primary adds:

* **Training collapses the threshold.** One subject at a 4 kHz peak: "we found a reduction in threshold values from 0.86 to 0.54 ms, and in the following session the asymptotic value of 0.4 ms has already been reached." Trained-panel results: 1.1 ms for a loudspeaker-like pattern, and "a group delay difference (peaks to valleys) of about Δτg = 0.5 ms" for an earphone-like one.
* **Monaural and diotic presentation do not differ**: "Differences for monotic and diotic presentation are not significant."
* **Impulses are the critical signal**: "the highest sensitivity of the ear for group delay distortions can apparently be found with brief sound impulses under anechoic conditions."
* Their own verdict on real transducers: the excess allpass group delay of common loudspeakers and earphones is "on the order of 400 μs", and "these additional group delay distortions need not be corrected in most practical cases."

### 3.4 The loudspeaker bracket `[VA]`

**Liski, J., Mäkivirta, A. & Välimäki, V. (2018). "Audibility of Loudspeaker Group-Delay Characteristics." AES 144th Convention, Milan, 879–888.** Read in full by a lane. Loudspeaker impulse responses and their time-reversed versions, chosen "in order to maximize the change in the temporal structure and group delay without affecting the magnitude spectrum". n = 5.

> "Our results suggest that when the group delay in the frequency range from 300 Hz to 1 kHz is below 1.0 ms, it is inaudible. With low-frequency emphasis, the group delay variations can be heard more easily."

Bracketed: below 1.0 ms inaudible, 1–2 ms "sometimes audible", above 2.0 ms "mostly audible".

### 3.5 A disagreement, recorded rather than resolved

Whether phase distortion is more audible on headphones than loudspeakers is **not settled**, and our chain is headphones-only, so it matters.

* Liski et al. 2021 `[V]`: "even though group-delay distortion is often reported to be more easily audible with headphones than with loudspeakers […] contradicting results have also been reported. Bech's results showed no significant difference between the two reproduction methods."
* Flanagan, Moore & Stone, via Liski: headphone and low-reverberant-loudspeaker thresholds about the same.
* An Aalborg University student report, *The Influence of Phase Distortion on Sound Quality* (group 07gr1064) `[S]` — a secondary review, read directly — summarises the opposite consensus: Hansen & Madsen (1974) "showed that phase differences are more audible with headphones than with loudspeakers in semireverberant rooms", Fleischer (1976) found thresholds "2.3 times higher" in a reverberant room than anechoic, and Suzuki et al. found "lower audibility thresholds when using headphones". Note Liski cites Hansen & Madsen as *contradicting* the headphones-are-worse claim, so the two reviews read the same authors oppositely. Neither reading is adopted here.

The safe statement: **reverberation reduces sensitivity to phase distortion, and headphones therefore represent the worst case or a tie — never the forgiving case.** Anything stronger is unsupported.

Also from that review, and worth having because it is the phase-domain mirror of the low-Q resonance ruling: **Banno et al. (2002)** are reported to have shown that "the auditory system is less sensitive to group delays with a narrow bandwidth" `[S]`. If that holds, the high-Q bands that produce our largest delay spikes produce the *least* audible kind. The primary has not been obtained and the citation is incomplete — see §10.

---

## 4. The verdict for this chain

Set §2.4 against §3, and the answer is not close.

* **Midrange: about 2× under the most sensitive published figure.** The HD 650 chain varies its group delay by **156 µs** across 300 Hz–1 kHz. The smallest threshold anywhere in Liski's Table III is **+0.33 ms** (pink impulse, 3 kHz); the smallest *negative* one is −0.45 ms (pink impulse, 500 Hz), and the lowest anywhere in §3.2 is 0.9 ms. Against real music signals (castanet, hi-hat: 1.4–4.6 ms) the margin is ten- to twenty-fold.
* **It is the same order as the headphone's own unit-to-unit variation.** Liski measured ±0.1 ms below 1.5 kHz between three pairs of HD-650. The entire EQ chain's in-band dispersion is comparable to the difference between two copies of the headphone it is correcting — the same framing `PSYCHOACOUSTICS.md` §5 applies to magnitude via reseat variance.
* **The exception is the bass, and it is nearly unmeasured territory.** The chain reaches **4.06 ms at 37 Hz**. Liski's own experiment measured nothing below 500 Hz, and the only published threshold below it anywhere in §3.2 is Jensen & Møller's 4.7 ms at 250 Hz. The trend runs in our favour — thresholds rise steeply as frequency falls — but extending a single 250 Hz datum to 37 Hz is **extrapolation, and must be labelled as such rather than asserted.**
* **Adding crossfeed compensation changes nothing perceptually.** It contributes 40 µs of the 183 µs midrange spread and 6.5° of phase.

**What the tuner should do with this.** Nothing, in the ordinary case — and that is the point. Phase and group delay are not to be narrated to the user as a consequence of an EQ move, for the same reason the crossfeed centre tilt is not (`PRIMER.md`, "The tilt, and its direction"): the effect is real, computable, and below the threshold of the least forgiving signal anyone has tested. The two places it stops being a non-issue are **channel asymmetry** (§7) and **the oversampling filter**, which is a different subsystem (§9).

If a user asks directly — a `discuss` turn — the honest answer carries `basis: "measured"` when it quotes §2 arithmetic, and `basis: "mechanism"` when it explains §1. It must not claim the question is settled below 500 Hz.

---

## 5. Constant delay is not group-delay variation

Two things get conflated, and only one matters.

* **Constant delay** — the whole signal arrives later. Inaudible by construction: with no simultaneous reference, a listener has nothing to compare it against. This is what HQPlayer's `output_delay` and the `delay:` stage carry, and what a linear-phase filter's latency is.
* **Group-delay variation, or dispersion** — different frequencies arrive at different times, so the waveform changes shape. This is the only quantity §3's thresholds are about, and every one of them is specified as a *peak* or a *peak-to-valley difference* relative to the surrounding frequencies.

Liski et al. 2021 build their test stimuli specifically to isolate the second from the first — the time-reversed second filter exists to "cancel the delay at other frequencies" so that only a local peak remains. Their earlier Fig. 4(a) shows why it is necessary: a bare second-order allpass giving a 0.62 ms peak at 980 Hz also raises the delay to "approximately 0.27 ms at 10 Hz", which is a constant offset in-band and not the thing under test.

**For the tuner:** report spread, never absolute delay. A chain whose group delay is 4 ms everywhere is inaudible; one that varies by 4 ms across an octave may not be.

---

## 6. Moulana 1975 — the citation that justified magnitude-only, corrected `[VA]`

**Moulana, K. (1975). "Tonal Colouration Caused by a Single Resonance." PhD thesis, University of Surrey.** 456 pages, CC BY-NC-SA, obtained from Surrey Open Research and read by a delegated lane. This is Toole & Olive's reference [6], and `SOURCES.md` §2.5 finding 6 rests on it at one remove.

**What he actually says**, §8.4.5, p. 8.54, verbatim:

> "since the phase/frequency response of a parallel resonant system, as shown in some of the graphs of Section 3, exhibits local irregularities in the vicinity of the resonance frequency, one might expect these local irregularities to be another elementary cause of colouration. However, in view of the fact that the results of the present investigation have been satisfactorily explained in terms of the other elementary causes of colouration, one can safely assume that the subjective effect of these local irregularities is negligible if not absent in the first place."

That paragraph is the *discharge* of an assumption, not the whole of it. Phase enters the thesis at three points and never becomes a result: it is **posted as an assumption** at p. 8.3 — "It is assumed that these colourations are caused by the humps and dips which exist in the overall amplitude/frequency response of the system, and that local irregularities which exist in the overall phase/frequency response of the system do not have a significant influence. It will become clear in due course that this assumption is valid." — **re-flagged** at p. 8.32 as one of the factors "which will be discussed later", and **discharged** in the paragraph above. **It does not appear in his Conclusions (§8.6) or in his Further Investigation (§8.7) at all.** Every other occurrence of the word in the thesis is a switch-state label (`in-phase` / `anti-phase`), a plot title, a symbol-list entry, the §3 algebra where θ is a free parameter, or Appendix 1's phase-splitter transistor.

**Toole & Olive quote him accurately and use him too strongly.** State it this way, not more harshly and not less:

* **There was no phase experiment.** The conclusion is an argument from explanatory sufficiency — the magnitude account already fit, so the phase irregularity is assumed inert. Nothing held magnitude constant while varying phase.
* **His two "phase conditions" alter the magnitude.** A single switch selects θ = 0 or θ = π for summing the resonant arm, which turns a hump into a dip and adds a low-to-high-frequency step. No intermediate phase was ever presented, so phase and magnitude are confounded in every trial.
* **He treated the magnitude-only account as a hypothesis, not a result.** Testing whether a hump plus a compensating dip cancels is listed as *future work*.
* **He needed a mechanism magnitude cannot represent.** Driven-state loudness alone did not predict his data, and he closes the gap with an **inter-state frequency (pitch) shift** from the drive frequency toward the resonator's natural frequency — a time-domain effect, maximal around 250–400 Hz, with no counterpart in a magnitude curve. That range is our compression of two figures he states separately: p. 8.30 puts the greatest subjective influence "in the locality of 400Hz", and Conclusion 6 (p. 8.59) names "the range 125 to 500Hz approximately, and in particular, in the region of 250Hz". Toole & Olive relay the same finding at p. 124 — "pitch shift, an interstate coloration, tends to be most audible in the frequency range between 125 and 500 Hz" — as their summary of Moulana, not as an independent result. **This is the one real blind spot of a magnitude-only evaluator, and it is the same region as the vocabulary's warmth/mud/boxiness cluster.**

**What survives, and it is worth having.** His panel was eight to nine BBC Research Department engineers, deliberately sensitised to the resonance frequency beforehand, rating a coloured excerpt against its own uncoloured version on an 11-point scale — an upper bound on sensitivity, not a typical listener.

* **Peak-height detection threshold: 1 dB to 2.7 dB for Q 6–25 over 200 Hz–2 kHz** (p. 8.29). Compare Toole & Olive's ±1.5 dB at Q 1 (`PSYCHOACOUSTICS.md` §4.0) — consistent, and independently derived.
* **Threshold rises with Q**, i.e. high-Q resonances are harder to hear, matching Toole & Olive's 3 dB per doubling. At 2 kHz his threshold dilution runs from about −20 dB at Q 3 to about −7 dB at Q 200.
* **Programme ordering matches ours**: "pink noise mainly reveals the driven-state colourations … while speech tends to be more critical in revealling the transient-state and inter-state colourations … music appears to occupy an intermediate position which is noticeably biased towards that of speech."
* **A hard floor on ringing:** "When Q ≤ ½, the decay is non-oscilatory, and hence, there cannot be any transient-state colourations."
* **Amplitude governs, duration modulates** — his own account has initial amplitude `|R₀|` as the criterion variable, with longer decay (higher Q) lowering the amplitude at which the decay becomes noticeable. That is the same conclusion `PSYCHOACOUSTICS.md` §4.0 carries from Toole & Olive p. 135, reached independently.
* **Bücklein at one remove, with a number.** `PSYCHOACOUSTICS.md` §4.2 lists Bücklein as `[X]` with "its own dB thresholds remain unobtained". Moulana's review (p. 2.35) supplies one: "at 1kHz a 15dB peak with a bandwidth factor of 0.35 could be noticed by all of his 10 observers, whereas, an equivalent dip could only be noticed by half the subjects." Still secondhand, now at least numeric.

**Do not port his Q to our `q`.** His Q is the isolated resonator's circuit Q in a *parallel-path summing* topology — a resonant arm added to a flat arm — not the composite peak's bandwidth. Q sets the resonator, a separate dilution parameter sets the mix, and the hump's shape depends on both; a mapping through his eq. 3.38 would be required. His low-Q data is additionally contaminated by a broadband step that a peaking section does not have, so his Q 3 results are not single-peak data. He does anchor bandwidth usefully: "a Q of 4·3 corresponds with a resonance bandwidth which is one third of an octave wide."

**Consequence for the research base.** `SOURCES.md` §2.5 finding 6 keeps its `[V]` tag — the quote is verified — but its *weight* is corrected there, and the justification for magnitude-only evaluation now rests on §1 and §4 of this document instead.

---

## 7. Interchannel phase — the one place phase is loud

Everything above is about a phase shift applied **identically to both channels**, which is what the tuner does today. A common-mode phase shift produces no interaural difference at all, and that is why §4's answer is "inaudible". Break the symmetry and the numbers change by an order of magnitude.

**Where asymmetry could come from.** `HEARING.md` §4.3 already states the boundary: "No per-ear control. All four change types are stereo-symmetric." The wire format does not enforce that — `docs/crossfeed-math.md` notes "Per-ear EQ appends to all four rows feeding that ear" in the proposed structural-binaural design — so this section exists to price the capability *before* anything grows it, and to give `clarify`/`recommends` turns about asymmetric hearing a real number to stand on.

**The relevant thresholds** `[VA]`:

* **ITD detection floor.** Thavam, S. & Dietz, M. (2019), *JASA* 145(1), 458: "It is well-established that the smallest discrimination thresholds for interaural time differences (ITDs) are near 10 μs for normal hearing listeners", and their own optimised condition gives "6.9 μs for nine trained listeners and 18.1 μs for 52 un-trained listeners".
* **Phase is time, for steady signals.** Ross, B. et al. (2007), *JASA* 121(2), 1017: "For steady signals, such as pure tones, the ITD is equivalent to the interaural phase difference (IPD)."
* **The frequency ceiling, with mechanism.** Same paper: the behavioural upper limit for IPD detection is "between 1100 and 1300 Hz", their own measured mean 1203 Hz (SD 313 Hz), because "phase locked encoding degrades along the ascending auditory pathway". Above roughly 1400 Hz the system switches to envelope ITD, whose thresholds are an order of magnitude coarser — 60–133 µs in Kanagokar et al. (2024).
* **ILD JND ≈ 1 dB.** Brown & Tollin (2021), *JASA* 149(6): "thresholds in the vicinity of 1 dB ILD for most listeners", rising to ~2.5 dB when the channels are decorrelated at 250–500 Hz. So an asymmetric *gain* is audible too, at about 1 dB.
* **A narrowband interaural phase difference has a timbral consequence, not only a spatial one.** Hancock & Delgutte (2023): a Huggins pitch arises "when the interaural phase changes by 2π radians over a narrow 'transition band'", a binaural edge pitch when it changes by π, and "monaural inputs to either ear alone do not produce a pitch percept". A frequency-confined interaural phase gradient is heard as a faint tone that is not in either channel.
* **The allpass literature already separates the two failure modes.** The Aalborg review `[S]` reports that Møller, Minnaar et al. found **two distinct thresholds — ringing and lateralization — the latter arising specifically "when the all-pass section is present in only one ear"**, that the ringing threshold "can be defined as a single value independent of frequency", and that detection is a monaural process. That is exactly the asymmetric-EQ case, named in the literature.

**The arithmetic, derived.** A per-ear band's phase deviation converts to an equivalent interaural time difference as `t = φ / (360·f)`:

| band gain (one ear only) | at 200 Hz | at 500 Hz | at 1 kHz | at 1.4 kHz |
|---|---|---|---|---|
| ±3 dB (9.8°) | 136 µs | 54 µs | 27 µs | 19 µs |
| ±6 dB (19.4°) | 269 µs | 108 µs | 54 µs | 38 µs |

**Every cell is above the 6.9–18.1 µs ITD detection floor, most of them by one to two orders of magnitude, and all of them lie below the ~1200 Hz ceiling where the ear is most sensitive to exactly this cue.** A ±3 dB band applied to one ear at 500 Hz is roughly three to eight times the detection threshold for a lateralization cue.

**Two honest limits on that comparison.** The `t = φ/(360·f)` equivalence is for steady tones (Ross et al. above); a transient's interaural cue is not fully captured by it. And a detection threshold is not a displacement — nothing we reached maps X µs onto Y degrees of image shift, which is a real citation gap (§10).

**The rule this earns.** Symmetric EQ is phase-free in every sense that matters. Asymmetric per-ear EQ is **not primarily a tonal change** — it is a lateralization change with a tonal component, and it moves the image at magnitudes far below where the tonal effect becomes interesting. If per-ear control is ever added, an asymmetric proposal must say so in the same breath as the gain, and the default must stay symmetric. Until then, an asymmetry request is the `clarify` + `recommends` case `HEARING.md` §4.3 already describes — and this section is why that boundary is a good one rather than merely a limitation.

---

## 8. Crossfeed: the phase that must not be corrected

**Verified in the shipped code.** `fitComp()` in `hqptuner/static/lib/xfeed.js` fits its two high shelves to `-centerMagDb(...)`, and its error metric is magnitude in dB. The compensation is a **magnitude-only inverse of the M-path tilt**, realised as two minimum-phase shelves. The M-path phase — and the M-versus-S phase relationship — is left exactly as bs2b produced it.

**That is correct, and it must stay that way.** The interaural phase and time relationship *is* the crossfeed effect. `docs/crossfeed-math.md` makes this explicit for the structural design: the head-shadow filter's group delay deliberately "supplies the low-frequency excess — 135 µs of the 397 µs total", with the `delay:` stage carrying only the high-frequency ray component. Group delay there is a *feature being synthesised*, not an artefact being removed. A future agent that notices the compensation "only corrects magnitude" and sets out to correct its phase as well would be deleting the feature. Do not.

The compensation's own dispersion is negligible on top of that — 40 µs of spread across 300 Hz–1 kHz and 6.5° of phase (§2.4) — so it neither helps nor harms the interaural cue it sits beside.

Keep this distinct from the separate conflation `PRIMER.md` already warns about: crossfeed's summing of correlated low-frequency content raises perceived bass weight, which is neither the mid-path treble tilt nor a phase effect.

---

## 9. Keep the filter axis separate

`PRIMER.md` allows dimensional advice about HQPlayer's oversampling filters, one axis of which is phase: "linear phase puts ringing symmetrically around a transient so energy arrives before the attack; minimum phase moves it all after, at the cost of frequency-dependent group delay."

**That axis is real and it is not this document's subject.** The distinction to hold:

* **EQ bands cannot pre-ring** (§1). Any pre-echo in the chain comes from the oversampling filter, never from a band.
* **EQ group delay is below threshold in-band** (§4). A filter's is a different quantity at a different scale, and near Nyquist the audibility is `contested` — which `filters.json`'s `guidance` block is required to say.
* **The negative rules still apply.** Midrange tonality, nasality and boom are EQ's. A group-delay or phase explanation must not become the escape hatch for a complaint the model cannot otherwise fix; that is the confident non-answer `PRIMER.md` warns against, and §4 is the reason it would be wrong on the numbers as well as wrong in method.

---

## 10. Open

* **No published minimum-phase-versus-linear-phase EQ discrimination test exists.** A dedicated search found none, and Liski et al. 2018's own literature review enumerates the field without one. The adjacent literature answers a different question — how much group delay, however produced, is audible. This is a genuine null result and it is why §1 (entailment) carries the argument rather than an experiment.
* **Only one published group-delay threshold below 500 Hz** — Jensen & Møller's 4.7 ms at 250 Hz (§3.2). Nothing at all below that, which is precisely where our chain's delay lives (§2.4). The single highest-value gap in this document.
* **Banno et al. (2002)** on group-delay peak height versus bandwidth — cited only through the Aalborg review `[S]`; full citation not recovered. Its claim that narrow-bandwidth group delay is less audible would directly license our high-Q bands, so it is worth the fetch. (The paper obtained on 2026-07-26 under this name — Banno et al., *Acoust. Sci. & Tech.* 28(3), 2007, on the realtime STRAIGHT vocoder — is a different work and not relevant.)
* **Møller, H., Minnaar, P., Olesen, S. K., Christensen, F. & Plogsties, J. (2007), "On the audibility of all-pass phase in electroacoustical transfer functions," *JAES* 55(3), 115–134** — AES paywall. Its threshold values are in hand secondhand via Liski §3.2, but the **ringing-versus-lateralization split (§7)** reaches us only through a student review, and that split is load-bearing for the asymmetry rule.
* **"Evaluation of headphone phase equalization on sound reproduction," *Applied Acoustics*** (Southampton eprints 434440) — the only artefact identified that is specifically about headphone phase equalization. Both ScienceDirect and the institutional copy refused automated fetches.
* **Lipshitz, Pocock & Vanderkooy (1982)**, *JAES* 30(9), 580–595 — still `[X]`, AES paywall, and its abstract carries no numbers. The frequently repeated "audible mainly on headphones" summary of it remains **unverified**; §3.5 is the honest state of that question. (`FILTER-MATH.md` §8 carries the same item.)
* **Preis (1982)** *JAES* 30(11) tutorial review — its frequency-dependent group-delay tolerance curve, said to be synthesised from seven perceptual studies, was not obtained.
* **A displacement mapping**, not a detection threshold: nothing found states how far an image moves for a given interaural time difference. Mills (1958) on minimum audible angle would fill it; `pubs.aip.org` refused.
* ~~**Moulana's Section 9 figures** carry two Q-label rows on apparently the same gridlines~~ — **RESOLVED.** They are not on the same gridlines: the lower row is offset by half a division and interleaves with the upper, so the two together form one continuous half-octave logarithmic Q scale — 2, 3, 4, 6, 9, 12, 18, 25, 35, 50, 75, 100, 150, 200 — staggered above and below the axis only so the labels do not collide. The text nowhere explains this. The curves are safe to digitise against the combined scale.
* **The inter-state pitch shift (§6) is unmodelled.** `evaluate_chain` computes magnitude; Moulana's account needs a frequency shift that no magnitude response contains, maximal 250–400 Hz. Nothing in the tuner represents it, and it is not clear anything should — but it should not be forgotten either.
