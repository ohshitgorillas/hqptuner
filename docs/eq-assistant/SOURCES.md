# SOURCES.md — EQ Assistant research base

Compiled 2026-07-22 for the HQPTuner **EQ Assistant** feature. Every claim below is tagged with how it was obtained. Nothing here is invented; where a source could not be reached, that is stated instead of paraphrasing what it "probably" says.

> **§2.2a's "1 dB per octave"** is a Harman/Olive convention, not a corroborated constant — Toole 2015 `[V]` does not contain it. §2.2d's 36 listeners land on a mean preferred tilt of **−1 dB/octave**, which is the same number and **is not corroboration of the same claim**: §2.2a's figure describes the steady-state in-room response of a loudspeaker, §2.2d's is a preferred tilt listeners applied on top of a 5128 diffuse-field target on an in-ear headphone. Adjacent, and worth knowing they agree numerically. Do not merge them.

**Verification legend**

| Tag | Meaning |
|---|---|
| `[V]` | I read the primary artefact directly (source file, PDF text, raw doc) and the numbers below are transcribed from it. |
| `[VA]` | Read by a delegated research agent during the 2026-07-25 pass, which returned a verbatim quote and a URL. Same artefact class as `[V]`; the difference is who read it. Treat the quotes as accurate; re-fetch before resting a decision on any single number in isolation. |
| `[S]` | Secondary only — I could reach a summary/derivative but not the primary. Treat the number as indicative, re-verify before relying on it. |
| `[X]` | Could not reach at all. Listed for completeness; **no content attributed**. |

`[VA]` exists because pretending an agent's read is my own read would corrupt the one thing this document is for. Where a lane computed a figure rather than quoting it, that is said in place and the figure is labelled derived.

**Reliability classes**: `peer-reviewed` · `standards-body` · `industry-standard lexicon` · `primary source code / project documentation` · `manufacturer technical documentation` · `manufacturer marketing` · `practitioner heuristic` · `measurement-community` · `community wiki` · `forum`.

The distinction between the two manufacturer classes is load-bearing: a manufacturer page with measurements, geometry or acoustic reasoning is technical documentation; "breathtaking clarity" is marketing and is worth nothing here. Where a vendor publishes only the latter, that is recorded as a finding rather than quietly skipped.

---

## 1. EQ engine conventions (the clamp authority)

### 1.1 AutoEq — Jaakko Pasanen `[V]`

* **Citation.** Pasanen, J. *AutoEq — Automatic headphone equalization from frequency responses.* Open-source project, MIT licence. <https://github.com/jaakkopasanen/AutoEq> Files read: `autoeq/constants.py`, `autoeq/frequency_response.py`, `autoeq/peq.py`, `results/oratory1990/over-ear/Sennheiser HD 650/Sennheiser HD 650 ParametricEQ.txt`.
* **Reliability.** Primary source code / project documentation. Highest confidence class in this document because the numbers are executable, not editorial.
* **What it contributes.** The numeric envelope our clamps must live inside, and the exact `ParametricEQ.txt` grammar the app already parses.

Constants transcribed from `autoeq/constants.py` `[V]`:

| Constant | Value |
|---|---|
| `DEFAULT_MAX_GAIN` | `6.0` dB |
| `DEFAULT_PEAKING_FILTER_MIN_GAIN` / `MAX_GAIN` | `-20.0` / `+20.0` dB |
| `DEFAULT_SHELF_FILTER_MIN_GAIN` / `MAX_GAIN` | `-20.0` / `+20.0` dB |
| `DEFAULT_FIXED_BAND_FILTER_MIN_GAIN` / `MAX_GAIN` | `-12.0` / `+12.0` dB |
| `DEFAULT_PEAKING_FILTER_MIN_Q` / `MAX_Q` | `0.18248` / `6.0` |
| `DEFAULT_SHELF_FILTER_MIN_Q` / `MAX_Q` | `0.4` / `0.7` |
| `DEFAULT_PEAKING_FILTER_MIN_FC` / `MAX_FC` | `20.0` / `10000.0` Hz |
| `DEFAULT_SHELF_FILTER_MIN_FC` / `MAX_FC` | `20.0` / `10000.0` Hz |
| `DEFAULT_BASS_BOOST_FC` / `_Q` | `105.0` Hz / `0.7` |
| `DEFAULT_TREBLE_BOOST_FC` / `_Q` | `10000.0` Hz / `0.7` |
| `DEFAULT_TREBLE_MAX_GAIN` | `6.0` dB |
| `PREAMP_HEADROOM` | `0.2` dB |
| `10_BAND_GRAPHIC_EQ` band gain range | `-12.0` … `+12.0` dB, Q = √2 |
| `31_BAND_GRAPHIC_EQ` | Q = `4.318473`, fc = `20 × 2^(i/3)` |
| `4_PEAKING_WITH_SHELVES` | low shelf fc `105.0` Q `0.7`; high shelf fc `10000.0` Q `0.7`; 4 × peaking |

**Preamp derivation — precise finding `[V]`.** In `frequency_response.py`, `write_eqapo_parametric_eq` emits

```python
s = f'Preamp: {-compound.max_gain:.1f} dB\n'
s += f'Filter {i + 1}: ON {types[filt.__class__.__name__]} Fc {filt.fc:.0f} Hz Gain {filt.gain:.1f} dB Q {filt.q:.2f}\n'
```

so the preamp is **the negative of the maximum of the *summed* magnitude response of the whole filter set**, not the negative sum of the positive band gains, and not the negative of the largest single band. The `PREAMP_HEADROOM = 0.2` dB margin appears in the *minimum-phase FIR* path (`fr.raw -= np.max(fr.raw); fr.raw -= PREAMP_HEADROOM`), not in the parametric text export.

**Corroborating real preset `[V]`** — `Sennheiser HD 650 ParametricEQ.txt` (oratory1990, over-ear):

```
Preamp: -6.1 dB
Filter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70
Filter 2: ON PK  Fc 8800 Hz Gain 5.1 dB Q 1.42
Filter 3: ON PK  Fc 118 Hz Gain -3.1 dB Q 0.50
Filter 4: ON PK  Fc 37 Hz Gain 0.7 dB Q 3.96
Filter 5: ON PK  Fc 3169 Hz Gain -1.7 dB Q 3.89
Filter 6: ON HSC Fc 10000 Hz Gain -2.1 dB Q 0.70
Filter 7: ON PK  Fc 1227 Hz Gain -1.2 dB Q 2.53
Filter 8: ON PK  Fc 2055 Hz Gain 1.2 dB Q 3.23
Filter 9: ON PK  Fc 587 Hz Gain 0.4 dB Q 1.19
Filter 10: ON PK Fc 5332 Hz Gain -1.1 dB Q 5.75
```

Note that the largest single gain is `+6.4` dB but the preamp is `-6.1` dB — direct confirmation that the preamp tracks the summed response, because the `-3.1` dB band at 118 Hz partially cancels the `+6.4` dB shelf. **The EQ Assistant must recompute headroom the same way**: sum the whole chain's magnitude response, take its maximum, negate.

Type tokens: `PK` = peaking, `LSC` = low shelf, `HSC` = high shelf. Shelves in shipped oratory1990 presets are uniformly `Q 0.70`.

### 1.2 RBJ Audio EQ Cookbook `[S]`

* **Citation.** Bristow-Johnson, R. *Cookbook formulae for audio EQ biquad filter coefficients.* Widely mirrored (originally musicdsp.org / W3C Audio WG appendix).
* **Reliability.** De-facto industry-standard reference implementation.
* **Contribution.** HQPlayer's `iir:` stage response math is the standard RBJ biquad set — this is stated as ground truth by the commissioning brief and is consistent with the `q` / `bw` / `s` (shelf-slope) parameter triad HQPlayer exposes. I did not re-derive the formulae here; the app already implements them.

### 1.3 oratory1990 `[X]` — **UNREACHABLE**

* **Attempted.** `https://www.reddit.com/r/oratory1990/wiki/index/faq/` and `https://old.reddit.com/r/oratory1990/wiki/index/faq/`. Both refused by this environment's fetcher ("unable to fetch from www.reddit.com").
* **Reliability class if reached.** Community wiki authored by a working headphone acoustician — high-quality practitioner heuristic, not peer-reviewed.
* **What is therefore NOT attributed here.** His stated reasoning about why he chooses particular Q values, his position on user-modification of presets, and his written rationale for preamp values. Do not cite him for those without fetching the wiki.
* **What IS safe to say.** His preset *outputs* are vendored in the AutoEq repository under `results/oratory1990/…` and are directly observable `[V]` — the HD 650 file above is one. Conventions visible in the data: one low shelf at 105 Hz and one high shelf at 10 kHz, both Q 0.70; peaking Q ranging ~0.5–5.8; a single negative `Preamp:` line. Attribute the *data*, not the reasoning.

---

## 2. Tonal / timbral vocabulary

### 2.1 ITU-R Report BS.2399-0 (2017), carrying the FORCE Technology / SenseLab **Sound Wheel** `[V]`

* **Citation.** ITU-R. *Report ITU-R BS.2399-0: Methods for selecting and describing attributes and terms, in the preparation of subjective tests.* International Telecommunication Union, Radiocommunication Sector, March 2017.
  <https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BS.2399-2017-PDF-E.pdf>
  (PDF fetched and text-extracted locally.)
* **Underlying lexicon.** Pedersen, T. H. & Zacharov, N. *The Development of a Sound Wheel for Reproduced Sound.* AES 138th Convention, Warsaw, May 2015, Paper 9310 (DELTA SenseLab).
  <https://aes.org/publications/elibrary-page/?id=17734> — **paywalled `[X]`**; the ITU report
  is the free route to the same attribute table, which is why it is the citation of record here.
* **Reliability.** Standards-body report reproducing an industry-standard lexicon. Highest authority for *definitions*; deliberately silent on frequencies.
* **Structure `[V]`.** Three rings. Inner: Loudness, Dynamics, Timbre, Spatial, Transparency, Artefacts. Middle: category groups (e.g. under Timbre — Treble, Midrange, Bass, Timbral balance; under Spatial — Spatial extent, Localization, Reverberance). Outer: individual attributes, each with a definition and a bipolar or unipolar scale.

Definitions transcribed `[V]` (abbreviated, wording from the report):

| Attribute | Group | Definition (as given) | Scale |
|---|---|---|---|
| Boomy | Bass | "Resonances in the low bass, as sound in a large barrel, which gives a prominent bass resound… The representation tends to become muddy and imprecise." | None – Weak – Loud |
| Boxy | Bass | "denotes a hollow sound, as if the sound was played inside a small box. Represents resonances in the **upper bass** frequency range." | None – Weak – Loud |
| Bass strength | Bass | relative level of the low frequencies; explicitly *not* to be confused with bass depth | Soft – Loud |
| Bass depth | Bass | how far the bass extends downwards | A little – A lot |
| Nasal | Midrange | "A closed sound with pronounced midrange… corresponding to vocalists singing through the nose" | A little – A lot |
| Canny | Midrange | "sounds like it is being played in a can or tube… prominent and narrowband resonances in the midrange" | A little – A lot |
| Midrange strength | Midrange | relative level of the middle frequencies | Soft – Loud |
| Treble strength | Treble | weak = "Covered, unsharp"; a lot = "Treble Raised. Sharp, hard sound." | Weak – A lot |
| Brilliance | Treble | a little = "As if you hear music through a door, muffled, blurred or dull"; a lot = "Crystal-clear… airy and open treble… without being sharp or shrill" | A little – A lot |
| Tinny | Treble | "Resonances or narrowband frequency prominence in the treble" | None – Weak – A lot |
| Dark–Bright | Timbral balance | Dark = "Excessive bass. Either loud bass or weak treble." Bright = "Excessive treble. Either loud treble or weak bass." | Dark – Neutral – Bright |
| Full | Timbral balance | "If both low and high frequencies are well represented with good extension the sound is Full." | A little – A lot |
| Homogeneous | Timbral balance | degree to which bass/mid/treble are coherent and continuous "without gaps between them" | A little – A lot |
| Shrill | Artefacts | "Treble Distortion. Very sharp s-sounds, cymbals etc." | — |
| Clean | Transparency | "The opposite of clean: dull, muddy." | — |

**Critical methodological point `[V]`: the Sound Wheel assigns no frequencies to any attribute.** "Boomy" is *low bass resonance*; "Boxy" is *upper bass resonance*; "Canny" is *midrange narrowband resonance*. Ordering is given, Hz is not. Any Hz range attached to a Sound Wheel term in this project comes from a *different* source and must be labelled as such.

### 2.2 Sean Olive (Harman International) — target curve and listener training

**2.2a Olive, S. E. (2022) `[V]` — the free, citable summary.**

* **Citation.** Olive, S. E. "The Perception and Measurement of Headphone Sound Quality: What Do Listeners Prefer?" *Acoustics Today*, Vol. 18, Issue 1 (Spring 2022), pp. 58–65.
  <https://acousticstoday.org/wp-content/uploads/2022/03/The-Perception-and-Measurement-of-Headphone-Sound-Quality-What-Do-Listeners-Prefer-Sean-E.-Olive.pdf>
* **Reliability.** Peer-reviewed-adjacent society magazine article by the principal investigator, summarising a decade of AES papers. Free. Excellent.
* **Numbers transcribed `[V]`:**
  * The preferred headphone target "approximates the in-room response of an accurate loudspeaker calibrated in a semireflective room"; that steady-state in-room response "gently falls about **1 dB per octave from 20 Hz to 20 kHz**." Olive states the slope as a general consequence of loudspeaker directivity and room absorption, with no citation and no measurement reported in the article — see the note at the head of this file.
  * The preferred **in-ear** target is "almost identical" to the around-ear/on-ear targets "except it has an additional **4 dB of bass**" (Olive et al., 2016).
  * Listener segmentation (Olive et al., 2018a; 31 headphones, 130 listeners): **Class 1 = 64 %** prefer the Harman target as-is; **Class 2 = 15 %** prefer it with **4–6 dB more bass**; **Class 3 = 21 %** prefer it with **2 dB less bass**. This is the strongest empirical justification in this document for the EQ Assistant existing at all, and for the magnitude of its typical bass moves (a few dB, not ten). **Amended by §2.2d — read the two together.** The 2018a segmentation puts the between-class spread at 7–8 dB in the bass against only 1–2 dB in the treble, which is where this document's "bass is the single dominant axis of individual taste" reading came from. Olive's 2025 method-of-adjustment study reproduces the bass figure (6.7 dB) but finds a treble spread of **6.3 dB**, which he flags in his own text as much greater than the earlier result. **The corrected reading: bass remains the largest single axis, but treble is not a rounding error, and the shelf-first strategy is sourced for both shelves rather than one.**
  * Lorho (2009): 80 listeners preferred a modified diffuse-field target in which the DF curve's **12 dB peak at 3 kHz was reduced to just 3 dB**.
  * Trained-listener descriptors recorded verbatim in the study: the DF targets had "too much emphasis in the **upper midrange (2–4 kHz)** and lacking bass"; the Lorho target had "too little energy at **2–4 kHz**, which made instruments sound **'muffled and dull'**"; the FF target was criticised for a strong 2–4 kHz emphasis, lack of bass, and harsh and nasal colorations (the article's own words, unquoted there); the winning target was described as "good bass with an even spectral balance."
  * Female listeners preferred less bass and treble than male; 55+ listeners preferred significantly more treble and less bass.
  * Recommended remedy for taste variance: "a simple bass and treble control" — i.e. exactly the shelf-first strategy the EQ Assistant should adopt.
* **Direct relevance.** The "upper midrange 2–4 kHz" framing here is *Harman's own* and it disagrees with Owsinski's "presence = 4–6 kHz". See §5, disagreement #4.

**2.2b Olive, S. E., Welti, T. & McMullin, E. (2013) `[X]` — paywalled.**

* *Listener Preferences for Different Headphone Target Response Curves.* AES 134th Convention, Rome, May 2013, Paper 8867 / e-Lib id 16768.
  <https://aes.org/publications/elibrary-page/?id=16768>
* Not reachable without AES membership. Its findings are used here **only** as relayed by §2.2a, which cites it directly.

**2.2c Harman "How to Listen" listener training `[S]`.**

* **Citation.** Olive, S. E. "Harman's 'How to Listen' — A New Computer-based Listener Training Program." *Audio Musings* (Olive's blog), May 2009.
  <http://seanolive.blogspot.com/2009/05/harmans-how-to-listen-new-listener.html>
  Companion site <https://harmanhowtolisten.blogspot.com/>.
* **Reliability.** Author's own blog describing his own software — primary-ish, but informal (`[S]` because it is not the peer-reviewed methodology paper).
* **Contribution `[S]`.** 17 training tasks across four attribute families: **timbre (spectral), spatial (localization/imagery), dynamics, and nonlinear distortion.** The *Band Identification* task trains listeners to name a modified band by **frequency, level and Q**, using peaks, dips, peak-and-dip pairs, high/low shelving and low/high/bandpass filters, subdividing the spectrum into progressively more bands. The *Spectral Plot* task trains listeners to "draw the perceived timbre… as a frequency response curve."
* **The key doctrine for this feature.** Harman's training deliberately **replaces** connotative audiophile vocabulary ("chocolaty", "silky") with terms that map onto *filter type, frequency, Q and gain*. The EQ Assistant's vocabulary map is doing the same translation in software: user's connotative word in, (type, f, g, Q) out. Design the vocabulary map to be the machine version of Band Identification, and prefer terms that Harman's programme itself would accept.

**2.2d Olive, S. E. (2025) `[V]` — the method-of-adjustment study, and the reason treble is no longer a rounding error.**

* **Citation.** Olive, S. E. "Determining the Preferred In-ear Headphone Target Response using a Method of Adjustment." AES International Conference on Headphone Technology, Espoo, Finland, 2025 August 27–29, Conference Paper 2. Sean Olive Audio Consulting; research supported by Harman International.
* **Reliability.** Read in full from the PDF `[V]`. **Its own header limits what it may be leaned on for**, and the limit is quoted rather than paraphrased: the paper "was selected based on a submitted abstract and 750-word precis that have been peer reviewed by at least two qualified anonymous reviewers. The complete manuscript was not peer reviewed." Treat as primary-author conference material one tier below the peer-reviewed journal sources in §2.5, not as a peer-reviewed result.
* **This is not the paper §6 is waiting for.** Olive, Welti & Khonsaripour, AES 2016 Headphone Technology paper 6-1 — the primary behind the **+4 dB** IE bass figure and the unsourced occlusion rationale — remains `[X]`. Different study, different year, different method.
* **Method `[V]`.** 36 listeners, all Harman employees at Novi, Michigan who participate in formal automotive listening tests: 83 % male, significant listening experience, 4 reporting mild hearing loss, mean age 33.9 (male) and 23.7 (female). A Sennheiser Momentum IE was equalised by inverse FIR to the **diffuse-field response of the B&K Type 5128 Head and Torso Simulator**, and that DF response was the baseline every adjustment was made relative to. A MEMS microphone in the sound nozzle measured the response on insertion so leakage could be detected and the fit corrected before each test. 12 trials per listener (3 programs × 4 observations), adjustments in 0.25 dB increments, playback at 78 dB SPL (B), three music tracks looped at 15–20 s. Each trial re-randomised the baseline tilt over ± 2 dB/octave; adjustment proceeded in three sequential steps — broadband tilt, then bass and treble refinement, then the midband filter — deliberately, "to make the task easier and hopefully more reliable than giving them 2 or 3 knobs to adjust all at once."
* **The adjustment filters, transcribed from Table 1 `[V]`.** This is the most directly usable thing in the paper for us: a published preference experiment whose instrument is expressed in exactly the parameter space the tuner emits.

  | Filter | Frequency | Q | Range |
  |---|---|---|---|
  | Bass shelf | 164 Hz | 0.4 | ± 12 dB |
  | Treble shelf | 4.304 kHz | 0.41 | ± 12 dB |
  | Mid peak/dip | 3 kHz | 2 | +6 dB to −10 dB |

* **Numbers transcribed `[V]`:**
  * **Mean preferred setting** was a tilt of **−1 dB/octave**, equivalent to a bass shelf of **+5 dB** and a treble shelf of **−2 dB** relative to the 5128 DF baseline.
  * **Mean adjustment to the 3 kHz midband filter was +0.1 dB**, with only 5 of 36 listeners moving it as far as ± 2 dB.
  * Agglomerative hierarchical clustering found **four listener segments** (36 %, 31 %, and two sharing the remaining 33 %), whose preferred levels span **+2 to +9 dB in the bass and −5 dB to +2 dB in the treble** relative to DF. Between-cluster range: **6.7 dB of bass and 6.3 dB of treble**; under 1 dB at 3 kHz.
  * **None of the four clusters accepted the raw 5128 DF target** — every one of them required the bass raised, by +2 to +9 dB.
  * **Program had no significant effect** on the preferred filter levels.
  * **Demographics were not predictive.** Discriminant analysis on age, gender, listening experience and self-reported hearing loss classified cluster membership in only 31 % of cases. The exception is cluster C4 (100 % prediction), the group taking the most bass and least treble, "all male, trained and with normal hearing and some with hearing loss".
  * Conclusion as the author states it: a single target cannot satisfy all listeners, but "most tastes can be accommodated with ± 3 dB adjustments to the bass and treble."
* **The author's own methodological caveat, which must travel with the 3 kHz result.** The bass and treble filters were re-randomised every trial; **the midband filter was fixed at 0 dB.** He names this as a possible reason the 3 kHz adjustments were so small, proposes the inverse experiment as future work, and records that "inspection of the raw data indicates that listeners did adjust the filter, but the adjustments were negligible."
* **Corroboration for the 3 kHz null, from within the paper `[S]` at one remove.** Ravizza et al.'s top five preferred curves cover a **± 3.5 dB range over an octave centred at 4 kHz**, and Olive's own earlier work found two IE target curves **differing by 5 dB between 2 kHz and 8 kHz** to be equally preferred. Lorho's much lower preferred 3 kHz level (4 dB) is explained away rather than reconciled — his baseline DF target had no bass adjustment available, so "it is likely that listeners compensated for the lack of bass by reducing the energy at 3 kHz."
* **Direct relevance, three ways.** It qualifies §2.2a's bass-dominance finding (see the amendment there). It supplies the evidence against offering a canal-resonance control at all (`TRANSDUCERS.md` §3.2). And its instrument — two wide shelves plus one narrow midband peak, adjusted by ear against a target — is the shelf-first strategy this document already recommends, run as an experiment and validated.

### 2.3 Audio Commons timbral models (EU H2020) `[V]` / `[S]`

* **Citations.**
  * Pearce, A., Brookes, T. & Mason, R. — *Deliverable D5.8: Release of timbral characterisation tools for semantically annotating non-musical content.* AudioCommons (H2020 project), Institute of Sound Recording, University of Surrey.
    <https://audiocommons.github.io/assets/files/AC-WP5-SURREY-D5.8%20Release%20of%20timbral%20characterisation%20tools%20for%20semantically%20annotating%20non-musical%20content.pdf>
    Fetched and text-extracted `[V]`.
  * Source code: <https://github.com/AudioCommons/timbral_models> `[V]`.
  * Blog: Pearce, A. "The Timbre of Sound", audiocommons.github.io, 5 Sep 2018 `[V]`.
* **Reliability.** Peer-reviewed-project deliverable + primary source code. Note the models are trained on **Freesound sound-effects**, not on music-through-headphones — a real external-validity caveat for our use.
* **Attribute set `[V]`.** hardness, depth, brightness, roughness, warmth, sharpness, boominess, reverb. The first seven are regressions trained on subjective ratings **0–100** (output may exceed the range; `clip_output` clamps). `reverb` is a **binary classifier** (1 = "sounds reverberant", 0 = not).
* **Definitions `[V]` (as given in project material — note they are qualitative):**
  * *brightness* — "a bright sound is one that is clear/vibrant and/or contains significant high-pitched elements."
  * *warmth* — "a warm sound is one that promotes a sensation analogous to that caused by a physical increase in temperature."
  * *boominess* — "a boomy sound is one that conveys a sense of loudness, depth and resonance."
  * *hardness* — scale illustrated: "a predicted hardness of 10 would sound fairly soft, whereas values of 90 would sound very hard."
  * Depth, roughness, sharpness, reverb: **no verbatim definition located** in the material I could read. D5.8 is a *usage manual*, not the definitional deliverable; the elicitation write-ups are in the earlier deliverables D5.1/D5.2 and in Pearce, Brookes & Mason (2017). **Not attributed here.**
* **The one hard frequency number `[V]`.** `Timbral_Booming.py` implements the Hashimoto booming index over third-octave bands (25 … 12 500 Hz) and uses a **280 Hz** cutoff to isolate the low-frequency component; final metric `boominess = 43.67·rms_boom − 10.90·ll + 26.84`. → Audio Commons' operational boundary for "boomy" is **below 280 Hz**.
* **Warmth band `[S]`.** `Timbral_Warmth.py` works on a **Bark-scale** "warmth region" and a separate high-frequency region, with a `max_WR` parameter defaulting to **12 000 Hz** and a **260 Hz** threshold applied when the estimated fundamental falls below it. I read these via an extraction layer rather than the raw file, so the exact Bark-band edges are marked `[S]`; **do not quote a Hz warmth band to Audio Commons.** The defensible statement is: Audio Commons places warmth in the lower-mid region and gates it on the fundamental around ~260 Hz.

### 2.4 Bobby Owsinski — *The Mixing Engineer's Handbook* `[S]`

* **Citation.** Owsinski, B. *The Mixing Engineer's Handbook* (Bobby Owsinski Media Group; 1st ed. Mix Books 1999, currently 4th ed.). The book itself is **not freely readable `[X]`**; the frequency tables are reproduced by the author on his own blogs, which is what I read `[V]`:
  * "A Description Of The Audio Frequency Bands", *Bobby Owsinski's Big Picture Music Production Blog*, June 2012.
    <http://bobbyowsinski.blogspot.com/2012/06/description-of-audio-frequency-bands.html>
  * "The Magic Frequencies For EQing Mix Elements".
    <https://bobbyowsinskiblog.com/magic-frequencies/>
* **Reliability.** Practitioner heuristic, author-published (so the attribution is safe even though it is not the book text). **Provenance caveat: this vocabulary was developed for mixing individual instrument tracks on loudspeakers, not for judging a finished master on headphones.** That mismatch is the source of most of §5's disagreements.

Band table `[V]`:

| Band | Range | Descriptors |
|---|---|---|
| Sub-bass | 16–60 Hz | "felt more than heard"; excess = muddiness |
| Bass | 60–250 Hz | rhythm-section fundamentals; overemphasis = **"boomy"** |
| Low mids | 250 Hz – 2 kHz | 500 Hz–1 kHz boost = **"horn like"**; 1–2 kHz boost = **"tinny"**; excess = fatigue |
| High mids | 2–4 kHz | masks speech recognition, "lisping quality"; 3 kHz boost = fatigue; dip 3 kHz on backing to clarify lead vocal |
| Presence | 4–6 kHz | "clarity and definition… Boosting this range can make the music seem closer"; reducing 5 kHz pushes it away |
| Brilliance | 6–16 kHz | brilliance/clarity; overemphasis = **sibilance** |

"Magic frequencies" `[V]`, the entries relevant to whole-mix listening:

* Voice — fullness 120 Hz, **boomy 240 Hz**, presence 5 kHz, **sibilance 4–7 kHz**, **air 10–15 kHz**
* Kick — bottom 80–100 Hz, **hollowness 400 Hz**, point 3–5 kHz
* Snare — fatness 120–240 Hz, point 900 Hz, crispness 5 kHz, snap 10 kHz
* Piano — **honky tonk 2.5 kHz**
* Horns — **piercing 5 kHz**
* Strings — **scratchy 7–10 kHz**
* Hi-hat/cymbals — clang 200 Hz, sparkle 8–10 kHz
* Guitar/organ — fullness 240–500 Hz, presence 1.5–5 kHz

### 2.5 Floyd Toole — resonance audibility and the case for gentle EQ

* **Primary read `[V]`.** Toole, F. E. "Loudspeakers and Rooms for Sound Reproduction — A Scientific Review." *Journal of the Audio Engineering Society*, Vol. 54, No. 6, June 2006, pp. 451–476. PDF fetched and text-extracted from
  <https://audioroundtable.com/misc/Loudspeakers_and_Rooms.pdf>.
  Verified quotation (p. 459): "The Toole and Olive investigations of the audibility of
  resonances yielded the interesting fact that repetitions of a sound lowered the detection
  thresholds for medium- and low-Q resonances within the sound [7]."
  Verified reference [7] as printed: "F. E. Toole and S. E. Olive, 'The Modification of
  Timbre by Resonances: Perception and Measurement,' J. Audio Eng. Soc., vol. 36,
  pp. 122–142 (1988 Mar.)."
  Verified summary bullet: "Equalization is the final touch, and, properly done, it works
  because low-frequency room resonances behave [predictably]"; and the caution that
  "Equalization schemes based only on room curves involve a risk that the wrong corrective
  measure will be applied to a problem."
* **Toole, F. E. & Olive, S. E. (1988) `[X]` — paywalled.** *The Modification of Timbre by Resonances: Perception and Measurement.* JAES 36(3):122–142.
  <https://www.aes.org/e-lib/online/browse.cfm?elib=5163>. AES e-Library, not reachable here.
* **Toole, F. E. *Sound Reproduction: The Acoustics and Psychoacoustics of Loudspeakers, Rooms and Headphones*, 3rd ed. (Routledge/Focal, 2017); 4th ed. with Olive & Welti (2025) `[X]` — book, not readable here.** A pirated full-text PDF surfaced in search results; it was **not** used.
* **Reliability.** Peer-reviewed (2006 review) / peer-reviewed (1988, unread) / textbook (unread).

**Findings, with honest confidence grading:**

1. `[V]` **Repetition lowers detection thresholds for medium- and low-Q resonances.** Direct quotation above. Consequence: a broad, low-Q colouration is what a listener will notice over a whole album — which is precisely the class of error this feature should correct.
2. `[V]` **"The detectability of resonances decreases approximately 3 dB for each doubling of the Q value." — VERIFIED against the primary, 2026-07-25.**

   > **Failure to retrieve a source is evidence about the fetcher, not about the claim.** Where a claim is unverified, say unverified — do not escalate to unsupported.

   Source, now read in full: **Toole, F. E. & Olive, S. E. (1988). "The Modification of
   Timbre by Resonances: Perception and Measurement." *JAES* 36(3), 122–142.** Presented at
   the 83rd AES Convention, October 1987. National Research Council, Division of Physics,
   Ottawa.

   From §6 "Summary and Discussion", p. 138 — the authors' own enumerated summary of
   audibility without time delay, based on steady-state measurements, verbatim:

   > "1) Low-*Q* resonances, producing broad peaks in the measurements, are more easily heard than high-*Q* resonances producing narrow peaks of similar amplitude.
   > 2) The detectability of resonances decreases approximately 3 dB for each doubling of the *Q* value.
   > 3) In general, pink or white noise are the most sensitive indicators of these resonances, with speech and music progressively less sensitive. Continuous signals with dense broadband spectra seem to be advantageous.
   > 4) With discontinuous, impulsive, or transient sounds… the addition of signal repetitions in the form of reflections and reverberation during recording or reproduction can increase the audibility of medium- and low-*Q* resonances (the improvement can be as much as 10–14 dB), but they will have little effect on resonances of high *Q* (*Q* >> 10).
   > 5) The duration of ringing is itself an unreliable indicator of the audibility of these resonances."

   Item 2 is attributed in the body (p. 123) to Fryer [2],[4], reported and endorsed by Toole
   & Olive: "the listeners were most sensitive to resonances of low *Q*, with the
   detectability decreasing approximately 3 dB for each doubling of the *Q* value."

3. `[V]` **The actual threshold figures — and the 0.25 dB number is still not among them.** The "5 kHz, Q = 1, ~0.25 dB with pink noise" figure previously carried at `[S]` **does not appear in this paper**. It remains unsourced; do not state it. What the paper *does* give is better, because it is expressed relative to programme spectrum level rather than as an absolute dB.

   Body, p. 124, verbatim:

   > "A resonance with *Q* = 1, for example, can be heard in noise when its maximum steady-state level is 25 dB below the spectrum level of the program, while one with *Q* = 50 can approach to within 10 dB (even less at low frequencies) of the spectrum level before being heard."

   And the figures most directly usable by this feature — §4.1, p. 134, describing the
   amplitude response at threshold **for the least revealing programme material (popular
   music)**, verbatim:

   > "Expressed as a tolerance, in the popular manner, the *Q* = 1 response curve is about ± 1.5 dB, the *Q* = 10 curve is ± 3 dB, and the *Q* = 50 curve is ± 5 dB."

   | Q | Amplitude-response tolerance at threshold (popular music) |
   |---|---|
   | 1 | ± 1.5 dB |
   | 10 | ± 3 dB |
   | 50 | ± 5 dB |

   **This is the single most directly applicable table in the whole research base**, because
   our users are listening to music, not pink noise — and the paper is explicit that music is
   the least revealing signal class. A broad (Q ≈ 1) move smaller than ~1.5 dB is at or below
   threshold on programme material; a narrow (Q ≈ 10) move needs ~3 dB to reach the same
   place. Note the corollary the paper draws immediately: these tolerances "may seem more
   acceptable, which perhaps explains the popularity of the specification."

4. `[V]` **Peaks are more audible than dips, and both become more audible as they widen.** Toole & Olive summarising Bücklein [3], p. 123, verbatim: "He concluded that, in general, peaks in the frequency response are more easily heard than the equivalent dips, and that both peaks and dips become more audible as their width increases."

   This is the acoustic justification for `PRIMER.md`'s rule preferring additive fills over
   clawing back accepted values — filling a dip is working on the less audible feature, so a
   fill has to be larger to be heard than a cut of the same magnitude would be. It also means
   **cut and boost are not symmetric in the tuner's cost function**, and the vocabulary map's
   `typical_gain_db` magnitudes should not assume they are.

5. `[V]` **Ringing duration is an unreliable indicator; initial amplitude is what matters.** Summary item 5 above, and the mechanism, p. 135, verbatim: "Since all three of these signals represent conditions at threshold, the implication is that it is the *initial* amplitude, not the duration, of the ringing that is related to the auditory detection process." Reinforced at p. 124: "the finding that the audibility of resonances decreases with increasing *Q* means that, in the time domain, the duration of ringing is an unreliable indicator of potential coloration."

6. `[V]` **Amplitude response is the more reliable predictor of audible effect than phase** — Toole & Olive relaying Moulana [6], p. 124: "while either amplitude or phase measurements can indicate the presence of resonances, the amplitude response appears to be more directly related to the audible effect", Moulana having concluded that "the subjective effect of these local irregularities is negligible if not absent in the first place".

   **This was formerly presented as the citation justifying `evaluate_chain` being magnitude-only. It is not strong enough for that, and the primary is now in hand — see `PHASE.md` §6.** The quote above is verified and stays `[V]`; what changes is its weight. Moulana's thesis contains **no phase experiment**: his conclusion is an argument from explanatory sufficiency (the magnitude account already fit his data, so the phase irregularity is assumed inert), his two "phase conditions" alter the magnitude response as well, and he lists the decisive test as future work. He also needs an **inter-state frequency shift** — a time-domain mechanism with no counterpart in a magnitude curve, maximal around 250–400 Hz — to explain data that driven-state loudness alone did not predict. Magnitude-only evaluation remains correct, on better grounds: a minimum-phase biquad's phase is entailed by its magnitude and is not an independent choice (`PHASE.md` §1), and the chain's measured group delay sits under every published audibility threshold (`PHASE.md` §4).

7. `[V]` **Programme material changes thresholds substantially, and music is the least revealing.** Summary item 3 above; and from p. 123, on Fryer's results: "All resonances were most easily heard with white noise as a test signal, with reduced sensitivity when using classical (symphonic) music, and with much reduced sensitivity when using popular music." Any threshold quoted from noise-based measurements is a *lower bound* on what our users will hear through music.
8. `[V]`-adjacent doctrine (from the 2006 review): EQ is "the final touch" and mis-diagnosis is the main risk — which is exactly why the EQ Assistant *stages* rather than *applies*. All bands, including AutoEq imports, are amendable (see `PRIMER.md`, "Stage classes and scope").

**Project ruling on Q, restated 2026-07-25 now that the primary is in hand.** Combining findings (1)–(4): the audible, correctable errors are broad and low-Q; narrow deep bands are both less audible and more likely to be mis-aimed; and dips are less audible than peaks. The EQ Assistant therefore defaults to **Q 0.7–1.4 for voicing moves**, reserves **Q ≥ 2.5** for named narrowband complaints only (sibilance, ring, honk), and never proposes Q > 6.0 (AutoEq's own peaking ceiling, §1.1).

**What the primary adds to that ruling, which was previously asserted from direction alone:**

* The Q-audibility trade is now **quantified** — roughly 3 dB per doubling of Q — so the preference for broad moves has a magnitude, not just a sign.
* There is now a **threshold floor per Q**, on music: ±1.5 dB at Q = 1, ±3 dB at Q = 10, ±5 dB at Q = 50. A move below the floor for its own Q is not a subtle move, it is an inaudible one. This composes with the ~2 dB measurement-reseat floor in `TRANSDUCERS.md` §3.1 and the 1–3 dB practitioner range in §7 — see `PSYCHOACOUSTICS.md` §5 for the combined picture.
* **Cut and boost are not symmetric.** Filling a dip is working on the less audible feature, so an additive fill must be larger than the equivalent cut to be heard. `vocabulary.json`'s `typical_gain_db` magnitudes currently assume symmetry; they should not.
* **Magnitude-only evaluation is justified** — but not by finding 6, whose weight is corrected above. The argument is minimum-phase entailment plus measured group delay; see `PHASE.md` §1 and §4.
* **Ringing duration is the wrong thing to reason about** (finding 5) — relevant because HQPlayer users are primed to think in time-domain terms by the filter/modulator vocabulary elsewhere in the app.

---

## 3. Spatial / crossfeed sources

### 3.1a Bauer — the root citation, via his patent `[VA]`

HQPlayer's crossfeed post-process is called `bauer`.

* **The paper.** Bauer, B. B. "Stereophonic Earphones and Binaural Loudspeakers." *JAES* 9(2), 148–151, April 1961. CBS Laboratories. **Paywalled `[X]`** — the AES e-Library quotes $33 for non-members and the direct download returns 404. **Nothing is attributed to its body text.** Reprinted in *Stereophonic Techniques*, ed. Eargle, AES, 1986, p. 373.
* **The free substitute, and it is a good one.** Bauer, B. B., "Stereophonic to Binaural Conversion Apparatus", **US Patent 3,088,997**, assigned to CBS, filed 29 December 1960, granted 7 May 1963. `https://patents.google.com/patent/US3088997A/en` — fully readable, verbatim-quotable, and filed a year *before* the JAES paper by the same author at the same lab. Reliability: primary source (granted patent).

**Caveat that must travel with any quote:** the Google Patents text is 1963 OCR and is visibly corrupted. Quotes below are transcribed exactly as served, damage included.

**The interaural delay — this is what fixes the error flagged in §3.2:**

> "the'time delay between theleft .-.and-.right ears of-the listener can'bevtaken to 'be .4 millisecond, corresponding toa projected interaural 'distance -f of 5.5- inches"

**0.4 millisecond = 400 microseconds**, for a projected interaural distance of 5.5 inches. Sanity check (ours, not the patent's): 5.5 in = 13.97 cm; at 343 m/s that is 407 µs — consistent, confirming the OCR'd ".4 millisecond" is the intended value and that the units are milliseconds. Elsewhere the same figure is OCR'd as ".4 second"; that is a dropout, and must not be propagated.

**Frequency behaviour, directly relevant to bs2b's 300–2000 Hz crossover range:**

> "The curve 29 indicates that .the desired delay time is well achieved up to 1 kilocycle per second, which is the frequency range where delay is most effective. Above l kilocycle per second, the amplitude function is more important"

> "Actually, only frequencies vbelow'about onel kilocycle need beso delayedsince, atffrequencies above this value, stereophonic perception appears to be a function largely vof sound intensity."

That is the duplex-theory rationale stated by the algorithm's originator, and it independently corroborates Meier's "delays of the frequencies below **2 kHz** are the most important" (§3.2) and the ~1.5 kHz ITD/ILD crossover (§3.3).

**Corrected reference values for interaural delay** `[VA]`, replacing the "300ms" extraction error flagged in §3.2: Aaronson, N. L. & Hartmann, W. M. (2014), "Testing, correcting, and extending the Woodworth model for interaural time difference", *JASA* 135(2), 817–823 — free via PMC, peer-reviewed. Verbatim: `ITD = (a/c)[θ + sin(θ)]` for `0 ≤ θ ≤ π/2`, with "a = 87.5 mm, c = 344 000 mm/s". **Derived, not quoted:** at θ = π/2 this gives ITD_max = 87.5 × (1 + π/2) / 344 000 ≈ **654 µs**. State it that way — cite the formula and parameters, show the arithmetic — rather than attributing a round "≈660 µs" to a source that never printed it. The paper also states: "The highest frequency at which human listeners are sensitive to the ITD in the fine structure of a waveform is about 1.5 kHz."

**No standards-body source specifying maximum ITD was located.** If the doc wants a standards-class citation for these numbers, it does not have one.

### 3.1 bs2b — Boris Mikhaylov `[V]`

* **Citations.**
  * Mikhaylov, B. *Bauer stereophonic-to-binaural DSP (bs2b).* Project home,
    <http://bs2b.sourceforge.net/> `[V]`.
  * `libbs2b` 3.1.0 sources — `src/bs2b.h`, `src/bs2b.c`, read via the DeaDBeeF mirror
    <https://github.com/DeaDBeeF-Player/bs2b/tree/master/libbs2b-3.1.0/src> `[V]`.
    (The upstream SourceForge tarball is the canonical origin; the mirror is byte-identical
    in the constants quoted.)
* **Reliability.** Primary source code + project documentation. This is the *definitive* authority for our crossfeed bounds because HQPlayer's "bauer" post-process is this algorithm and the app reimplements this model.

Constants transcribed from `bs2b.h` `[V]`:

| Constant | Value | Meaning |
|---|---|---|
| `BS2B_MINSRATE` / `BS2B_MAXSRATE` | 2000 / 384000 | Hz |
| `BS2B_MINFCUT` / `BS2B_MAXFCUT` | **300 / 2000** | crossover frequency, Hz |
| `BS2B_MINFEED` / `BS2B_MAXFEED` | **10 / 150** | feed, in **dB × 10** → **1.0 – 15.0 dB** |
| `BS2B_DEFAULT_CLEVEL` | `700 \| (45 << 16)` | **700 Hz / 4.5 dB** |
| `BS2B_CMOY_CLEVEL` | `700 \| (60 << 16)` | **700 Hz / 6.0 dB** (Chu Moy) |
| `BS2B_JMEIER_CLEVEL` | `650 \| (95 << 16)` | **650 Hz / 9.5 dB** (Jan Meier) |

Level packs fc in the low 16 bits and feed in the high 16 bits; the header comments feed as "dB * 10 @ low frequencies."

Coefficient derivation transcribed from `bs2b.c` `init()` `[V]`:

```c
GB_lo = level * -5.0 / 6.0 - 3.0;
GB_hi = level /  6.0 - 3.0;
G_lo  = pow( 10, GB_lo / 20.0 );
G_hi  = 1.0 - pow( 10, GB_hi / 20.0 );
Fc_hi = Fc_lo * pow( 2.0, ( GB_lo - 20.0 * log10( G_hi ) ) / 12.0 );
```

**This is the tonal-side-effect derivation — but read the caution below before using it.** `GB_lo` and `GB_hi` are *gains in dB applied to the summed (centre/mid) content*, and they are functions of `feed` alone. At the three presets:

| Preset | feed | `GB_lo` | `GB_hi` | `GB_lo − GB_hi` |
|---|---|---|---|---|
| default | 4.5 dB | −6.75 dB | −2.25 dB | −4.50 dB |
| cmoy | 6.0 dB | −8.00 dB | −2.00 dB | −6.00 dB |
| jmeier | 9.5 dB | −10.92 dB | −1.42 dB | −9.50 dB |

`GB_lo − GB_hi` reduces algebraically to exactly `−feed`. That identity is correct.

> **`GB_lo − GB_hi` is the shelf separation in the analog prototype, *not* the realised centre tilt**, which is taken after the mid path is normalised to 0 dB at DC.

The realised tilt is

```
tilt = 20·log10(1 − G_hi + G_lo)
```

using the `G_lo` / `G_hi` from the code block above. It **depends only on `feed` — the crossover frequency does not enter it** — and it **decreases** as feed rises:

| feed | 1.0 | 4.5 (default) | 6.0 (cmoy) | 9.5 (jmeier) | 15.0 |
|---|---|---|---|---|---|
| realised centre tilt | 2.70 dB | 1.81 dB | 1.53 dB | 1.09 dB | 0.92 dB |

The relationship is compressive: the whole 14 dB feed range moves tilt by 1.78 dB, so a ±1.5 dB feed nudge near the default changes tilt by roughly 0.3 dB — broad, and at or below audibility on its own.

This is the single most important spatial↔tonal coupling in the feature, and it runs **opposite to the common intuition** that more crossfeed means a duller centre. It is derived rather than asserted, and it is corroborated two ways: it matches the range stated in HQPTuner's own UI copy (1–2.7 dB), and it was verified numerically against the shipped implementation in `lib/xfeed.js`, which computes exactly this expression as `centerTiltDb`.

**Do not conflate this with bass summing.** Crossfeed also sums correlated low-frequency content between channels, which can raise perceived bass weight. That is a distinct effect and is *not* what the app's compensation stage corrects — compensation addresses the mid-path treble tilt only. No peer-reviewed quantification of the bass-summing effect was located; see the gap note in §3.4.

Project description `[V]`: the default preset simulates speakers "at a 30-degree azimuth about 3 meters away"; cmoy is "the most popular"; jmeier "produces minimal signal alterations… for relaxed listening." Implementation is "single pole recursive digital filters" combining a lowpass and a highboost so the summed response stays smooth and avoids comb-filter artefacts, the stated purpose being to remove the "superstereo effect" of hard-panned material on headphones.

### 3.2 Jan Meier `[V]`

* **Citation.** Meier, J. "A DIY Headphone Amplifier With Natural Crossfeed." Originally published on HeadWize (Chu Moy's archive); read via the HeadWize Memorial mirror, 9 March
  2018. <https://headwizememorial.wordpress.com/2018/03/09/a-diy-headphone-amplifier-with-natural-crossfeed/>
* **Reliability.** Practitioner/designer primary writing (Meier Audio), mirrored. Not peer-reviewed. The mirror is a faithful republication of the HeadWize original.
* **Contribution `[V]`:**
  * The problem statement: the **in-head localization** phenomenon. "With recordings presenting a wide soundstage, some instruments are heard in one of the two audio channels only. This is most annoying, like a bee buzzing in one's ear." → the canonical justification for the `too wide` / `hard-panned` / `ping-pong stereo` complaints.
  * Frequency dependence: "the delays of the frequencies below **2 kHz** are the most important"; "For higher frequencies the delay is reduced," mirroring head shadowing.
  * Physical basis: sound from a right-side source reaches the left ear "attenuated and delayed", and these ITD/ILD differences "provide important directional information."
  * **The tonal side effect, in Meier's own framing:** "Especially in the high frequency range, the delayed crossfeed signal interferes with the original input and attenuates specific frequencies" — i.e. comb filtering on centre-panned material. His remedy is a frequency-dependent delay plus "small, frequency dependent attenuation" of the direct signal so mono content survives without colouration. → **Independent confirmation, from a different implementer, that crossfeed colours the centre and that the correct response is a compensating filter — exactly what the app's crossfeed-compensation block does.**
* **Caveat `[S]`.** The extraction of this page rendered an interaural delay figure as "300ms", which is physically impossible; the ear-to-ear extra path at ~30° azimuth is ~0.25–0.3 **milliseconds** (≈300 µs). **Do not quote a delay number to Meier without re-reading the page.** The qualitative claims above are unaffected.

### 3.3 Crossfeed / binaural perception background `[S]`

* **Citation.** Wikipedia, "Crossfeed." <https://en.wikipedia.org/wiki/Crossfeed> `[V]` — read, and **thin**: it defines crossfeed as "the process of blending the left and right channels of a stereo audio recording", names Dolby Headphone and bs2b, gives **no** frequency range and **no** discussion of tonal side effects, and carries a "needs additional references" banner (Oct 2024). Reliability: community wiki, low. Cited only to record that it does *not* support the tonal-side-effect claim — that claim rests on §3.1 and §3.2.
* **Citation `[S]`.** Shaik, M. et al., "Stereo widening system using binaural cues for headphones." Available via ResearchGate:
  <https://www.researchgate.net/publication/313902363_Stereo_widening_system_using_binaural_cues_for_headphones>.
  Read only through search-result summarisation `[S]`, not the full text. Contributes the
  standard framing: **ILD, ITD and ICC (inter-channel coherence) are the dominant cues for
  externalization**; ITD/ILD dominate **below ~1.5 kHz** with head shadowing dominant above;
  **low ICC → more spaciousness**, high ICC → narrower, more centred image.
  → This is the theoretical backing for the direction convention in `vocabulary.json`:
  raising crossfeed *raises* inter-channel coherence, therefore narrows and centres.
* **Reachability note.** A beyerdynamic support article on their crossfeed model (<https://support.beyerdynamic.com/hc/en-us/articles/24721890938908>) returned **HTTP 403 `[X]`** and is not cited.
* **Not located.** I did not find a *peer-reviewed* paper specifically quantifying the **tonal** (as opposed to spatial) consequence of summing correlated bass in a crossfeed network. The claim as used in this project is grounded instead in the bs2b source algebra (§3.1, `[V]`, exact) and Meier's design account (§3.2, `[V]`, qualitative). **That is a known gap; if a future agent finds such a paper, add it here.**

---

## 4. Ruling policy for conflicting frequency ranges

When sources disagree on where a term lives, this project resolves in this order:

1. **Use case wins.** HQPTuner tunes a *finished stereo master reproduced on headphones, already corrected toward the Harman target by AutoEq.* Sources developed for that context (Olive/Harman, oratory1990 preset data, AutoEq) outrank sources developed for mixing individual multitrack elements on loudspeakers (Owsinski).
2. **Perceptual definition sets the *kind*, practitioner data sets the *number*.** ITU-R BS.2399 / the Sound Wheel says whether a term means "low bass resonance" or "upper bass resonance"; Owsinski and the community supply the Hz. Where the two are inconsistent, the Sound Wheel's ordering constraint is preserved and the Hz range is moved to satisfy it.
3. **Broader beats narrower** (Toole, §2.5). Given a choice between a wide range with low Q and a narrow one with high Q, take the wide/low-Q reading. Under-correcting is recoverable in the next turn; a surgical notch aimed at the wrong frequency is not.
4. **Never exceed the AutoEq envelope** (§1.1), because the EQ Assistant's bands stack on top of AutoEq bands in the same chain and share the same headroom budget.
5. **Confidence is recorded, not hidden.** Where a term is genuinely contested, its `vocabulary.json` entry carries `confidence: "medium"` or `"low"` and a `notes` line naming the conflict. A low-confidence term is a candidate for the `clarify` branch of the response schema rather than a confident diff.

---

## 5. Source disagreements — stated, not papered over

> Not every entry below is a *disagreement to adjudicate* — the premise that two sources placing a word in different places means one of them must be wrong is false for a subset of terms.
>
> **`warm`, `bright`, `dark`, `presence` and `full` are polysemous.** They are not descriptors of a single feature of sound the way `nasal` or `sibilant` are; they are generic descriptors used fluidly, sometimes contradictorily, by the same listener in the same session. `warm` especially can mean several different things about a midrange. When Holt defines `warm` as a broadband downward tilt (`LEXICONS.md` §3.5) and elsewhere calls a mid/upper-bass exaggeration "excessively warm", he is not being inconsistent — he is recording two senses. When Holt's `presence` is tonal and Rumsey's and SAQI's are spatial (`LEXICONS.md` §4.1), that is three real meanings, not a collision with a right answer.
>
> **Consequence for `vocabulary.json`, and it is a design change, not a note:** a polysemous term carries *multiple attested senses* rather than one region, and **a bare polysemous term with no disambiguating context is a `clarify`, not a guessed diff.** That is already `clarify` mode 2 in the response schema (`PRIMER.md`); it turns out to be far more common than the previous map implied, because the previous map silently committed each of these words to one flavour. The disambiguating question must be posed in listening terms — "warmer overall, or more body on voices and lower strings?" — never in filter terms.
>
> **This does not apply to the whole vocabulary.** `boomy` is comparatively specific, as are `nasal`, `sibilant`, `honky`, `boxy` and `shrill` — those name a particular colouration, and where sources disagree about them the disagreement is real and the rulings below stand.
>
> Sense inventories live in `vocabulary.json`; the evidence for each sense lives here and in `LEXICONS.md`.

### Disagreement 1 — "boomy": 60–150 Hz vs ~240–280 Hz

* **Owsinski `[V]`** places "boomy" at **240 Hz** in the voice table, and defines the 60–250 Hz band as the one whose overemphasis "produces a boomy quality" — so his boomy is *upper*-bass-inclusive and centres nearer 200–250 Hz.
* **Audio Commons `[V]`** operationalises boominess against a **280 Hz** low-band cutoff — an even higher ceiling, though as an *analysis band*, not a peak location.
* **ITU-R BS.2399 / Sound Wheel `[V]`** says boomy is "resonances in the **low** bass", and separately assigns "**upper bass**" resonance to *boxy*. That ordering constraint is incompatible with putting boomy at 240 Hz while boxy sits higher still.
* **Headphone-listening usage** (the AutoEq/Harman context, and how users of this app will actually use the word) puts "boomy" on the one-note bass hump around 60–150 Hz.
* **RULING: `boomy` = 60–150 Hz, cut, Q 0.7.** Reasons: the Sound Wheel's low-bass / upper-bass ordering is authoritative for *meaning* and forces boomy below boxy and below muddy; the headphone use case dominates (rule 1); and Olive's finding that bass level is the dominant preference axis (§2.2a) means the low-bass reading is the one users will actually be complaining about. Owsinski's 240 Hz sense is captured instead by **`tubby`** and **`muddy`**, which sit at 150–350 Hz. Recorded in `vocabulary.json` under `boomy.notes`, `confidence: "high"` for the ruling, with the conflict named.

### Disagreement 2 — "warm" and "muddy" occupy the same frequencies with opposite valence

* **Owsinski `[V]`** literally fuses them: 250 Hz is "**fullness or mud**", one entry, two meanings. His voice table puts "fullness" at 120 Hz and "boomy" at 240 Hz.
* **Audio Commons `[S]`** treats warmth as its own regression over a lower-mid Bark region gated near a ~260 Hz fundamental threshold, with no notion of "too much warmth = mud".
* **ITU-R BS.2399 `[V]`** has no "warm" attribute at all; it decomposes the same territory into *Bass strength*, *Bass depth*, *Boomy*, *Boxy*, and the *Dark–Bright* balance axis, and lists "muddy" only as the antonym of *Clean*.
* **Holt `[VA]`** supplies a *fourth* reading that none of the above anticipated, and it is not a frequency at all but a filter shape: `dark` = "a frequency response which is **clockwise-tilted across the entire range**", `warm` = "the same as dark, but less tilted", with `tilt` formally defined as "Across-the-board rotation of an otherwise flat frequency response." On those terms `warm` is a broadband downward slope. Yet his `fat` entry reads "a moderate exaggeration of the mid- and upper-bass ranges. **Excessively 'warm.'**" — the bump reading. Full quotes and the surrounding entries: `LEXICONS.md` §3.5.

* **RULING: `warm` is polysemous and is not resolved to a single region.** `warm` carries senses, and a bare "make it warmer" with no disambiguating context is a `clarify`:

  | Sense | Region | Type | Direction | Attested by |
  |---|---|---|---|---|
  | lower-mid body | 100–300 Hz | peak | boost | Owsinski `[V]`, Audio Commons `[S]` |
  | upper-bass fullness / "fat" | 80–250 Hz | lshelf | boost | Owsinski "fullness" 120 Hz `[V]`; Holt `fat` `[VA]` |
  | broadband downward tilt | treble-referenced | hshelf | cut | Holt `dark`/`warm`/`tilt` `[VA]` |

  The third sense is a filter *type* difference rather than a centre-frequency difference — a
  bell at 200 Hz does not deliver what a listener quoting Holt's sense is asking for.

* **`muddy`, by contrast, is not polysemous and its ruling stands.** `muddy` = 200–400 Hz, **cut**, −3.0 dB, Q 1.0, `confidence: "high"` — there is broad agreement that the complaint names excess lower-mid energy. The practitioner survey (§7) strengthens this: every source that gives a range starts it at 150–200 Hz; only the ceiling is contested (300 / 350 / 500 / 700 Hz). Note also that Mike Senior, asked directly for a "mud" frequency, **declines to give one** and reframes it as inter-track masking — see §7.

* **The conflict-pair rule holds, in narrowed form.** A `warm` boost and a `muddy` cut still must not be emitted together *when the warm sense chosen is lower-mid body or upper-bass fullness*, because those cancel. The broadband-tilt sense does not collide with `muddy` at all, since it acts on the treble. Encoded in `_meta.conflict_pairs` with the sense qualifier.

### Disagreement 3 — the "presence" / "forward" region: 2–4 kHz (Harman) vs 4–6 kHz (Owsinski)

* **Owsinski `[V]`** names **4–6 kHz** the "Presence" band, "responsible for the clarity and definition of voices and instruments. Boosting this range can make the music seem closer to the listener"; reducing 5 kHz pushes it away. His 2–4 kHz band is instead the one that "can mask the important speech recognition sounds… introducing a lisping quality."
* **Olive / Harman `[V]`** consistently locate the *forwardness* problem at **2–4 kHz**: the DF targets were criticised for "too much emphasis in the upper midrange (2–4 kHz)", and the Lorho target sounded "muffled and dull" for having "too little energy at 2–4 kHz". Lorho's whole intervention was cutting the **3 kHz** DF peak from 12 dB to 3 dB.
* **What §2.2d adds, and it lowers the stakes rather than settling anything.** Listeners in the 2025 method-of-adjustment study left a 3 kHz control essentially untouched (+0.1 dB mean), and two further results cited there put the tolerated spread through this region at ± 3.5 dB across an octave at 4 kHz, and at 5 dB between 2 and 8 kHz between two equally-preferred targets. Neither camp's band boundary is contradicted; both are being argued over inside a region listeners seem to accept several dB of variation in.
* **Root cause of the disagreement.** These are different measurements of different things. Owsinski is describing where you boost a *single track* to bring it forward in a *mix*; Harman is describing where a *headphone transfer function* error makes a *whole master* sound shouty. For a headphone-listening app, Harman's framing is the relevant one.
* **RULING: split the concept.**
  * `forward` / `recessed` → **2000–5000 Hz**, the Harman-anchored upper-midrange axis, Q 1.0, ±2.5 dB. This is where "vocals sound distant" and "it's shouting at me" actually live.
  * `presence` (as a positive descriptor of clarity/definition) → **4000–6000 Hz**, Owsinski's band, retained because the *word* "presence" is his and users use it his way. Carried in `vocabulary.json` as a sense of the polysemous `presence` entry rather than as a separate `present` term — **renamed 2026-07-25**, recorded in `_meta.corrections`. The map is authoritative for the live name.
  * `honky` → **500–1200 Hz** (Owsinski's "horn like" 500 Hz–1 kHz), distinct from both.
  * `nasal` → **800–2000 Hz**, per the Sound Wheel's "closed sound with pronounced midrange" plus Owsinski's "1–2 kHz boost makes them sound tinny".
  * `harsh` → **2500–5000 Hz**, overlapping `forward` but always a cut, and Q 1.4 rather than 1.0 because harshness is the narrower percept of the two. `confidence: "medium"` on `forward`/`recessed` with the conflict recorded in `notes`.

### Also-ran disagreements (recorded, lower stakes)

* **"Air"** — Owsinski gives **10–15 kHz** in the voice table but **16 kHz** in the magic- frequency list; the Sound Wheel's *Brilliance* covers this with no number. **Ruling: high shelf at 10 kHz, effective 10–16 kHz**, which additionally sits exactly on AutoEq's `DEFAULT_TREBLE_BOOST_FC = 10000.0` and its shelf `MAX_FC = 10000.0` `[V]` — so an air move is representable in the same grammar as an AutoEq shelf.
* **"Sibilant"** — Owsinski's voice table says **4–7 kHz**, his band table attributes sibilance to the 6–16 kHz "Brilliance" band, and de-esser practice generally works **5–9 kHz**. **Ruling: 5000–8000 Hz, fc 6300, cut, Q 2.5** — the one deliberately narrow entry in the tonal map, justified because sibilance genuinely is a narrowband percept (Sound Wheel classes *Shrill* as an **artefact**, not a timbre). **Narrowed from 5000–9000 / fc 6700 on 2026-07-25**, recorded in `vocabulary.json` `_meta.corrections`; the ceiling came down to stay clear of the coupler-artifact region (`TRANSDUCERS.md` §4). The map is authoritative for the live values.
* **"Boxy"** — Owsinski's nearest datum is kick-drum "hollowness at **400 Hz**"; the Sound Wheel says "upper bass". **Ruling: 300–600 Hz**, satisfying both.

---

## 6. Summary of unreachable sources

| Source | Why | Consequence |
|---|---|---|
| ~~Toole & Olive, JAES 36(3):122–142 (1988)~~ | **RESOLVED** | **Read in full `[V]`.** §2.5 is written around it. Local copy is gitignored, not committed. |
| ~~Moore & Tan, JASA 114(1):408–419 (2003)~~ | **RESOLVED** | **Read in full `[V]`.** `PSYCHOACOUSTICS.md` §4.3. Local copy gitignored. |
| ~~Audio Commons D5.1/D5.2~~ | **RESOLVED** — both are public | Read `[VA]`. **Finding: D5.2 models six attributes and sharpness is not among them** — "sharp"/"blunt" appears only as a D5.1 ontology classification. §2.3's eight-attribute list comes from the later D5.8 and is a version difference, not an error. |
| ~~beyerdynamic crossfeed support article~~ | **RESOLVED** | Captured `[VA]`. |
| r/oratory1990 wiki + FAQ | **Permanently `[X]`.** Fetcher-level domain block on `reddit.com` *and* `web.archive.org`; `r.jina.ai` proxy returns 401; one mirror attempted and failed | No reasoning attributed to oratory1990. Only his preset *data*, observed in the AutoEq repo, is used. This is settled — do not spend further effort. |
| Bücklein, JAES 29(3):126–131 (1981) | AES e-Library paywall | Peaks-versus-dips finding usable at one remove, since Toole & Olive summarise it in a paper read in full `[V]`. Its own dB thresholds unobtained. |
| Pedersen & Zacharov, AES 138 Paper 9310 (2015) | AES e-Library paywall; FORCE Technology's own article cites it but hosts no PDF | Sound Wheel cited via the free ITU-R BS.2399-0 reproduction instead. |
| Olive, Welti & McMullin, AES 134 Paper (2013), e-Lib 16768 | AES e-Library paywall; a ResearchGate copy exists but 403s | Findings used only as relayed by Olive's own 2022 *Acoustics Today* article. |
| Olive, Welti & Khonsaripour, AES 2016 Headphone Tech, paper 6-1 | AES paywall; landing page read | The **+4 dB** IE bass figure is solid via Olive 2022 `[V]`. The *occlusion rationale* for it is **not** sourced — and is independently questionable, since the occlusion effect adds LF energy. See `TRANSDUCERS.md` §3.2. |
| Bristow-Johnson, AES Preprint 3906 (1994) | AES paywall | Would settle the peaking-Q convention outright. Two free routes remain untried first — see `FILTER-MATH.md` §7. |
| Bauer, JAES 9(2):148–151 (1961) | AES paywall ($33) | **Substance recovered free** from US Patent 3,088,997 (same author, same lab, filed 1960) — see §3.1a. The paper would be a nicer citation, not new information. |
| ~~Orfanidis, *Introduction to Signal Processing*, EQ chapter~~ | **RESOLVED** — hand-fetched, read from page images (the local PDF's text layer is damaged) | **Read in full `[V]`, and the answer is negative.** It does *not* contain the canonical shelf-Q reconciliation it was nominated for: his shelving filters are **first-order**, specified by `{G₀, G, G_c, ω_c}`, with no `S`, no shelf `Q` and no resonant-shelf form — so he cannot adjudicate RBJ's second-order shelf `Q` at all. On the peaking side he declines to fix a bandwidth reference gain, calling the definition of Δω "arbitrary, and not without ambiguity" (p. 582), and abandons `Q` entirely once gain is a free parameter. Contributes the `G_B` menu and the boost/cut symmetry tie-breaker instead. `FILTER-MATH.md` §4 and §7. Local copy gitignored, not committed. |
| GRAS technical documentation | `grasacoustics.com` 403s domain-wide to this fetcher | RA0402's "± 2.2 dB from 10 to 20 kHz" tolerance stays `[S]`, uncorroborated. The 13.5 kHz coupler resonance *is* independently corroborated by audioXpress `[VA]` and COMSOL `[VA]`. |
| ISO 226:2003 contour tables | ISO paywall | Scope confirmed from ISO's catalogue `[S]`. **The 60-vs-80-phon bass shift is not stated anywhere in this project**, and must not be read off a graph. |
| Toole, *Sound Reproduction* (3rd/4th ed.) | Book. A pirated PDF appeared in search results and was not used. | No longer load-bearing: the 1988 primary it was being used to proxy has now been read directly. |
| Zacharov & Koivuniemi, AES 19th Int. Conf. (2001), pp. 272–286 | Not fetched | Citation **corrected** from an earlier mis-attribution to the AES 109th/110th Convention, per Rumsey's own reference list [10]. |
| Bech (2002), JAES 50, 564–580 | Not fetched | Surfaced late, in Moore & Tan's reference list. By title the most on-point source yet identified for ripple-audibility thresholds. |
| FORCE Technology high-resolution Sound Wheel file | Behind a registration form | ITU reproduction used instead; no loss. |
| harman.com `audioscience_0.pdf` (Toole) | TLS chain verification failure — incomplete cert chain, reproducible on both host variants | Not cited. |
| Rtings target-curve definition | Client-rendered SPA; four URLs tried, zero body text | Retrievable with the repo's playwright if wanted. |
| SBAF forum threads | HTTP 403 at the edge, twice (not a login wall) | **Not a loss.** Their published methodology lives in a fetchable GitHub repo, which is the better citation — and it establishes their data is not comparable to ours. `TRANSDUCERS.md` §4. |
| A peer-reviewed quantification of crossfeed's tonal side effect | Still not found | **Gap substantially narrowed, not closed.** Now rests on bs2b source algebra `[V]`, Meier `[V]`, two independent implementer figures `[VA]`, and the correlated-summation ceiling `[VA]`. See §3. |
| Sonion EST (electrostatic IEM) datasheets | Not located; likely NDA-gated | Provisional finding: **no public EST datasheet exists.** |
| Insertion-depth effect in dB | Not found after a dedicated hunt | Direction sourced `[VA]`, magnitude not. One `[S]` lead failed TLS and must not be cited. |
| ~~Jiang et al., *Analysis and Development of Hybrid Earphone Combining Balanced-Armature and Dynamic Receivers*, Applied Sciences 9(23):5047 (2019), DOI 10.3390/app9235047~~ | **RESOLVED** | **Read in full `[V]`.** The RMS-SPL-deviation numbers from the abstract (hybrid 4.60, dynamic-alone 8.94, BA-alone 6.04) are the *optimized*-tube result — the full text also gives the *un*-optimized (prototype-tube) hybrid figure, 9.70, **worse than either driver alone**, which the abstract omits. `TRANSDUCERS.md` §2.1 is written around the full text. |

---

## 7. Practitioner frequency charts — the consensus, and its limits

Owsinski (§2.4) carries a provenance problem: those ranges were developed for mixing individual instrument tracks on loudspeakers, not for judging a finished master on headphones. A survey of 17 further sources was run to see whether weight of evidence could adjudicate the disputes. It could, partially — and it also produced a negative result that matters more.

**The negative result, stated plainly.** Of the 17 sources, only four are mastering- or headphone-stage, and only one of those gives Hz-descriptor pairs at all. **No published practitioner descriptor chart addresses judging a finished master on headphones. Every chart we can cite is a mixing chart, and we are extrapolating.** Adding sources did not cure the Owsinski mismatch; it demonstrated the mismatch is universal across the practitioner literature. That belongs in any honest account of the feature's confidence.

**Where the consensus actually is** (full per-source table in the research capture; sources are `[VA]`, tier `practitioner heuristic` / `vendor content marketing` unless noted):

| Descriptor | Consensus | Notes |
|---|---|---|
| **nasal / honky** | **500 Hz – 1.5 kHz** — strongest agreement in the corpus | Three independent sources. **Two of them treat "nasal honk" as one phenomenon**, which bears on whether our map should split them at all. Audio University's 700 Hz–3 kHz is the outlier. |
| **muddy** | Floor agreed at **150–200 Hz**; ceiling contested — 300 / 350 / 500 / 700 Hz | The mastering-context source (Waves, 150–350 Hz) is narrowest and closest to our use case. |
| **boxy** | Two camps: **150–500 Hz** (four sources) vs **800 Hz–1.2 kHz** (one) | The outlier is specifically about *snare* boxiness — plausibly a different physical resonance, not a contradiction. |
| **presence** | Two clusters: **1–4 kHz** vs **3–6 kHz** | iZotope's range is explicitly *the same band it calls harshness* ("presence or harshness", 1–4 kHz) — one source saying presence and harshness are one region differing in degree. |
| **air** | **7–12 kHz** (mixing) vs **10–15 kHz+** (mastering) | The mastering figure is the highest. Broad-shelf "air" on a finished programme sits higher than instrument "air" in a mix. |
| **harsh** | **1–4 kHz** vs **3–8 kHz** — disagree by an octave, no third source to adjudicate | Notably, *Sound On Sound* never assigns "harsh" a frequency across four articles despite using the word. |
| **sibilance** | **A single data point in the entire corpus** (7.5–10 kHz) | Effectively uncorroborated. See §5 "Also-ran" and the coupler-artifact caution in `TRANSDUCERS.md` §4. |
| **warmth** | Two data points, both per-instrument, disagreeing | Unsupported at whole-programme level. Consistent with `warm` being polysemous (§5). |

**Move size on a finished master — four independent mastering sources converge on 1–3 dB:**

| Source | Verbatim |
|---|---|
| Waves (2017) | "Professional mastering engineers rarely cut or boost any frequency area by more than 1.5 dB." |
| Yoad Nevo, quoted in the same | "If you have to EQ more than 2 or 3 dB, then you're probably doing something wrong." |
| Galindo (iZotope, 2022) | "EQ adjustments tend to be about 1 dB or less on a specific frequency range" — contrasted with 3–5 dB in mixing |
| Stewart (iZotope, 2025) | "small moves of ±3 dB with a broad Q are a good place to start" |

Every source that mentions Q says **broad**; not one names a numeric Q. Cutting is preferred to boosting across the board.

**Relation to our ±6 dB per-turn policy.** That figure is provenanced to AutoEq's `DEFAULT_MAX_GAIN` — a tool correcting a *transducer*. These sources are voicing a *finished master*. Our chain does both at once, so the policy is not wrong, but it should be understood as a transducer-correction envelope being used for voicing rather than as a voicing convention. See `PSYCHOACOUSTICS.md` §5.

**Two entries worth reading in full rather than summarising:**

* **Mike Senior, asked directly what frequency "mud" is, declines to give one** and reframes it as inter-track masking rather than a band (*Sound On Sound*, Sound Advice, Nov 2008) `[VA]`. A named senior practitioner explicitly refusing the descriptor→Hz mapping this feature is built on. Doubly relevant: a finished master has no separable tracks, so his remedy is unavailable to us by construction.
* **SoundGuys** `[VA]` instructs users to set preamp to "the same amount as your largest boost". That is the *largest single band* rule, and §1.1's HD 650 verification disproves it directly (largest band +6.4 dB, preamp −6.1 dB). Cited here as a countered claim, because it is the most common form of the error.

---

## 8. Companion documents

Six companions carry further material, on the same tagging discipline:

| Document | Covers |
|---|---|
| `HEARING.md` | The listener rather than the transducer. Audiometry and what dB HL is, why a threshold shift is not a gain figure, the suprathreshold deficits audibility does not restore (recruitment, broadened filters, dead regions, temporal fine structure, diplacusis), why static EQ is not a prescription, the evidence against a hearing-loss target curve, gain ceilings and exposure cost, tinnitus and hyperacusis, and the medical-boundary recognition criteria. |
| `TRANSDUCERS.md` | What the tuner is physically EQ-ing. Driver technologies (dynamic / planar / electrostatic / balanced armature), pads, seal, reseat variance, insertion depth, tips, venting, ear-canal resonance, measurement rigs and their trust ceiling, and the AutoEq profile-provenance gap. |
| `LEXICONS.md` | The validated attribute vocabularies in full — SAQI's 48 attributes, Rumsey's four-level spatial hierarchy, Holt's ~250 entries with his band map and vowel ladder — plus the cross-source collisions. |
| `PSYCHOACOUSTICS.md` | Auditory filter bandwidth (ERB/Bark), equal-loudness contours, level matching in listening tests, resonance-audibility thresholds, spectral tilt and ripple, and the combined audibility floor. |
| `FILTER-MATH.md` | The RBJ cookbook primary, the three bandwidth parameterisations and their traps, shelf Q ⇔ shelf slope, the W3C normative biquads, EQ APO's grammar, headroom and true peak. |
| `PHASE.md` | Phase and group delay. Why a minimum-phase band's phase is not a choice, the derived phase and group-delay figures for our own stages and for the real HD 650 chain, the group-delay audibility thresholds, the Moulana correction to finding 6 above, interchannel phase and what asymmetric per-ear EQ would cost, and why the crossfeed compensation must stay magnitude-only. |
