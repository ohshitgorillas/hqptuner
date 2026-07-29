# Filter guide — researched material for the Resampling tab guidance card

Researched material for a guidance card on HQPTuner's Resampling tab, explaining filter terms in plain English. The manual carries the technical explanations; the card translates them. **Research only** — no card copy ships from this document until implementation is planned separately through the plan gate.

The tab carries two tiers behind a switch: **basic** is plain English with no mathematics as far as possible, **advanced** may carry mathematics and example graphs. Every claim below is tier-tagged `basic` or `adv`.

Glosses are drafts of *meaning*, not final copy. Each is derivable from the claims listed under it and from nothing else.

## Scope

Decisions taken by the user, 2026-07-29. This document is the record; the research plan it came from has been removed.

1. **Four terms only** — Phase, Length, Ringing, Apodizing. Filter *families* (poly-sinc vs sinc vs gauss vs closed-form vs IIR vs polynomial) are out: per-filter prose already lives in `hqptuner/data/filters.json`.
2. **The other narrow-bar facets are out**, judged self-explanatory: Focus, Quality, Ratio, Genre.
3. **These adjacent items are out**: the `-2s` two-stage suffix, the facet-Length vs `fft_size` "Filter length" naming collision, the "Apodizing events" counter, and the 1x-vs-Nx chain split. None are researched and none are flagged — the naming collision is deliberately not raised as a question.
4. **SDM side out** — modulators, integrators, `direct_sdm`.
5. **Descriptive stance** — no audibility verdicts in either direction. State what the filter does; the listener judges.
6. **Audibility material is forbidden outright** — thresholds, listening tests, detection or discrimination figures, masking claims, "inaudible by construction" arguments are not researched, not collected, not summarised, and not carried as background. This is a prohibition on the material, not merely on the copy. Any future research instruction must state it flatly and must not offer a "note that it exists" concession; that concession is what let the material in on the first pass.
7. **Two tiers with a switch**, as above.

## Term inventory

| # | Term | UI surface | Values / strings to explain |
|---|---|---|---|
| 1 | Phase | narrow bar, `hqptuner/static/components/NarrowBar.js:51-56`; parsed from `-lp`/`-mp`/`-ip` name suffixes, `hqptuner/static/store/facets.js:83-89` | Linear / Minimum / Intermediate |
| 2 | Length | narrow bar, `NarrowBar.js:57-62`; tap-count classification `facets.js:104-128` | Short / Medium / Long / Extra long |
| 3 | Ringing | not a chip — vocabulary of the per-filter description rendered inline for the current selection, `hqptuner/static/store/prose.js:48-65` | pre-ringing, post-ringing, passband ripple, stop-band attenuation, roll-off speed, impulse-response length |
| 4 | Apodizing | per-chain 1x control, `hqptuner/static/components/ApodNarrow.js`; live arg bit 0 = apodizing, bit 1 = half | full / half / none |

## 1. Phase

**Gloss draft.** Phase decides where a filter's ringing sits relative to the sound that caused it. Linear phase splits the ringing evenly, so part of it arrives before the attack. Minimum phase moves all of it after the attack, and in exchange delays some frequencies more than others. Intermediate phase is a setting between those two, described by what it produces rather than by what it is.

| claim | tier | tag | citation |
|---|---|---|---|
| A linear-phase FIR produces equal amounts of ringing before and after the transient | `basic` | `[sourced]` | "Note the equal amounts of ``pre-ringing'' and ``post-ringing'' due to the use of a linear-phase FIR filter." — Smith, *SASP* §8.4.1 `[V]` |
| Linear phase's cost is stated by HQPlayer as pre-ringing | `basic` | `[sourced]` | "Good phase response, but has some amount of pre-ringing." — `04-06:102-103` |
| Minimum phase's cost is stated by HQPlayer as an altered phase response | `basic` | `[sourced]` | "Altered phase response, but no pre-ringing." — `04-06:107-108` |
| The axis, stated as a trade in one sentence | `basic` | `[structural]` | "linear phase puts ringing symmetrically around a transient so energy arrives before the attack; minimum phase moves it all after, at the cost of frequency-dependent group delay" — `eq-assistant/PRIMER.md:79`, quoted at `eq-assistant/PHASE.md:282` |
| Minimum phase is the least-group-delay realisation of a given magnitude response | `adv` | `[sourced]` | "among all causal systems with the same frequency response magnitude, the minimum-phase one has the smallest group delay at all frequencies." — MIT OCW 6.341, via `eq-assistant/PHASE.md:32` `[VA]` |
| The symmetry is structural: a linear-phase FIR's impulse response is symmetric and its delay is half its length | `adv` | `[sourced]` | "the impulse response of every causal , linear-phase , FIR filter is symmetric: \[h(n) = h(N-1-n), \quad n=0,1,2,\ldots, N-1.\]" — Smith, *Introduction to Digital Filters* §11.4 `[V]` |
| For a minimum-phase system, phase is not independently specifiable — it follows from magnitude | `adv` | `[sourced]` | "you cannot specify both magnitude and phase independently for a minimum-phase system." — MIT OCW 6.341, via `eq-assistant/PHASE.md:24` `[VA]` |

### Intermediate phase

HQPlayer's manual characterizes it only by consequence: "Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing with improved filtering quality (faster roll-off)." (`04-06:123-127`) — the sole on-disk characterization, `basic`, `[sourced]`.

It is **not** an HQPlayer coinage. SoX and libsoxr name the same setting, at position 25 on a continuous 0–100 minimum→linear scale — "Any phase response (0 = minimum, 25 = intermediate, 50 = linear, 100 = maximum)" and `#define SOXR_INTERMEDIATE_PHASE 0x10` (`[V]`, `basic`). SoX also defines it only by consequence: "the intermediate phase setting attempts to find the best compromise by selecting a small length (and level) of pre-echo and a medium lengthed post-echo." (`[V]`, `basic`).

**Constraint on the card, load-bearing:** it must not gloss intermediate phase as "mixed phase". Mixed phase is the established textbook term, but it means something else — it is defined against the minimum/**maximum** extremes ("its group delay is neither minimum or maximum but somewhere between", `[V]`) and it explicitly includes linear phase ("Non-trivial linear phase or nearly linear phase systems are also mixed phase.", `[V]`). The defensible framing is a phase parameter interpolating between the minimum-phase and linear-phase versions of one magnitude response.

Construction, `adv`, carried at lane confidence and **not orchestrator-verified**: soxr's `lsx_fir_to_phase()` builds the minimum-phase spectrum cepstrally from the linear-phase magnitude then blends unwrapped phase (code comments read "Cepstral:" and "Interpolate between linear & min phase"); Cirrus Logic patent US11889280 B2 describes frequency-domain interpolation between h_mp and h_lp, or equivalently a minimum-phase filter cascaded with a tunable allpass. A patent is weak authority for a definitional gloss — corroboration only.

## 2. Length

**Gloss draft.** Length is how long the filter's own response lasts, counted in taps. A longer filter can separate what it keeps from what it removes more sharply, and its ringing lasts proportionally longer. A shorter filter rings more briefly and separates more gently. Longer is not automatically better: the extra length is spent either on a sharper cut or on rejecting more of what is above it, and a shorter filter spending its length differently can beat a longer one.

| claim | tier | tag | citation |
|---|---|---|---|
| Ringing lasts as long as the filter | `basic` | `[sourced]` | "Thus, for length \(N\) FIR filters, the duration of the transient response is \(N-1\) samples." — Smith, *Introduction to Digital Filters* §5.7 `[V]` |
| Shortening a filter shortens its ringing and costs roll-off sharpness | `basic` | `[sourced]` | "Otherwise similar as poly-sinc, but shorter pre- and post-ringings at the expense of filtering quality (not as sharp roll-off)." — `04-06:110-113` |
| Lengthening does the inverse | `basic` | `[sourced]` | "Otherwise similar as poly-sinc, but longer pre- and post-ringings with improved filtering quality (faster roll-off)." — `04-06:119-122` |
| **Attenuation and steepness are separate targets, both paid for in length** | `basic` | `[sourced]` | "convolving any filter kernel with itself results in a filter kernel with a much improved stopband attenuation. The price you pay is a longer filter kernel and a slower roll-off." — dspguide ch. 16 `[V]` |
| So quality is not monotonic in length — HQPlayer says so itself | `basic` | `[sourced]` | "Significantly better quality than sinc-L at 1/8th of the load." — `04-06:453-454` (`sinc-Lh`, 16384×ratio, vs `sinc-L`, 131070×ratio) |
| The axis in one sentence | `basic` | `[structural]` | "filter length trades frequency-domain accuracy against time-domain compactness" — `eq-assistant/PRIMER.md:79` |
| Length is often ratio-adaptive, not an absolute number | `basic` | `[sourced]` | "Number of taps is 4096 x conversion ratio." — `04-06:407-408` |
| Length is set by attenuation over transition width | `adv` | `[sourced]` | "\begin{equation}M = \frac{A-8}{2.285 \cdot \Delta\omega}\end{equation} where \(\Delta\omega\) is in radians between \(0\) and \(\pi\)." — Smith, *SASP* §4.5.2, attributed to Kaiser `[V]`. `M` = order, `A` = stop-band attenuation in dB, `Δω` = transition width in radians |
| Mechanism behind the inverse law: transition width *is* the window main-lobe width, which goes as 1/length | `adv` | `[sourced]` | "The transition bandwidth is equal to the bandwidth of the main lobe of the window transform" — Smith, *SASP* §4.5 `[V]`; "the main lobe … is width \(2\Omega_M\)" with \(\Omega_M \isdeftext 2\pi/M\) — *SASP* §3.1.1 `[V]` |
| Attenuation is convertible into length at matched roll-off | `adv` | `[sourced]` | "the 20% slower roll-off of the Blackman window (as compared with the Hamming) can be compensated for by using a filter kernel 20% longer" — dspguide `[V]` |
| Underlying time–frequency limit; an FIR is time-limited by construction | `adv` | `[sourced]` | "If \(x(t)=0\) for \(\abs{t}\geq \Delta t/2\) , then \begin{equation}\Delta t\cdot\DW\geq \pi\end{equation}" — Smith, *SASP* `[V]` |

Note for `adv` copy: *SASP* uses `M` for filter *order* in the Kaiser formula and for window *length in samples* in the window chapter. Reconciling them (order `M` ⇔ length `M+1`) is an inference, not a statement either page makes — do not paper over it silently.

## 3. Ringing

**Gloss draft.** Ringing is the oscillation a filter adds around a sudden sound. Pre-ringing arrives before the attack, post-ringing after it. How long it lasts is set by the filter's length; where it sits is set by the filter's phase; and how much there is trades against how sharply the filter cuts. A filter with no ringing at all is possible, and it pays for that by passing through material it was supposed to remove.

| claim | tier | tag | citation |
|---|---|---|---|
| Pre-ringing originates at the oversampling filter | `basic` | `[structural]` | "Pre-echo is available only from the oversampling filter" — `eq-assistant/PHASE.md:33` |
| Duration is set by length | `basic` | `[sourced]` | "the duration of the transient response is \(N-1\) samples" — Smith `[V]` (see §2) |
| Placement is set by phase | `basic` | `[sourced]` | "equal amounts of ``pre-ringing'' and ``post-ringing'' due to the use of a linear-phase FIR filter" — Smith, *SASP* §8.4.1 `[V]` (see §1) |
| Steepness is what less ringing is traded for | `basic` | `[sourced]` | "Minimizes amount of ringing by using slow roll-off filters." — `04-04-pcm.txt:147-148`. **Surface caveat:** this is the SDM→PCM Conversion drop list, not the oversampling Filter list; cite with that attribution |
| …and bandwidth is the other thing traded | `basic` | `[sourced]` | "Optimized tradeoff between ringing and wide frequency response." — `04-04-pcm.txt:151-153`, same surface caveat |
| **The zero-ringing extreme, with its cost stated in the same breath** | `basic` | `[sourced]` | "No apparent pre- or post-ringing." + "Frequency response rolls off slowly in the top octave." + "Poor stop-band rejection and will thus leak fairly high amount of ultrasonic distortion." — `04-06:369-375` (polynomial-1) |
| "Non-ringing" is a manufacturers' term, and the manual attributes it rather than adopting it | `basic` | `[sourced]` | "These type of filters are sometimes referred to as ``non-ringing'' by some manufacturers." — `04-06:375-378` |
| Ringing minimization is a design axis of its own, not only a byproduct of length and phase | `basic` | `[sourced]` | "Uses special algorithm to create a linear-phase filter that minimizes amount of ringing while providing better frequency-response and attenuation than polynomial interpolators." — `04-06:384-390` (minringFIR) |
| Passband ripple is a separate axis that can be zero | `basic` | `[sourced]` | "Small amount of pass-band ripple is also present." (`04-06:31-32`, IIR) vs "No passband ripple." (`04-06:44`, IIR2) |
| Ringing can be quantified in cycles | `adv` | `[sourced]` | "Similar to polynomial-1, but higher stop-band rejection and only one cycle of pre- and post-ringing." — `04-06:380-382` |
| Structural basis for the symmetric case | `adv` | `[sourced]` | h(n) = h(N−1−n), delay half the length — Smith §11.4 `[V]` (see §1) |

## 4. Apodizing

**Gloss draft.** An apodizing filter targets ringing that is already in the recording, put there by filters in the equipment that made it — not ringing the playback filter is about to add. It replaces that inherited response with a shorter one. What it costs is a gentler cut and weaker rejection of what sits above the music.

**Scope of this gloss (user, 2026-07-29): mechanism only, no when-to-use guidance.** The app already carries an automatic apodization warning, so the card does not need to tell the user when to reach for the control. The manual's own rule — the Apod counter exceeding 10 in a track — is therefore out, and so is anything that restates it.

| claim | tier | tag | citation |
|---|---|---|---|
| **The defect is upstream, in the recording chain** | `basic` | `[sourced]` | "For PCM source content, HQPlayer can detect need for an apodizing filter. This is based on detected errors that originate from the recording ADC or mastering tools." — `02-06-apodization.txt:2-3` |
| Independent statement of the same, naming the decimation filters | `basic` | `[sourced]` | "Apodizing filters are generally used to correct/reduce errors in the source data, introduced by the ADC digital decimation filters, or at later stage conversion tools used to produce the final deliverables." — Ferrum technical article `[V]` |
| **The mechanism: it shortens the impulse response already present** | `basic` | `[sourced]` | "illustrating how the highly dispersive time response of the brickwall filter in Figure 2A is shortened by application of the apodising filter to the compact time response in Figure 2B." — patent EP3155617A1 (Meridian, Craven/Stuart) `[V]` |
| Same, in frequency terms | `adv` | `[sourced]` | "an ``apodising'' filter operating at the 96kHz rate can widen the effective transition band, narrowing the dispersion of impulse energy" — EP3155617A1 `[V]` |
| **The cost** | `basic` | `[sourced]` | "this operation is making the slope of the filter less steep and attenuation in stopband is a little lower, therefore unwanted higher frequencies are less rejected." — Ferrum `[V]` |
| A clean A/B exists in the filter list: same filter, same length, apodizing the only difference | `basic` | `[sourced]` | "Very steep 8 times longer version of poly-sinc-ext2-long." (`04-06:215-216`, Apod=Y) vs "Very steep 8 times longer non-apodizing version of poly-sinc-ext2-long. Only suitable for highest technical quality source materials." (`04-06:220-224`, Apod=N) |

**Dropped row (user, 2026-07-29):** the manual decodes its recurring phrase "Only suitable for highest technical quality source materials" at `04-06:12-13`, but it decodes it *as* the Apod counter rule, so it falls under the same exclusion. Consequence to accept knowingly: that phrase appears verbatim in the description of several non-apodizing filters, including the A/B pair above, and the card will not explain it.

### Apodizing = half — research record only, not card content

**Resolved (user, 2026-07-29): out of the card entirely.** If Signalyst documents `half`, it will appear in HQPlayer's own docs. The card neither defines the value nor flags it as undefined. What follows is kept only so the next person does not repeat the search.

No source defines it. The manual never uses the phrase "half-apodizing" and never explains the `½` value, which appears only as an Apod column mark (`04-06:98` among 9 occurrences). Web research found no established meaning in digital audio; the only established "half-apodization" usage is in optics and RF filter design, and that primary was unreachable (`[X]`).

Likely reason, and a finding in its own right: an external HQPlayer manual **v5.7.3** carries a *binary* Apod column marked `X`, while the local HQPlayer **6** manual (`hqplayer6desktop-manual.pdf`) carries three values. The half tier postdates 5.7.3, which is why nothing documents it.

No further research on this value.

## Graph inventory — advanced tier

Capped at three figures for the entire advanced tab — the cap is on figures only, nothing else. Producing them is implementation and out of scope here.

| # | figure | serves | does a reached source already have one? |
|---|---|---|---|
| 1 | One filter's impulse response at linear / intermediate / minimum phase, same magnitude response, aligned on the transient | Phase, Ringing | Partly. Smith, *SASP* §8.4.1 has a linear-phase pre/post-ringing close-up (length L=257). No three-way comparison found — would need generating |
| 2 | The same filter short vs long: impulse response beside magnitude transition band | Length, Ringing | Partly. dspguide ch. 16 works the instance numerically — "M ' 20, 40, and 200 . From Eq. 16-3, the transition bandwidths are: BW ' 0.2, 0.1, and 0.02" — but as separate figures |
| 3 | Inherited brickwall impulse response before and after an apodizing filter | Apodizing | **Yes.** Patent EP3155617A1 Figures 2A and 2B are exactly this pair |

## Decisions taken (all open items closed, user, 2026-07-29)

1. **The manual's masking quote is dropped entirely.** `04-06:23-27` — "long post-ringing is a side effect (not usually audible due to masking)" — is not used, not quoted, not attributed. The outright audibility prohibition (scope 6) wins, and the claim policy's manual's-own-words exception goes unused. Consequence accepted: a user reading the inline filter description will meet that parenthetical with no explanation from the card.
2. **The apodizing gloss carries mechanism only, no when-to-use guidance.** The app already has an automatic apodization warning, so the card does not need a trigger. The manual's Apod-counter rule (`04-06:8-11`) is out, and so is the `04-06:12-13` row that decoded "Only suitable for highest technical quality source materials" by restating it.
3. **Apodizing=half is out of the card entirely** — Signalyst's to document, not HQPTuner's to guess at.

## Claim policy

Stated here in full so this document is self-verifying.

- **`[sourced]`** — stated in the HQPlayer manual, the hqplayerd readme, or reached literature. Carries a citation: `file:line` for on-disk sources, URL for web. Verbatim quote preserved alongside any paraphrase.
- **`[structural]`** — arithmetic/DSP entailment, true by construction. Must be an entailment a DSP text would state, not a plausibility.

Nothing untagged ships. Subjective claims are omitted, not hedged. The plan's one exception — the manual's own subjective language, quoted and attributed — was offered and **declined by the user**, so nothing in this document rests on it and no gloss uses it. Treat the exception as closed rather than available.

Audibility material — thresholds, listening tests, detection or discrimination figures, masking claims, "inaudible by construction" arguments — is forbidden outright, as material and not merely as copy. Discarded during this research rather than carried as background: Toole & Olive 1988 detection findings, the Q ≤ ½ non-oscillatory floor, Moore & Tan passband-ripple naturalness, group-delay thresholds (Liski 2021, Blauert & Laws 1978, Møller 2007), and the recorded null result on minimum-phase-versus-linear-phase discrimination testing.

Verification tags follow `docs/eq-assistant/SOURCES.md:7-16`: `[V]` primary read directly · `[VA]` read by a delegated agent that returned a verbatim quote and URL · `[S]` secondary only · `[X]` unreachable. `[S]` and `[X]` material stays off the card.

## Sources appendix

On-disk, all `[V]`:

- `docs/vendor/manual/04-06-filter-oversampling-selection.txt` — the authority section for all four terms.
- `docs/vendor/manual/02-06-apodization.txt` — apodizing only; silent on the other three.
- `docs/vendor/manual/04-07-advanced.txt` — one statement, of the FFT filter length setting: "Length affects steepness of the filter, shorter lengths result in slower (gentler) roll-off, while higher lengths result in faster (steeper) roll-off." (`:61-63`). Corroborates Length; attribute to the `fft_size` setting, which is out of scope as a term.
- `docs/vendor/manual/04-04-pcm.txt` — two salvaged ringing statements. `:8` redirects filter settings to 04-06; everything else in the file is the PCM Noise filter / PCM Conversion drop lists, a different control surface.
- `hqptuner/data/filters.json` — the on-screen vocabulary, transcribed manual §4.6 prose, rendered by `hqptuner/static/store/prose.js:48-65`.
- `docs/eq-assistant/PRIMER.md:79`, `:85`, `:87` — the length and phase axes, the project's descriptive stance ("The mechanisms are real; the audibility is small and disputed near Nyquist. Say so rather than overselling."), and the negative rules on what a filter may be blamed for.
- `docs/eq-assistant/PHASE.md:24`, `:32`, `:33`, `:282` — minimum-phase entailments and the pre-echo origin partition.

Web:

- Smith, J. O. III, *Spectral Audio Signal Processing* and *Introduction to Digital Filters with Audio Applications*, CCRMA — `[V]`. Kaiser order formula, window main-lobe relations, transient duration, linear-phase symmetry, uncertainty principle.
- Smith, S. W., *The Scientist and Engineer's Guide to DSP* ch. 16, dspguide.com — `[V]`. Length↔roll-off trade, attenuation-vs-length, window comparison.
- `sox.1` man source and `soxr.h` / `filter.c`, github.com/chirlu — `[V]`. Intermediate phase as a named setting on a 0–100 scale.
- CCRMA *Maximum Phase Filters* and Wikipedia *Minimum phase* — `[V]`. Mixed-phase definition and why it is the wrong term here.
- Patent EP3155617A1, Meridian Audio (Craven/Stuart) — `[V]`. Apodizing mechanism.
- Ferrum, "Digital filters in general" — `[V]`. Apodizing target and cost. Vendor technical article; modest authority.
- Patent US11889280 B2, Cirrus Logic — `[V]` per lane, orchestrator-unverified. Phase-interpolation construction.

`[S]` — reached but off the card:

- Craven, P., "Antialias Filters and System Transient Response at High Sample Rates", *JAES* 52(3):216–242, March 2004 — abstract only, full paper paywalled. Its abstract states "a single ``apodizing'' filter can substantially suppress the ringing and shorten the impulse response". The primary would be the best citation for §4 and is not reachable.
- Sound on Sound, "MQA: Time-domain Accuracy" — trade magazine, secondary to Craven 2004.
- Meridian "True Time" product page — marketing register. Retrieved directly, but downgraded to `[S]` on authority grounds rather than retrieval grounds.
- eclipseaudio.com FIR filter guide — fetched via summariser rather than raw; rejected.

`[X]` — unreachable, no content attributed:

- Oppenheim & Schafer, *Discrete-Time Signal Processing* — not freely readable. Nothing above depends on it; Smith covers every needed relation. The SFU ENSC 429 course notes reached instead are O&S-*derived*, not O&S.
- Lyons, *Understanding Digital Signal Processing*; Rorabaugh — not reached.
- "Rugate filter sidelobe suppression using half-apodization" (ResearchGate, HTTP 403) — the only lead on "half-apodization" as an established term, in optics rather than audio.
- AES e-library full-text search — JavaScript/paywalled; no true full-text search was possible, so "not an established term" verdicts rest on arXiv metadata and textbook sources rather than an AES sweep.
