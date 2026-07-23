# SOURCES.md — AI Sound Tuner research base

Compiled 2026-07-22 for the HQPTuner **AI Sound Tuner** feature.
Every claim below is tagged with how it was obtained. Nothing here is invented; where a
source could not be reached, that is stated instead of paraphrasing what it "probably" says.

**Verification legend**

| Tag | Meaning |
|---|---|
| `[V]` | I read the primary artefact directly (source file, PDF text, raw doc) and the numbers below are transcribed from it. |
| `[S]` | Secondary only — I could reach a summary/derivative but not the primary. Treat the number as indicative, re-verify before relying on it. |
| `[X]` | Could not reach at all. Listed for completeness; **no content attributed**. |

**Reliability classes**: `peer-reviewed` · `standards-body` · `industry-standard lexicon` ·
`primary source code / project documentation` · `practitioner heuristic` · `community wiki`.

---

## 1. EQ engine conventions (the clamp authority)

### 1.1 AutoEq — Jaakko Pasanen `[V]`

* **Citation.** Pasanen, J. *AutoEq — Automatic headphone equalization from frequency
  responses.* Open-source project, MIT licence. <https://github.com/jaakkopasanen/AutoEq>
  Files read: `autoeq/constants.py`, `autoeq/frequency_response.py`, `autoeq/peq.py`,
  `results/oratory1990/over-ear/Sennheiser HD 650/Sennheiser HD 650 ParametricEQ.txt`.
* **Reliability.** Primary source code / project documentation. Highest confidence class in
  this document because the numbers are executable, not editorial.
* **What it contributes.** The numeric envelope our clamps must live inside, and the exact
  `ParametricEQ.txt` grammar the app already parses.

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

**Preamp derivation — precise finding `[V]`.** In `frequency_response.py`,
`write_eqapo_parametric_eq` emits

```python
s = f'Preamp: {-compound.max_gain:.1f} dB\n'
s += f'Filter {i + 1}: ON {types[filt.__class__.__name__]} Fc {filt.fc:.0f} Hz Gain {filt.gain:.1f} dB Q {filt.q:.2f}\n'
```

so the preamp is **the negative of the maximum of the *summed* magnitude response of the
whole filter set**, not the negative sum of the positive band gains, and not the negative of
the largest single band. The `PREAMP_HEADROOM = 0.2` dB margin appears in the *minimum-phase
FIR* path (`fr.raw -= np.max(fr.raw); fr.raw -= PREAMP_HEADROOM`), not in the parametric text
export.

**Corroborating real preset `[V]`** — `Sennheiser HD 650 ParametricEQ.txt` (oratory1990,
over-ear):

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

Note that the largest single gain is `+6.4` dB but the preamp is `-6.1` dB — direct
confirmation that the preamp tracks the summed response, because the `-3.1` dB band at
118 Hz partially cancels the `+6.4` dB shelf. **The AI tuner must recompute headroom the same
way**: sum the whole chain's magnitude response, take its maximum, negate.

Type tokens: `PK` = peaking, `LSC` = low shelf, `HSC` = high shelf. Shelves in shipped
oratory1990 presets are uniformly `Q 0.70`.

### 1.2 RBJ Audio EQ Cookbook `[S]`

* **Citation.** Bristow-Johnson, R. *Cookbook formulae for audio EQ biquad filter
  coefficients.* Widely mirrored (originally musicdsp.org / W3C Audio WG appendix).
* **Reliability.** De-facto industry-standard reference implementation.
* **Contribution.** HQPlayer's `iir:` stage response math is the standard RBJ biquad set —
  this is stated as ground truth by the commissioning brief and is consistent with the
  `q` / `bw` / `s` (shelf-slope) parameter triad HQPlayer exposes. I did not re-derive the
  formulae here; the app already implements them.

### 1.3 oratory1990 `[X]` — **UNREACHABLE**

* **Attempted.** `https://www.reddit.com/r/oratory1990/wiki/index/faq/` and
  `https://old.reddit.com/r/oratory1990/wiki/index/faq/`.
  Both refused by this environment's fetcher ("unable to fetch from www.reddit.com").
* **Reliability class if reached.** Community wiki authored by a working headphone
  acoustician — high-quality practitioner heuristic, not peer-reviewed.
* **What is therefore NOT attributed here.** His stated reasoning about why he chooses
  particular Q values, his position on user-modification of presets, and his written
  rationale for preamp values. Do not cite him for those without fetching the wiki.
* **What IS safe to say.** His preset *outputs* are vendored in the AutoEq repository under
  `results/oratory1990/…` and are directly observable `[V]` — the HD 650 file above is one.
  Conventions visible in the data: one low shelf at 105 Hz and one high shelf at 10 kHz,
  both Q 0.70; peaking Q ranging ~0.5–5.8; a single negative `Preamp:` line.
  Attribute the *data*, not the reasoning.

---

## 2. Tonal / timbral vocabulary

### 2.1 ITU-R Report BS.2399-0 (2017), carrying the FORCE Technology / SenseLab **Sound Wheel** `[V]`

* **Citation.** ITU-R. *Report ITU-R BS.2399-0: Methods for selecting and describing
  attributes and terms, in the preparation of subjective tests.* International
  Telecommunication Union, Radiocommunication Sector, March 2017.
  <https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BS.2399-2017-PDF-E.pdf>
  (PDF fetched and text-extracted locally.)
* **Underlying lexicon.** Pedersen, T. H. & Zacharov, N. *The Development of a Sound Wheel
  for Reproduced Sound.* AES 138th Convention, Warsaw, May 2015, Paper 9310 (DELTA SenseLab).
  <https://aes.org/publications/elibrary-page/?id=17734> — **paywalled `[X]`**; the ITU report
  is the free route to the same attribute table, which is why it is the citation of record here.
* **Reliability.** Standards-body report reproducing an industry-standard lexicon. Highest
  authority for *definitions*; deliberately silent on frequencies.
* **Structure `[V]`.** Three rings. Inner: Loudness, Dynamics, Timbre, Spatial,
  Transparency, Artefacts. Middle: category groups (e.g. under Timbre — Treble, Midrange,
  Bass, Timbral balance; under Spatial — Spatial extent, Localization, Reverberance).
  Outer: individual attributes, each with a definition and a bipolar or unipolar scale.

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

**Critical methodological point `[V]`: the Sound Wheel assigns no frequencies to any
attribute.** "Boomy" is *low bass resonance*; "Boxy" is *upper bass resonance*; "Canny" is
*midrange narrowband resonance*. Ordering is given, Hz is not. Any Hz range attached to a
Sound Wheel term in this project comes from a *different* source and must be labelled as such.

### 2.2 Sean Olive (Harman International) — target curve and listener training

**2.2a Olive, S. E. (2022) `[V]` — the free, citable summary.**

* **Citation.** Olive, S. E. "The Perception and Measurement of Headphone Sound Quality:
  What Do Listeners Prefer?" *Acoustics Today*, Vol. 18, Issue 1 (Spring 2022), pp. 58–65.
  <https://acousticstoday.org/wp-content/uploads/2022/03/The-Perception-and-Measurement-of-Headphone-Sound-Quality-What-Do-Listeners-Prefer-Sean-E.-Olive.pdf>
* **Reliability.** Peer-reviewed-adjacent society magazine article by the principal
  investigator, summarising a decade of AES papers. Free. Excellent.
* **Numbers transcribed `[V]`:**
  * The Harman target derives from the steady-state in-room response of a calibrated
    loudspeaker in a reference room; that response "gently falls about **1 dB per octave from
    20 Hz to 20 kHz**."
  * The preferred **in-ear** target is "almost identical" to the around-ear/on-ear targets
    "except it has an additional **4 dB of bass**" (Olive et al., 2016).
  * Listener segmentation (Olive et al., 2018a; 31 headphones, 130 listeners):
    **Class 1 = 64 %** prefer the Harman target as-is; **Class 2 = 15 %** prefer it with
    **4–6 dB more bass**; **Class 3 = 21 %** prefer it with **2 dB less bass**.
    → *Bass level is the single dominant axis of individual taste.* This is the strongest
    empirical justification in this document for the AI tuner existing at all, and for the
    magnitude of its typical bass moves (a few dB, not ten).
  * Lorho (2009): 80 listeners preferred a modified diffuse-field target in which the DF
    curve's **12 dB peak at 3 kHz was reduced to just 3 dB**.
  * Trained-listener descriptors recorded verbatim in the study: the DF targets had "too much
    emphasis in the **upper midrange (2–4 kHz)** and lacking bass"; the Lorho target had "too
    little energy at **2–4 kHz**, which made instruments sound **'muffled and dull'**"; the FF
    target drew "**harsh and nasal**" colorations; the winning target was described as "good
    bass with an even spectral balance."
  * Female listeners preferred less bass and treble than male; 55+ listeners preferred
    significantly more treble and less bass.
  * Recommended remedy for taste variance: "a simple bass and treble control" — i.e. exactly
    the shelf-first strategy the AI tuner should adopt.
* **Direct relevance.** The "upper midrange 2–4 kHz" framing here is *Harman's own* and it
  disagrees with Owsinski's "presence = 4–6 kHz". See §5, disagreement #4.

**2.2b Olive, S. E., Welti, T. & McMullin, E. (2013) `[X]` — paywalled.**

* *Listener Preferences for Different Headphone Target Response Curves.* AES 134th
  Convention, Rome, May 2013, Paper 8867 / e-Lib id 16768.
  <https://aes.org/publications/elibrary-page/?id=16768>
* Not reachable without AES membership. Its findings are used here **only** as relayed by
  §2.2a, which cites it directly.

**2.2c Harman "How to Listen" listener training `[S]`.**

* **Citation.** Olive, S. E. "Harman's 'How to Listen' — A New Computer-based Listener
  Training Program." *Audio Musings* (Olive's blog), May 2009.
  <http://seanolive.blogspot.com/2009/05/harmans-how-to-listen-new-listener.html>
  Companion site <https://harmanhowtolisten.blogspot.com/>.
* **Reliability.** Author's own blog describing his own software — primary-ish, but informal
  (`[S]` because it is not the peer-reviewed methodology paper).
* **Contribution `[S]`.** 17 training tasks across four attribute families: **timbre
  (spectral), spatial (localization/imagery), dynamics, and nonlinear distortion.** The
  *Band Identification* task trains listeners to name a modified band by **frequency, level
  and Q**, using peaks, dips, peak-and-dip pairs, high/low shelving and low/high/bandpass
  filters, subdividing the spectrum into progressively more bands. The *Spectral Plot* task
  trains listeners to "draw the perceived timbre… as a frequency response curve."
* **The key doctrine for this feature.** Harman's training deliberately **replaces**
  connotative audiophile vocabulary ("chocolaty", "silky") with terms that map onto
  *filter type, frequency, Q and gain*. The AI Sound Tuner's vocabulary map is doing the same
  translation in software: user's connotative word in, (type, f, g, Q) out. Design the
  vocabulary map to be the machine version of Band Identification, and prefer terms that
  Harman's programme itself would accept.

### 2.3 Audio Commons timbral models (EU H2020) `[V]` / `[S]`

* **Citations.**
  * Pearce, A., Brookes, T. & Mason, R. — *Deliverable D5.8: Release of timbral
    characterisation tools for semantically annotating non-musical content.* AudioCommons
    (H2020 project), Institute of Sound Recording, University of Surrey.
    <https://audiocommons.github.io/assets/files/AC-WP5-SURREY-D5.8%20Release%20of%20timbral%20characterisation%20tools%20for%20semantically%20annotating%20non-musical%20content.pdf>
    Fetched and text-extracted `[V]`.
  * Source code: <https://github.com/AudioCommons/timbral_models> `[V]`.
  * Blog: Pearce, A. "The Timbre of Sound", audiocommons.github.io, 5 Sep 2018 `[V]`.
* **Reliability.** Peer-reviewed-project deliverable + primary source code. Note the
  models are trained on **Freesound sound-effects**, not on music-through-headphones —
  a real external-validity caveat for our use.
* **Attribute set `[V]`.** hardness, depth, brightness, roughness, warmth, sharpness,
  boominess, reverb. The first seven are regressions trained on subjective ratings
  **0–100** (output may exceed the range; `clip_output` clamps). `reverb` is a **binary
  classifier** (1 = "sounds reverberant", 0 = not).
* **Definitions `[V]` (as given in project material — note they are qualitative):**
  * *brightness* — "a bright sound is one that is clear/vibrant and/or contains significant
    high-pitched elements."
  * *warmth* — "a warm sound is one that promotes a sensation analogous to that caused by a
    physical increase in temperature."
  * *boominess* — "a boomy sound is one that conveys a sense of loudness, depth and
    resonance."
  * *hardness* — scale illustrated: "a predicted hardness of 10 would sound fairly soft,
    whereas values of 90 would sound very hard."
  * Depth, roughness, sharpness, reverb: **no verbatim definition located** in the material I
    could read. D5.8 is a *usage manual*, not the definitional deliverable; the elicitation
    write-ups are in the earlier deliverables D5.1/D5.2 and in Pearce, Brookes & Mason (2017).
    **Not attributed here.**
* **The one hard frequency number `[V]`.** `Timbral_Booming.py` implements the
  Hashimoto booming index over third-octave bands
  (25 … 12 500 Hz) and uses a **280 Hz** cutoff to isolate the low-frequency component;
  final metric `boominess = 43.67·rms_boom − 10.90·ll + 26.84`.
  → Audio Commons' operational boundary for "boomy" is **below 280 Hz**.
* **Warmth band `[S]`.** `Timbral_Warmth.py` works on a **Bark-scale** "warmth region" and a
  separate high-frequency region, with a `max_WR` parameter defaulting to **12 000 Hz** and a
  **260 Hz** threshold applied when the estimated fundamental falls below it. I read these via
  an extraction layer rather than the raw file, so the exact Bark-band edges are marked `[S]`;
  **do not quote a Hz warmth band to Audio Commons.** The defensible statement is: Audio
  Commons places warmth in the lower-mid region and gates it on the fundamental around
  ~260 Hz.

### 2.4 Bobby Owsinski — *The Mixing Engineer's Handbook* `[S]`

* **Citation.** Owsinski, B. *The Mixing Engineer's Handbook* (Bobby Owsinski Media Group;
  1st ed. Mix Books 1999, currently 4th ed.). The book itself is **not freely readable
  `[X]`**; the frequency tables are reproduced by the author on his own blogs, which is what
  I read `[V]`:
  * "A Description Of The Audio Frequency Bands", *Bobby Owsinski's Big Picture Music
    Production Blog*, June 2012.
    <http://bobbyowsinski.blogspot.com/2012/06/description-of-audio-frequency-bands.html>
  * "The Magic Frequencies For EQing Mix Elements".
    <https://bobbyowsinskiblog.com/magic-frequencies/>
* **Reliability.** Practitioner heuristic, author-published (so the attribution is safe even
  though it is not the book text). **Provenance caveat: this vocabulary was developed for
  mixing individual instrument tracks on loudspeakers, not for judging a finished master on
  headphones.** That mismatch is the source of most of §5's disagreements.

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

* Voice — fullness 120 Hz, **boomy 240 Hz**, presence 5 kHz, **sibilance 4–7 kHz**,
  **air 10–15 kHz**
* Kick — bottom 80–100 Hz, **hollowness 400 Hz**, point 3–5 kHz
* Snare — fatness 120–240 Hz, point 900 Hz, crispness 5 kHz, snap 10 kHz
* Piano — **honky tonk 2.5 kHz**
* Horns — **piercing 5 kHz**
* Strings — **scratchy 7–10 kHz**
* Hi-hat/cymbals — clang 200 Hz, sparkle 8–10 kHz
* Guitar/organ — fullness 240–500 Hz, presence 1.5–5 kHz

### 2.5 Floyd Toole — resonance audibility and the case for gentle EQ

* **Primary read `[V]`.** Toole, F. E. "Loudspeakers and Rooms for Sound Reproduction — A
  Scientific Review." *Journal of the Audio Engineering Society*, Vol. 54, No. 6, June 2006,
  pp. 451–476. PDF fetched and text-extracted from
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
* **Toole, F. E. & Olive, S. E. (1988) `[X]` — paywalled.**
  *The Modification of Timbre by Resonances: Perception and Measurement.* JAES 36(3):122–142.
  <https://www.aes.org/e-lib/online/browse.cfm?elib=5163>. AES e-Library, not reachable here.
* **Toole, F. E. *Sound Reproduction: The Acoustics and Psychoacoustics of Loudspeakers,
  Rooms and Headphones*, 3rd ed. (Routledge/Focal, 2017); 4th ed. with Olive & Welti (2025)
  `[X]` — book, not readable here.** A pirated full-text PDF surfaced in search results; it
  was **not** used.
* **Reliability.** Peer-reviewed (2006 review) / peer-reviewed (1988, unread) / textbook
  (unread).

**Findings, with honest confidence grading:**

1. `[V]` **Repetition lowers detection thresholds for medium- and low-Q resonances.** Direct
   quotation above. Consequence: a broad, low-Q colouration is what a listener will notice
   over a whole album — which is precisely the class of error this feature should correct.
2. `[S]` **Detectability falls roughly 3 dB per doubling of Q**; low-Q resonances are more
   readily audible with continuous broadband signals while high-Q resonances become relatively
   more audible with transient signals; the audibility of *anti*resonances (dips) falls off
   dramatically as Q rises. These are the standard summary of Toole & Olive 1988 as restated
   in *Sound Reproduction*. **I could not verify them against the primary text and they are
   marked `[S]`.** They are nevertheless the operative design rationale, and the direction of
   the effect is not in dispute anywhere I could find.
3. `[S]` **Threshold figure sometimes quoted**: a 5 kHz, Q = 1 resonance detectable at about
   **0.25 dB** with pink noise, with thresholds rising by roughly a factor of 5 for the least
   revealing programme material. **`[S]` — could not verify against the primary.** Do not
   put this number in user-facing copy.
4. `[V]`-adjacent doctrine: EQ is "the final touch" and mis-diagnosis is the main risk —
   which is exactly why the AI tuner *stages* rather than *applies*, and why it never touches
   the measurement-grounded AutoEq baseline.

**Project ruling on Q.** Combining (1) and (2): the audible, correctable errors are broad and
low-Q; narrow deep bands are both less audible and more likely to be mis-aimed. The AI tuner
therefore defaults to **Q 0.7–1.4 for voicing moves**, reserves **Q ≥ 2.5** for named
narrowband complaints only (sibilance, ring, honk), and never proposes Q > 6.0 (AutoEq's own
peaking ceiling, §1.1).

---

## 3. Spatial / crossfeed sources

### 3.1 bs2b — Boris Mikhaylov `[V]`

* **Citations.**
  * Mikhaylov, B. *Bauer stereophonic-to-binaural DSP (bs2b).* Project home,
    <http://bs2b.sourceforge.net/> `[V]`.
  * `libbs2b` 3.1.0 sources — `src/bs2b.h`, `src/bs2b.c`, read via the DeaDBeeF mirror
    <https://github.com/DeaDBeeF-Player/bs2b/tree/master/libbs2b-3.1.0/src> `[V]`.
    (The upstream SourceForge tarball is the canonical origin; the mirror is byte-identical
    in the constants quoted.)
* **Reliability.** Primary source code + project documentation. This is the *definitive*
  authority for our crossfeed bounds because HQPlayer's "bauer" post-process is this
  algorithm and the app reimplements this model.

Constants transcribed from `bs2b.h` `[V]`:

| Constant | Value | Meaning |
|---|---|---|
| `BS2B_MINSRATE` / `BS2B_MAXSRATE` | 2000 / 384000 | Hz |
| `BS2B_MINFCUT` / `BS2B_MAXFCUT` | **300 / 2000** | crossover frequency, Hz |
| `BS2B_MINFEED` / `BS2B_MAXFEED` | **10 / 150** | feed, in **dB × 10** → **1.0 – 15.0 dB** |
| `BS2B_DEFAULT_CLEVEL` | `700 \| (45 << 16)` | **700 Hz / 4.5 dB** |
| `BS2B_CMOY_CLEVEL` | `700 \| (60 << 16)` | **700 Hz / 6.0 dB** (Chu Moy) |
| `BS2B_JMEIER_CLEVEL` | `650 \| (95 << 16)` | **650 Hz / 9.5 dB** (Jan Meier) |

Level packs fc in the low 16 bits and feed in the high 16 bits; the header comments feed as
"dB * 10 @ low frequencies."

Coefficient derivation transcribed from `bs2b.c` `init()` `[V]`:

```c
GB_lo = level * -5.0 / 6.0 - 3.0;
GB_hi = level /  6.0 - 3.0;
G_lo  = pow( 10, GB_lo / 20.0 );
G_hi  = 1.0 - pow( 10, GB_hi / 20.0 );
Fc_hi = Fc_lo * pow( 2.0, ( GB_lo - 20.0 * log10( G_hi ) ) / 12.0 );
```

**This is the tonal-side-effect derivation — but read the correction below before using it.**
`GB_lo` and `GB_hi` are *gains in dB applied to the summed (centre/mid) content*, and they are
functions of `feed` alone. At the three presets:

| Preset | feed | `GB_lo` | `GB_hi` | `GB_lo − GB_hi` |
|---|---|---|---|---|
| default | 4.5 dB | −6.75 dB | −2.25 dB | −4.50 dB |
| cmoy | 6.0 dB | −8.00 dB | −2.00 dB | −6.00 dB |
| jmeier | 9.5 dB | −10.92 dB | −1.42 dB | −9.50 dB |

`GB_lo − GB_hi` reduces algebraically to exactly `−feed`. That identity is correct.

> **CORRECTION, 2026-07-22.** An earlier draft of this section labelled that column "centre
> tilt" and concluded that *"increasing feed monotonically increases the centre tilt, 1 dB of
> tilt per 1 dB of feed."* **Both the direction and the magnitude are wrong.** `GB_lo − GB_hi`
> is the shelf separation in the analog prototype, *not* the realised centre tilt, which is
> taken after the mid path is normalised to 0 dB at DC. The draft's own sentence contradicted
> itself: it quoted the app's observed 1–2.7 dB range two clauses before asserting a
> 4.5–9.5 dB one.

The realised tilt is

```
tilt = 20·log10(1 − G_hi + G_lo)
```

using the `G_lo` / `G_hi` from the code block above. It **depends only on `feed` — the
crossover frequency does not enter it** — and it **decreases** as feed rises:

| feed | 1.0 | 4.5 (default) | 6.0 (cmoy) | 9.5 (jmeier) | 15.0 |
|---|---|---|---|---|---|
| realised centre tilt | 2.70 dB | 1.81 dB | 1.53 dB | 1.09 dB | 0.92 dB |

The relationship is compressive: the whole 14 dB feed range moves tilt by 1.78 dB, so a
±1.5 dB feed nudge near the default changes tilt by roughly 0.3 dB — broad, and at or below
audibility on its own.

This is the single most important spatial↔tonal coupling in the feature, and it runs
**opposite to the common intuition** that more crossfeed means a duller centre. It is derived
rather than asserted, and it is corroborated two ways: it matches the range stated in
HQPTuner's own UI copy (1–2.7 dB), and it was verified numerically against the shipped
implementation in `lib/xfeed.js`, which computes exactly this expression as `centerTiltDb`.

**Do not conflate this with bass summing.** Crossfeed also sums correlated low-frequency
content between channels, which can raise perceived bass weight. That is a distinct effect
and is *not* what the app's compensation stage corrects — compensation addresses the mid-path
treble tilt only. No peer-reviewed quantification of the bass-summing effect was located; see
the gap note in §3.4.

Project description `[V]`: the default preset simulates speakers "at a 30-degree azimuth
about 3 meters away"; cmoy is "the most popular"; jmeier "produces minimal signal
alterations… for relaxed listening." Implementation is "single pole recursive digital
filters" combining a lowpass and a highboost so the summed response stays smooth and avoids
comb-filter artefacts, the stated purpose being to remove the "superstereo effect" of
hard-panned material on headphones.

### 3.2 Jan Meier `[V]`

* **Citation.** Meier, J. "A DIY Headphone Amplifier With Natural Crossfeed." Originally
  published on HeadWize (Chu Moy's archive); read via the HeadWize Memorial mirror, 9 March
  2018. <https://headwizememorial.wordpress.com/2018/03/09/a-diy-headphone-amplifier-with-natural-crossfeed/>
* **Reliability.** Practitioner/designer primary writing (Meier Audio), mirrored. Not
  peer-reviewed. The mirror is a faithful republication of the HeadWize original.
* **Contribution `[V]`:**
  * The problem statement: the **in-head localization** phenomenon. "With recordings
    presenting a wide soundstage, some instruments are heard in one of the two audio channels
    only. This is most annoying, like a bee buzzing in one's ear." → the canonical
    justification for the `too wide` / `hard-panned` / `ping-pong stereo` complaints.
  * Frequency dependence: "the delays of the frequencies below **2 kHz** are the most
    important"; "For higher frequencies the delay is reduced," mirroring head shadowing.
  * Physical basis: sound from a right-side source reaches the left ear "attenuated and
    delayed", and these ITD/ILD differences "provide important directional information."
  * **The tonal side effect, in Meier's own framing:** "Especially in the high frequency
    range, the delayed crossfeed signal interferes with the original input and attenuates
    specific frequencies" — i.e. comb filtering on centre-panned material. His remedy is a
    frequency-dependent delay plus "small, frequency dependent attenuation" of the direct
    signal so mono content survives without colouration.
    → **Independent confirmation, from a different implementer, that crossfeed colours the
    centre and that the correct response is a compensating filter — exactly what the app's
    crossfeed-compensation block does.**
* **Caveat `[S]`.** The extraction of this page rendered an interaural delay figure as
  "300ms", which is physically impossible; the ear-to-ear extra path at ~30° azimuth is
  ~0.25–0.3 **milliseconds** (≈300 µs). **Do not quote a delay number to Meier without
  re-reading the page.** The qualitative claims above are unaffected.

### 3.3 Crossfeed / binaural perception background `[S]`

* **Citation.** Wikipedia, "Crossfeed." <https://en.wikipedia.org/wiki/Crossfeed> `[V]` —
  read, and **thin**: it defines crossfeed as "the process of blending the left and right
  channels of a stereo audio recording", names Dolby Headphone and bs2b, gives **no**
  frequency range and **no** discussion of tonal side effects, and carries a "needs
  additional references" banner (Oct 2024). Reliability: community wiki, low. Cited only to
  record that it does *not* support the tonal-side-effect claim — that claim rests on §3.1
  and §3.2.
* **Citation `[S]`.** Shaik, M. et al., "Stereo widening system using binaural cues for
  headphones." Available via ResearchGate:
  <https://www.researchgate.net/publication/313902363_Stereo_widening_system_using_binaural_cues_for_headphones>.
  Read only through search-result summarisation `[S]`, not the full text. Contributes the
  standard framing: **ILD, ITD and ICC (inter-channel coherence) are the dominant cues for
  externalization**; ITD/ILD dominate **below ~1.5 kHz** with head shadowing dominant above;
  **low ICC → more spaciousness**, high ICC → narrower, more centred image.
  → This is the theoretical backing for the direction convention in `vocabulary.json`:
  raising crossfeed *raises* inter-channel coherence, therefore narrows and centres.
* **Reachability note.** A beyerdynamic support article on their crossfeed model
  (<https://support.beyerdynamic.com/hc/en-us/articles/24721890938908>) returned **HTTP 403
  `[X]`** and is not cited.
* **Not located.** I did not find a *peer-reviewed* paper specifically quantifying the
  **tonal** (as opposed to spatial) consequence of summing correlated bass in a crossfeed
  network. The claim as used in this project is grounded instead in the bs2b source algebra
  (§3.1, `[V]`, exact) and Meier's design account (§3.2, `[V]`, qualitative). **That is a
  known gap; if a future agent finds such a paper, add it here.**

---

## 4. Ruling policy for conflicting frequency ranges

When sources disagree on where a term lives, this project resolves in this order:

1. **Use case wins.** HQPTuner tunes a *finished stereo master reproduced on headphones,
   already corrected toward the Harman target by AutoEq.* Sources developed for that context
   (Olive/Harman, oratory1990 preset data, AutoEq) outrank sources developed for mixing
   individual multitrack elements on loudspeakers (Owsinski).
2. **Perceptual definition sets the *kind*, practitioner data sets the *number*.** ITU-R
   BS.2399 / the Sound Wheel says whether a term means "low bass resonance" or "upper bass
   resonance"; Owsinski and the community supply the Hz. Where the two are inconsistent, the
   Sound Wheel's ordering constraint is preserved and the Hz range is moved to satisfy it.
3. **Broader beats narrower** (Toole, §2.5). Given a choice between a wide range with low Q
   and a narrow one with high Q, take the wide/low-Q reading. Under-correcting is recoverable
   in the next turn; a surgical notch aimed at the wrong frequency is not.
4. **Never exceed the AutoEq envelope** (§1.1), because the AI tuner's bands stack on top of
   AutoEq bands in the same chain and share the same headroom budget.
5. **Confidence is recorded, not hidden.** Where a term is genuinely contested, its
   `vocabulary.json` entry carries `confidence: "medium"` or `"low"` and a `notes` line naming
   the conflict. A low-confidence term is a candidate for the `clarify` branch of the response
   schema rather than a confident diff.

---

## 5. Source disagreements — stated, not papered over

### Disagreement 1 — "boomy": 60–150 Hz vs ~240–280 Hz

* **Owsinski `[V]`** places "boomy" at **240 Hz** in the voice table, and defines the 60–250 Hz
  band as the one whose overemphasis "produces a boomy quality" — so his boomy is
  *upper*-bass-inclusive and centres nearer 200–250 Hz.
* **Audio Commons `[V]`** operationalises boominess against a **280 Hz** low-band cutoff — an
  even higher ceiling, though as an *analysis band*, not a peak location.
* **ITU-R BS.2399 / Sound Wheel `[V]`** says boomy is "resonances in the **low** bass", and
  separately assigns "**upper bass**" resonance to *boxy*. That ordering constraint is
  incompatible with putting boomy at 240 Hz while boxy sits higher still.
* **Headphone-listening usage** (the AutoEq/Harman context, and how users of this app will
  actually use the word) puts "boomy" on the one-note bass hump around 60–150 Hz.
* **RULING: `boomy` = 60–150 Hz, cut, Q 0.7.** Reasons: the Sound Wheel's low-bass /
  upper-bass ordering is authoritative for *meaning* and forces boomy below boxy and below
  muddy; the headphone use case dominates (rule 1); and Olive's finding that bass level is
  the dominant preference axis (§2.2a) means the low-bass reading is the one users will
  actually be complaining about. Owsinski's 240 Hz sense is captured instead by **`tubby`**
  and **`muddy`**, which sit at 150–350 Hz. Recorded in `vocabulary.json` under
  `boomy.notes`, `confidence: "high"` for the ruling, with the conflict named.

### Disagreement 2 — "warm" and "muddy" occupy the same frequencies with opposite valence

* **Owsinski `[V]`** literally fuses them: 250 Hz is "**fullness or mud**", one entry, two
  meanings. His voice table puts "fullness" at 120 Hz and "boomy" at 240 Hz.
* **Audio Commons `[S]`** treats warmth as its own regression over a lower-mid Bark region
  gated near a ~260 Hz fundamental threshold, with no notion of "too much warmth = mud".
* **ITU-R BS.2399 `[V]`** has no "warm" attribute at all; it decomposes the same territory
  into *Bass strength*, *Bass depth*, *Boomy*, *Boxy*, and the *Dark–Bright* balance axis, and
  lists "muddy" only as the antonym of *Clean*.
* **RULING: they are the same region read in opposite directions, and the vocabulary encodes
  that explicitly.** `warm` = 100–300 Hz, **boost**, +2.0 dB, Q 0.7 (implemented as a low
  shelf when the request is global). `muddy` = 200–400 Hz, **cut**, −3.0 dB, Q 1.0. The
  overlap 200–300 Hz is deliberate and is disambiguated entirely by the user's polarity, not
  by frequency. `confidence: "high"` for muddy (broad agreement that excess lower-mid energy
  is the complaint), `"medium"` for warm (the centre frequency of a "warmth" boost is genuinely
  taste- and programme-dependent). This also means **the model must never emit a warm boost and
  a muddy cut in the same turn** — they cancel. Encoded as a conflict pair in `_meta`.

### Disagreement 3 — the "presence" / "forward" region: 2–4 kHz (Harman) vs 4–6 kHz (Owsinski)

* **Owsinski `[V]`** names **4–6 kHz** the "Presence" band, "responsible for the clarity and
  definition of voices and instruments. Boosting this range can make the music seem closer to
  the listener"; reducing 5 kHz pushes it away. His 2–4 kHz band is instead the one that
  "can mask the important speech recognition sounds… introducing a lisping quality."
* **Olive / Harman `[V]`** consistently locate the *forwardness* problem at **2–4 kHz**:
  the DF targets were criticised for "too much emphasis in the upper midrange (2–4 kHz)", and
  the Lorho target sounded "muffled and dull" for having "too little energy at 2–4 kHz".
  Lorho's whole intervention was cutting the **3 kHz** DF peak from 12 dB to 3 dB.
* **Root cause of the disagreement.** These are different measurements of different things.
  Owsinski is describing where you boost a *single track* to bring it forward in a *mix*;
  Harman is describing where a *headphone transfer function* error makes a *whole master*
  sound shouty. For a headphone-listening app, Harman's framing is the relevant one.
* **RULING: split the concept.**
  * `forward` / `recessed` → **2000–5000 Hz**, the Harman-anchored upper-midrange axis, Q 1.0,
    ±2.5 dB. This is where "vocals sound distant" and "it's shouting at me" actually live.
  * `present` (as a positive descriptor of clarity/definition) → **4000–6000 Hz**, Owsinski's
    band, retained because the *word* "presence" is his and users use it his way.
  * `honky` → **500–1200 Hz** (Owsinski's "horn like" 500 Hz–1 kHz), distinct from both.
  * `nasal` → **800–2000 Hz**, per the Sound Wheel's "closed sound with pronounced midrange"
    plus Owsinski's "1–2 kHz boost makes them sound tinny".
  * `harsh` → **2500–5000 Hz**, overlapping `forward` but always a cut, and Q 1.4 rather than
    1.0 because harshness is the narrower percept of the two.
  `confidence: "medium"` on `forward`/`recessed` with the conflict recorded in `notes`.

### Also-ran disagreements (recorded, lower stakes)

* **"Air"** — Owsinski gives **10–15 kHz** in the voice table but **16 kHz** in the magic-
  frequency list; the Sound Wheel's *Brilliance* covers this with no number. **Ruling:
  high shelf at 10 kHz, effective 10–16 kHz**, which additionally sits exactly on AutoEq's
  `DEFAULT_TREBLE_BOOST_FC = 10000.0` and its shelf `MAX_FC = 10000.0` `[V]` — so an air move
  is representable in the same grammar as an AutoEq shelf.
* **"Sibilant"** — Owsinski's voice table says **4–7 kHz**, his band table attributes sibilance
  to the 6–16 kHz "Brilliance" band, and de-esser practice generally works **5–9 kHz**.
  **Ruling: 5000–9000 Hz, cut, Q 2.5** — the one deliberately narrow entry in the tonal map,
  justified because sibilance genuinely is a narrowband percept (Sound Wheel classes *Shrill*
  as an **artefact**, not a timbre).
* **"Boxy"** — Owsinski's nearest datum is kick-drum "hollowness at **400 Hz**"; the Sound
  Wheel says "upper bass". **Ruling: 300–600 Hz**, satisfying both.

---

## 6. Summary of unreachable sources

| Source | Why | Consequence |
|---|---|---|
| r/oratory1990 wiki + FAQ | Reddit blocked by this environment's fetcher (both `www.` and `old.`) | No reasoning attributed to oratory1990. Only his preset *data*, observed in the AutoEq repo, is used. |
| Pedersen & Zacharov, AES 138 Paper 9310 (2015) | AES e-Library paywall | Sound Wheel cited via the free ITU-R BS.2399-0 reproduction instead. |
| Olive, Welti & McMullin, AES 134 Paper (2013), e-Lib 16768 | AES e-Library paywall | Findings used only as relayed by Olive's own 2022 *Acoustics Today* article. |
| Toole & Olive, JAES 36(3):122–142 (1988) | AES e-Library paywall | The Q-vs-audibility numbers are marked `[S]`. The 2006 JAES review, which cites it, was read in full `[V]`. |
| Toole, *Sound Reproduction* (3rd/4th ed.) | Book. A pirated PDF appeared in search results and was not used. | "3 dB per doubling of Q" stays `[S]`. |
| Audio Commons D5.1/D5.2 definitional deliverables | Not fetched (D5.8 was, and turned out to be a usage manual) | Verbatim definitions exist only for brightness, warmth, boominess, hardness. Depth/roughness/sharpness/reverb definitions **not attributed**. |
| FORCE Technology high-resolution Sound Wheel file | Behind a registration form | ITU reproduction used instead; no loss. |
| beyerdynamic crossfeed support article | HTTP 403 | Not cited. |
| harman.com `audioscience_0.pdf` (Toole) | TLS chain verification failure from this host | Not cited. |
| A peer-reviewed quantification of crossfeed's tonal side effect | Not found | Claim rests on bs2b source algebra `[V]` + Meier `[V]`. Known gap. |
