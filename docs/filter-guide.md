# Filter guide — researched material for the Resampling tab guidance card

Researched material for a guidance card on HQPTuner's Resampling tab, explaining filter terms in plain English. The manual carries the technical explanations; the card translates them. **Research only** — no card copy ships from here until implementation is planned through the plan gate.

The tab carries two tiers behind a switch: **basic** is plain English with no mathematics as far as possible, **advanced** may carry mathematics and example graphs. Every claim is tier-tagged `basic` or `adv`. Glosses are drafts of *meaning*, not final copy; each is derivable from the claims listed under it and nothing else.

## Scope

- **Eight terms**, below. Filter *families* (poly-sinc vs sinc vs gauss vs closed-form vs IIR vs polynomial) are out — per-filter prose already lives in `hqptuner/data/filters.json`.
- **Out:** Focus, Quality, Ratio, Genre; the `-2s` suffix; the facet-Length vs `fft_size` naming collision; the "Apodizing events" counter; the 1x-vs-Nx split; the whole SDM side; the `Apodizing = half` value.
- **Descriptive stance.** State what the filter does to the signal; the listener judges the sound.
- **Audibility material is forbidden outright** — thresholds, listening tests, detection or discrimination figures, masking claims, "inaudible by construction" arguments. A prohibition on the material, not merely on the copy. Any future research instruction must state it flatly and must not offer a "note that it exists" concession; that concession is what let the material in on the first pass.

## Card header

> **Filter properties in plain English.** What each setting does to the signal, and what it costs. Mechanism only — how any of it *sounds* is yours to judge.
>
> Not every term applies to every filter. Most filters offer no phase choice at all. Apodizing is a property some have and others don't. Taps, and length counted in taps, describe FIR filters — nearly the whole list, but the two IIR filters work differently. And a few filters sit at the far end of a single axis: one has no apparent ringing to describe, and pays for that elsewhere.

Grounding for the second paragraph, counted against the static overlay `hqptuner/data/filters.json` (68 entries; the live enum differs by mode — 67 PCM / 77 SDM per `facets.js:20-26`):

| header claim | evidence |
|---|---|
| "Most filters offer no phase choice at all" | 22 of 68 names carry a `-lp`/`-mp`/`-ip`/`min` marker, so 46 do not; `facets.js:83-89` returns `""` for the rest |
| "Apodizing is a property some have and others don't" | 29 of 68 carry `apodizing: "none"` |
| "the two IIR filters work differently" | `IIR` and `IIR2` are the only non-FIR entries; taps and tap-counted length do not describe them |
| "one has no apparent ringing … and pays for that elsewhere" | "No apparent pre- or post-ringing." + "Poor stop-band rejection…" — `04-06:369-375` (polynomial-1) |

No counts in the header itself: they would go stale against the live enum, which is enumeration authority and differs per mode.

## Term inventory

| # | Term | UI surface | Values / strings to explain |
|---|---|---|---|
| 1 | Phase | narrow bar, `hqptuner/static/components/NarrowBar.js:51-56`; parsed from `-lp`/`-mp`/`-ip` suffixes, `hqptuner/static/store/facets.js:83-89` | Linear / Minimum / Intermediate |
| 2 | Length | narrow bar, `NarrowBar.js:57-62`; tap-count classification `facets.js:104-128` | Short / Medium / Long / Extra long |
| 3 | Ringing | not a chip — vocabulary of the per-filter description rendered inline for the current selection, `hqptuner/static/store/prose.js:48-65` | pre-ringing, post-ringing, passband ripple, stop-band attenuation, roll-off speed, impulse-response length |
| 4 | Apodizing | per-chain 1x control, `hqptuner/static/components/ApodNarrow.js`; live arg bit 0 = apodizing | full / none |
| 5 | Filter | what the whole tab selects — four slots, `hqptuner/static/components/tabs/ResamplingTab.js:52-55`, rendered `:73-89` | no values; the frame the other seven sit inside |
| 6 | Cut | not a chip — card vocabulary. HQPlayer's word for its steepness is "roll-off", in the per-filter description at `prose.js:48-65` | no values; a shape with three parts |
| 7 | Attack | not a chip — card vocabulary. The manual and the literature say "transient" | no values |
| 8 | Taps | not a chip — the unit Length is classified on, `facets.js:90-128`; the manual quotes counts per filter | no values; a count, usually relative to conversion ratio |

"Cut" and "Attack" are this document's words, not HQPlayer's. Both glosses name the manual's word alongside, so the reader meets the on-screen vocabulary too.

## 1. Phase

**Gloss draft.** Phase decides where a filter's ringing sits relative to the sound that caused it. Linear phase splits the ringing evenly, so part of it arrives before the attack. Minimum phase moves all of it after the attack, and in exchange delays some frequencies more than others. Intermediate phase is a setting between those two, described by what it produces rather than by what it is.

| claim | tier | tag | citation |
|---|---|---|---|
| A linear-phase FIR produces equal amounts of ringing before and after the transient | `basic` | `[sourced]` | "Note the equal amounts of ``pre-ringing'' and ``post-ringing'' due to the use of a linear-phase FIR filter." — Smith, *SASP* §8.4.1 `[V]` |
| Linear phase's cost is stated by HQPlayer as pre-ringing | `basic` | `[sourced]` | "Good phase response, but has some amount of pre-ringing." — `04-06:102-103` |
| Minimum phase's cost is stated by HQPlayer as an altered phase response | `basic` | `[sourced]` | "Altered phase response, but no pre-ringing." — `04-06:107-108` |
| The axis, stated as a trade in one sentence | `basic` | `[structural]` | "linear phase puts ringing symmetrically around a transient so energy arrives before the attack; minimum phase moves it all after, at the cost of frequency-dependent group delay" — `eq-assistant/PRIMER.md:79`, quoted at `eq-assistant/PHASE.md:282` |
| Minimum phase is the least-group-delay realisation of a given magnitude response | `adv` | `[sourced]` | "among all causal systems with the same frequency response magnitude, the minimum-phase one has the smallest group delay at all frequencies." — MIT OCW 6.341, via `eq-assistant/PHASE.md:32` `[VA]` |
| A linear-phase FIR's impulse response is symmetric and its delay is half its length | `adv` | `[sourced]` | "the impulse response of every causal , linear-phase , FIR filter is symmetric: \[h(n) = h(N-1-n), \quad n=0,1,2,\ldots, N-1.\]" — Smith, *Introduction to Digital Filters* §11.4 `[V]` |
| For a minimum-phase system, phase is not independently specifiable — it follows from magnitude | `adv` | `[sourced]` | "you cannot specify both magnitude and phase independently for a minimum-phase system." — MIT OCW 6.341, via `eq-assistant/PHASE.md:24` `[VA]` |

### Intermediate phase

The manual characterizes it only by consequence: "Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing with improved filtering quality (faster roll-off)." (`04-06:123-127`) — the sole on-disk characterization, `basic`, `[sourced]`.

Not an HQPlayer coinage. SoX and libsoxr name the same setting, at position 25 on a continuous 0–100 minimum→linear scale — "Any phase response (0 = minimum, 25 = intermediate, 50 = linear, 100 = maximum)" and `#define SOXR_INTERMEDIATE_PHASE 0x10` (`[V]`, `basic`). SoX also defines it by consequence: "the intermediate phase setting attempts to find the best compromise by selecting a small length (and level) of pre-echo and a medium lengthed post-echo." (`[V]`, `basic`).

**Constraint on the card, load-bearing:** it must not gloss intermediate phase as "mixed phase". Mixed phase is the established textbook term and means something else — defined against the minimum/**maximum** extremes ("its group delay is neither minimum or maximum but somewhere between", `[V]`) and explicitly including linear phase ("Non-trivial linear phase or nearly linear phase systems are also mixed phase.", `[V]`). The defensible framing is a phase parameter interpolating between the minimum-phase and linear-phase versions of one magnitude response.

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

**Correctness caveat for `adv` copy:** *SASP* uses `M` for filter *order* in the Kaiser formula and for window *length in samples* in the window chapter. Reconciling them (order `M` ⇔ length `M+1`) is an inference neither page states — do not paper over it silently.

## 3. Ringing

**Gloss draft.** Ringing is the oscillation a filter adds around a sudden sound. Pre-ringing arrives before the attack, post-ringing after it. How long it lasts is set by the filter's length; where it sits is set by the filter's phase; and how much there is trades against how sharply the filter cuts. A filter with no ringing at all is possible, and it pays for that by passing through material it was supposed to remove.

| claim | tier | tag | citation |
|---|---|---|---|
| Pre-ringing originates at the oversampling filter | `basic` | `[structural]` | "Pre-echo is available only from the oversampling filter" — `eq-assistant/PHASE.md:33` |
| Duration is set by length | `basic` | `[sourced]` | "the duration of the transient response is \(N-1\) samples" — Smith `[V]` (see §2) |
| Placement is set by phase | `basic` | `[sourced]` | "equal amounts of ``pre-ringing'' and ``post-ringing'' due to the use of a linear-phase FIR filter" — Smith, *SASP* §8.4.1 `[V]` (see §1) |
| Steepness is what less ringing is traded for | `basic` | `[sourced]` | "Minimizes amount of ringing by using slow roll-off filters." — `04-04-pcm.txt:147-148`. **Surface caveat:** the SDM→PCM Conversion drop list, not the oversampling Filter list; cite with that attribution |
| …and bandwidth is the other thing traded | `basic` | `[sourced]` | "Optimized tradeoff between ringing and wide frequency response." — `04-04-pcm.txt:151-153`, same surface caveat |
| **The zero-ringing extreme, with its cost stated in the same breath** | `basic` | `[sourced]` | "No apparent pre- or post-ringing." + "Frequency response rolls off slowly in the top octave." + "Poor stop-band rejection and will thus leak fairly high amount of ultrasonic distortion." — `04-06:369-375` (polynomial-1) |
| "Non-ringing" is a manufacturers' term, and the manual attributes it rather than adopting it | `basic` | `[sourced]` | "These type of filters are sometimes referred to as ``non-ringing'' by some manufacturers." — `04-06:375-378` |
| Ringing minimization is a design axis of its own, not only a byproduct of length and phase | `basic` | `[sourced]` | "Uses special algorithm to create a linear-phase filter that minimizes amount of ringing while providing better frequency-response and attenuation than polynomial interpolators." — `04-06:384-390` (minringFIR) |
| Passband ripple is a separate axis that can be zero | `basic` | `[sourced]` | "Small amount of pass-band ripple is also present." (`04-06:31-32`, IIR) vs "No passband ripple." (`04-06:44`, IIR2) |
| Ringing can be quantified in cycles | `adv` | `[sourced]` | "Similar to polynomial-1, but higher stop-band rejection and only one cycle of pre- and post-ringing." — `04-06:380-382` |
| Structural basis for the symmetric case | `adv` | `[sourced]` | h(n) = h(N−1−n), delay half the length — Smith §11.4 `[V]` (see §1) |

## 4. Apodizing

**Gloss draft.** An apodizing filter targets ringing that is already in the recording, put there by filters in the equipment that made it — not ringing the playback filter is about to add. It replaces that inherited response with a shorter one. What it costs is a gentler cut and weaker rejection of what sits above the music.

Mechanism only, no when-to-use guidance: the app already carries an automatic apodization warning. The manual's own trigger rule (the Apod counter, `04-06:8-11`) is therefore out, and so is `04-06:12-13`, which decodes the recurring phrase "Only suitable for highest technical quality source materials" by restating that rule. Consequence accepted: that phrase appears verbatim in several non-apodizing filter descriptions, including the A/B pair below, and the card will not explain it.

| claim | tier | tag | citation |
|---|---|---|---|
| **The defect is upstream, in the recording chain** | `basic` | `[sourced]` | "For PCM source content, HQPlayer can detect need for an apodizing filter. This is based on detected errors that originate from the recording ADC or mastering tools." — `02-06-apodization.txt:2-3` |
| Independent statement of the same, naming the decimation filters | `basic` | `[sourced]` | "Apodizing filters are generally used to correct/reduce errors in the source data, introduced by the ADC digital decimation filters, or at later stage conversion tools used to produce the final deliverables." — Ferrum technical article `[V]` |
| **The mechanism: it shortens the impulse response already present** | `basic` | `[sourced]` | "illustrating how the highly dispersive time response of the brickwall filter in Figure 2A is shortened by application of the apodising filter to the compact time response in Figure 2B." — patent EP3155617A1 (Meridian, Craven/Stuart) `[V]` |
| Same, in frequency terms | `adv` | `[sourced]` | "an ``apodising'' filter operating at the 96kHz rate can widen the effective transition band, narrowing the dispersion of impulse energy" — EP3155617A1 `[V]` |
| **The cost** | `basic` | `[sourced]` | "this operation is making the slope of the filter less steep and attenuation in stopband is a little lower, therefore unwanted higher frequencies are less rejected." — Ferrum `[V]` |
| A clean A/B exists in the filter list: same filter, same length, apodizing the only difference | `basic` | `[sourced]` | "Very steep 8 times longer version of poly-sinc-ext2-long." (`04-06:215-216`, Apod=Y) vs "Very steep 8 times longer non-apodizing version of poly-sinc-ext2-long. Only suitable for highest technical quality source materials." (`04-06:220-224`, Apod=N) |

## 5. Filter

**Gloss draft.** A filter's job is to pass some frequencies and remove others. When HQPlayer raises the sample rate, the new rate has room above the music that the original did not, and the filter is what fills the gap between the original samples and keeps unwanted material out of the space above them. It does that arithmetically: every output sample is a weighted sum of a stretch of neighbouring input samples. That is the whole reason a filter has a duration of its own — it is an event in time as much as it is a shape in frequency, and the two cannot both be made sharp. Precision about frequency is bought with length in time; brevity in time is bought with vagueness about frequency. Every other setting on this page is a choice about where to sit on that one trade.

| claim | tier | tag | citation |
|---|---|---|---|
| **The trade, stated as the axis** | `basic` | `[structural]` | "filter length trades frequency-domain accuracy against time-domain compactness" — `eq-assistant/PRIMER.md:79` |
| A filter has a duration, set by how many samples it reaches across | `basic` | `[sourced]` | "for length \(N\) FIR filters, the duration of the transient response is \(N-1\) samples." — Smith, *Introduction to Digital Filters* §5.7 `[V]` |
| **What a filter that removes too little leaks** | `basic` | `[sourced]` | "Poor stop-band rejection and will thus leak fairly high amount of ultrasonic distortion." — `04-06:369-375` (polynomial-1) |
| Each output sample is a weighted sum of neighbouring input samples | `basic` | `[structural]` | Definition of FIR convolution; the tap count *is* the number of terms in that sum (see §8) |
| The trade is a hard limit, not an engineering shortfall | `adv` | `[sourced]` | "If \(x(t)=0\) for \(\abs{t}\geq \Delta t/2\) , then \begin{equation}\Delta t\cdot\DW\geq \pi\end{equation}" — Smith, *SASP* `[V]`. An FIR is time-limited by construction, so it always sits on the constrained side |
| Concrete instance of the inverse law | `adv` | `[sourced]` | "M ' 20, 40, and 200 . From Eq. 16-3, the transition bandwidths are: BW ' 0.2, 0.1, and 0.02" — dspguide ch. 16 `[V]` |

The gloss describes the oversampling filter specifically — the only filter this tab selects — not filtering in general.

## 6. Cut

**Gloss draft.** Cut is shorthand for how a filter stops passing sound, and it has three separate parts: where the cut begins, how steeply it falls once it begins, and how far down it finally gets. HQPlayer names the middle part only: *roll-off*, slow or fast, is the steepness. Steep and deep are not the same thing — a filter can fall away quickly and still let a fair amount through, or fall away slowly and still end up thoroughly silent. Whatever a filter fails to remove stays in the signal alongside the music. One property sits next to the cut rather than in it: flatness, meaning how level the filter leaves what it passes, before the cut begins at all.

| claim | tier | tag | citation |
|---|---|---|---|
| **Steepness is what the manual calls roll-off, and it is spent out of length** | `basic` | `[sourced]` | "Length affects steepness of the filter, shorter lengths result in slower (gentler) roll-off, while higher lengths result in faster (steeper) roll-off." — `04-07-advanced.txt:61-63`. **Surface caveat:** stated of the `fft_size` setting, which is out of scope as a term; the relation is the one `04-06` states of filter length |
| Gentler roll-off is the stated price of a shorter filter | `basic` | `[sourced]` | "shorter pre- and post-ringings at the expense of filtering quality (not as sharp roll-off)." — `04-06:110-113` |
| **Steepness and depth are separate targets, and length buys them separately** | `basic` | `[sourced]` | "convolving any filter kernel with itself results in a filter kernel with a much improved stopband attenuation. The price you pay is a longer filter kernel and a slower roll-off." — dspguide ch. 16 `[V]` |
| The two failure modes are named separately in one filter's description | `basic` | `[sourced]` | "Frequency response rolls off slowly in the top octave." + "Poor stop-band rejection…" — `04-06:369-375` (polynomial-1): one sentence for slope, one for depth |
| Flatness is a separate axis, and it can be zero | `basic` | `[sourced]` | "Small amount of pass-band ripple is also present." (`04-06:31-32`, IIR) vs "No passband ripple." (`04-06:44`, IIR2) |
| Depth is convertible into length at matched slope | `adv` | `[sourced]` | "the 20% slower roll-off of the Blackman window (as compared with the Hamming) can be compensated for by using a filter kernel 20% longer" — dspguide `[V]` |
| Both are one formula: length is attenuation over transition width | `adv` | `[sourced]` | "\begin{equation}M = \frac{A-8}{2.285 \cdot \Delta\omega}\end{equation}" — Smith, *SASP* §4.5.2, after Kaiser `[V]`. `A` is the depth, `Δω` the steepness, `M` the length that pays for both |

## 7. Attack

**Gloss draft.** An attack, or transient, is the sudden start of a sound — a drum hit, a plucked string, the leading edge of a note. It matters here because a filter's own behaviour in time is only visible when what it is fed changes abruptly. Feed it a steady tone and the filter's response settles and disappears into the tone. Feed it an attack and the filter's response appears around it, which is what ringing is and why ringing is always described relative to an attack rather than on its own.

| claim | tier | tag | citation |
|---|---|---|---|
| **Ringing is described relative to the attack, not in isolation** | `basic` | `[sourced]` | "linear phase puts ringing symmetrically around a transient so energy arrives before the attack" — `eq-assistant/PRIMER.md:79`, quoted at `eq-assistant/PHASE.md:282` |
| The before/after vocabulary presumes the attack as the reference point | `basic` | `[sourced]` | "equal amounts of ``pre-ringing'' and ``post-ringing''" — Smith, *SASP* §8.4.1 `[V]`: pre and post are only meaningful against something |
| The response has a finite duration, which is what makes it visible as an event | `basic` | `[sourced]` | "the duration of the transient response is \(N-1\) samples" — Smith `[V]` (see §5) |
| "Attack" and "transient" name the same thing | `basic` | `[structural]` | The literature and the manual say *transient*; the card says *attack* and gives both |

## 8. Taps

**Gloss draft.** A tap is one step of a filter's arithmetic: one nearby input sample, and one weight applied to it. The filter's output is the sum of all of them, so the number of taps is both how much work the filter does per sample and how far the filter reaches in time. That is why length is quoted in taps rather than in milliseconds. One catch: the counts are usually relative rather than absolute — a filter quoted at 4096 taps per conversion ratio uses 16384 of them when upsampling by four, so the same filter is longer at higher rates.

| claim | tier | tag | citation |
|---|---|---|---|
| **Tap counts are usually ratio-relative, not absolute** | `basic` | `[sourced]` | "Number of taps is 4096 x conversion ratio." — `04-06:407-408` |
| The tap count is what HQPTuner's Length classification is built on | `basic` | `[sourced]` | `facets.js:90-128` — `LENGTH_OVERRIDES` and its comment carry the per-filter tap counts (S=4096×ratio, L=131070×, Lm/Lh=16384×, Ll=65536×), because letter-coded names carry no readable length token |
| Taps and duration are the same quantity in different units | `basic` | `[sourced]` | "for length \(N\) FIR filters, the duration of the transient response is \(N-1\) samples." — Smith §5.7 `[V]` |
| A tap is one term of the weighted sum | `basic` | `[structural]` | Definition of FIR convolution (see §5) |
| Where the delay comes from, in the symmetric case | `adv` | `[sourced]` | "\[h(n) = h(N-1-n), \quad n=0,1,2,\ldots, N-1.\]" — Smith, *Introduction to Digital Filters* §11.4 `[V]`: a symmetric filter's delay is half its tap count |
| Taps are what the Kaiser formula returns | `adv` | `[sourced]` | `M = (A-8)/(2.285·Δω)` — Smith, *SASP* §4.5.2 `[V]`. Subject to the order-vs-length caveat in §2 |

**Open item, presentation:** the numbering above is commission order, not reading order. Four terms are used by earlier glosses before being defined. The order that reads correctly is Filter → Taps → Cut → Attack → Phase → Length → Ringing → Apodizing.

## Graph inventory — advanced tier

Capped at three figures for the entire advanced tab. Producing them is implementation, out of scope here.

**Constraint, per `CLAUDE.md` "No reverse engineering of HQPlayer":** every figure illustrates filter theory using a filter of our own design, or reproduces a published figure. None may be a measurement of an HQPlayer filter — no impulse or sweep through the engine to plot what `poly-sinc-long` actually does. A figure labelled with an HQPlayer filter name would be exactly the forbidden thing; label them by property instead.

| # | figure | serves | does a reached source already have one? |
|---|---|---|---|
| 1 | One designed-for-illustration filter's impulse response at linear / intermediate / minimum phase, same magnitude response, aligned on the transient | Phase, Ringing | Partly. Smith, *SASP* §8.4.1 has a linear-phase pre/post-ringing close-up (L=257). No three-way comparison found — would need generating |
| 2 | The same designed filter short vs long: impulse response beside magnitude transition band | Length, Ringing | Partly. dspguide ch. 16 works the instance numerically — "M ' 20, 40, and 200 . From Eq. 16-3, the transition bandwidths are: BW ' 0.2, 0.1, and 0.02" — but as separate figures |
| 3 | Inherited brickwall impulse response before and after an apodizing filter | Apodizing | **Yes.** Patent EP3155617A1 Figures 2A and 2B are exactly this pair |

## Claim policy

- **`[sourced]`** — stated in the HQPlayer manual, the hqplayerd readme, or reached literature. Carries a citation: `file:line` for on-disk sources, URL for web. Verbatim quote preserved alongside any paraphrase.
- **`[structural]`** — arithmetic/DSP entailment, true by construction. Must be an entailment a DSP text would state, not a plausibility.

Nothing untagged ships. Subjective claims are omitted, not hedged — including the manual's own subjective language, which is not quoted and not attributed. Audibility material is forbidden outright, per Scope.

Verification tags follow `docs/eq-assistant/SOURCES.md:7-16`: `[V]` primary read directly · `[VA]` read by a delegated agent that returned a verbatim quote and URL · `[S]` secondary only · `[X]` unreachable. `[S]` and `[X]` material stays off the card.

## Sources appendix

On-disk, all `[V]`:

- `docs/vendor/manual/04-06-filter-oversampling-selection.txt` — the authority section for every term except Attack, which it never names as such.
- `docs/vendor/manual/02-06-apodization.txt` — apodizing only.
- `docs/vendor/manual/04-07-advanced.txt:61-63` — length↔steepness, stated of the `fft_size` setting; carries the steepness half of Cut under that attribution.
- `docs/vendor/manual/04-04-pcm.txt` — two salvaged ringing statements. `:8` redirects filter settings to 04-06; the rest of the file is the PCM Noise filter / PCM Conversion drop lists, a different control surface that reuses filter names.
- `hqptuner/data/filters.json` — the on-screen vocabulary, transcribed manual §4.6 prose, rendered by `hqptuner/static/store/prose.js:48-65`.
- `docs/eq-assistant/PRIMER.md:79`, `:85`, `:87` — the length and phase axes, the project's descriptive stance, and the negative rules on what a filter may be blamed for.
- `docs/eq-assistant/PHASE.md:24`, `:32`, `:33`, `:282` — minimum-phase entailments and the pre-echo origin partition.

Web, all `[V]`:

- Smith, J. O. III, *Spectral Audio Signal Processing* and *Introduction to Digital Filters with Audio Applications*, CCRMA. Kaiser order formula, window main-lobe relations, transient duration, linear-phase symmetry, uncertainty principle.
- Smith, S. W., *The Scientist and Engineer's Guide to DSP* ch. 16, dspguide.com. Length↔roll-off trade, attenuation-vs-length, window comparison.
- `sox.1` man source and `soxr.h` / `filter.c`, github.com/chirlu. Intermediate phase as a named setting on a 0–100 scale.
- CCRMA *Maximum Phase Filters* and Wikipedia *Minimum phase*. Mixed-phase definition and why it is the wrong term here.
- Patent EP3155617A1, Meridian Audio (Craven/Stuart). Apodizing mechanism.
- Ferrum, "Digital filters in general". Apodizing target and cost. Vendor article; modest authority.

Reached but off the card — `[S]` unless noted:

- Craven, P., "Antialias Filters and System Transient Response at High Sample Rates", *JAES* 52(3):216–242, March 2004 — abstract only, paywalled. Would be the best citation for §4 and is not reachable.
- Sound on Sound, "MQA: Time-domain Accuracy"; Meridian "True Time" product page; eclipseaudio.com FIR filter guide.
- Oppenheim & Schafer, *Discrete-Time Signal Processing*; Lyons; Rorabaugh — `[X]`, not reached. Nothing above depends on them; Smith covers every needed relation.
- AES e-library full-text search — `[X]`, JavaScript/paywalled. No full-text sweep was possible, so any "not an established term" verdict rests on textbook and arXiv sources rather than AES.
