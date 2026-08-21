# TRANSDUCERS.md — what the EQ Assistant is actually EQ-ing

Companion to `SOURCES.md` (citations, disagreements), `PRIMER.md` (feature contract), `HEARING.md` (the listener, where the deficit is not the transducer's), `vocabulary.json` (the term map). Compiled 2026-07-25.

The tuner does not generate a correction from nothing. It amends a chain that already carries an AutoEq profile for a specific headphone. **This document is the physical and measurement reality behind that profile**: what kind of driver made the curve, which acoustic variables move it, and above which frequency the measurement it came from stops meaning anything.

The operative consequence, stated up front: **a listening complaint is not always a target error.** On a dynamic over-ear it may be the amplifier's output impedance; on any over-ear it may be pad wear or a broken seal; on an IEM it may be insertion depth, tip choice, or a crossover null. Several of these have larger measured magnitudes than the EQ moves the tuner would make to "fix" them. Reading them as tonal-balance errors and filtering accordingly is the failure mode this document exists to prevent.

**Verification legend** — as `SOURCES.md`, plus one addition:

| Tag | Meaning |
|---|---|
| `[V]` | Primary artifact read directly; numbers transcribed from it. |
| `[VA]` | Read by a delegated research agent, which returned a verbatim quote and URL. Same artifact class as `[V]`; the difference is who read it. Treat quotes as accurate and re-fetch before relying on any single number in isolation. |
| `[S]` | Secondary only. Indicative; re-verify before relying on it. |
| `[X]` | Could not reach. Listed for completeness; **no content attributed.** |

Everything in this file is `[VA]` unless marked otherwise. Where a figure was computed rather than quoted, that is stated in place and the figure is labeled derived.

---

## 1. Over-ear driver technologies

### 1.1 Dynamic / moving coil

The characteristic tonal defect is **a narrow, high-Q peak in roughly 4–8 kHz**, and its origin is geometric rather than electrical.

Rin Choi's analysis of the Sennheiser HD 800 `[VA]` (M.R.O. blog, 2012–2013; DIY head and torso simulator "dimensionally complying with ITU-T Rec. P.58", published FR / THD / directivity / impedance plots) names three causes for that model's 5–6 kHz peak — "Resonant housing", "Resonance shift due to center hole", "Concha resonance" — and locates the reflection by wavelength:

> "(340,000 mm/s) / 5,000 Hz = 68 mm" and "(340,000 mm/s) / 6,000 Hz = 57 mm", indicating reflection occurring "approximately 14 mm to 17 mm away from the driver in the housing."

Two properties matter to the tuner. It is **position-dependent** (the peak changes with fit), and it is **not removable acoustically** — "it is virtually impossible to totally eliminate the peak" even with damping. That last point is the justification for EQ: this is a defect the manufacturer cannot design out, so correcting it downstream is the right tool.

Measured magnitudes on the HD 800 family `[VA]` (DIY-Audio-Heaven; publishes FR and CSD plots, **rig not stated on the page** — treat absolute dB accordingly): the HD 800 S's "6kHz peak is still 4dB too high (despite the absorber)", the absorber achieves "a reduction of about 5 dB" versus the HD 800, and "the 10kHz peak even sticks out 10dB above the rest." The same source notes the absorber "also reduced" ringing, which a magnitude-only EQ does not address.

Manufacturers attack the diaphragm side of this with geometry — the ring radiator (a hole in the dome center so "the phase interference simply disappears", Rin Choi `[VA]`) and Focal's beryllium "M"-shaped inverted dome, a rigidity play to push first break-up above the audio band. Neither touches the **cup-cavity** resonance, which is a geometry problem of the enclosure, not the diaphragm.

**The non-headphone cause to rule out first.** A dynamic driver's impedance varies with frequency, so a non-negligible amplifier output impedance forms a voltage divider that audibly re-tilts the bass. Headphones.com `[VA]` (measurement-community tier, publishes measured impedance curves) gives the Sennheiser HD 550 as "roughly 170 Ω at 1 kHz, and 320 Ω at 70 Hz", and works the arithmetic: 2.40 V at 100 Hz against 1.71 V at 1 kHz →

> "Converting that difference into decibels, we get 2.94 dB"

and "your headphone will be bassier than the manufacturer's design." **No AutoEq profile accounts for this**, because profiles are measured on a near-zero-impedance source. It is the single most common non-headphone cause of a "too boomy" complaint on a dynamic over-ear, and it does not apply to planars or electrostatics.

*(The commonly circulated dB thresholds for the 1/8 rule — "below 1dB" at damping factor 8, "below 0.2dB" at 40 — were **not** confirmed in the artifact. `[S]`, do not cite.)*

### 1.2 Planar magnetic

Audeze's own pages `[VA]` are **marketing with a correct physical premise** — "The page contains NO graphs, measurements, frequency response data, distortion figures, or numerical specifications." Two structural claims are nonetheless checkable in principle and consistent across sources:

> "Audeze's planar magnetic drivers are able to produce uniform driving force _directly_ across the entire diaphragm" — versus a dynamic where "the driving force begins in the center and must travel outward."

> Impedance: dynamic drivers are an "inductive load", Audeze's is a "purely resistive load" with a "flat" impedance curve.

The distortion and "vastly outperforms any other headphones" claims are unquantified marketing. Separate them.

**FR consequence to reason from:** distributed drive across a tensioned membrane largely removes the moving-coil failure mode of diaphragm break-up producing narrow high-Q treble spikes. A planar's deviations are therefore more likely **broad** (tuning choices, magnet-structure diffraction, pad and cavity effects) than narrow break-up peaks. Flat impedance also means tonality does not shift with amplifier output impedance.

Diffraction off the magnet structure is the one treble mechanism vendors do name — Audeze's Fazor ("Diffraction of sound off the magnets can cause different frequencies to arrive at different times, which results in changes in phase") and HIFIMAN's Stealth Magnet. Neither publishes a number. **HIFIMAN publishes marketing only on this feature; recorded as a finding.**

Dan Clark Audio's AMTS page `[VA]` names a checkable mechanism without numbers, and is worth quoting because the manufacturer frames the problem the same way this document does:

> "All headphones are subject to high-frequency standing waves which can make treble sound harsh, fatiguing, or synthetic." "It integrates waveguides, diffusion control, quarter-wave, and Helmholtz resonators into one compact structure."

That is a manufacturer stating that the cup/pad cavity is a **standing-wave resonator problem in the treble**, addressed by narrow-Q notching plus broad shaping — direct support for treating "harsh/splashy" as a narrow resonance artifact rather than a broad tilt.

### 1.3 Electrostatic

Thin section, honestly thin — electrostatics are a small share of the market and the published technical material is correspondingly sparse. Stax `[VA]` gives real construction numbers and **no measurements of any kind**:

> Diaphragm "several microns thick (less than 2 microns) high-polymer film"; "two parallel-arranged fixed electrodes" with the diaphragm "sandwiched and suspended in the middle"; "'Bias' voltage of 580V (almost no current)"; "signal voltage to the fixed pole(up to 300-600V) must be supplied as push-pull"; the earspeaker "cannot be used directly with a convential headphone jack and requires an electrostatic driver (amplifier) unit".

The 230 V "Normal" bias is **not** on Stax's page — `[S]` only, do not present as manufacturer-stated. Bias voltage sets sensitivity, not tonal balance: it is a compatibility fact, not a frequency-response fact, and no tonal complaint should be read against it. Warwick Acoustics / Sonoma's technology page returned **404** `[X]`.

**On the famous "electrostatic bass rolloff": no source reached puts a number on it.** What is defensible from the verified construction is that excursion is bounded by the diaphragm-to-stator gap while diaphragm mass is negligible — so limited low-frequency output at high level is plausible, and the moving-coil break-up failure mode is not. **That is reasoning from construction, not a citation, and must be labeled as such wherever it is used.** A "bass light" complaint on an electrostat is *a priori* more plausible than on a planar, and low-shelf boost carries a headroom cost.

**Sector finding worth recording:** across this entire survey of headphone manufacturers, exactly one artifact contained a measurement-grade number, and it came from Brüel & Kjær — a *rig* maker, not a headphone maker.

---

## 2. In-ear driver technologies

### 2.1 Dynamic / moving coil (IEM)

Single-DD and DD+BA hybrid shells are the commonest IEM configuration on the market. §1.1's dynamic-driver physics is written for an over-ear cup and does not transfer directly to a driver sealed into an IEM shell a few millimetres from the canal.

**EM-Tech** `[VA]` (US Patent 10,536,771 B2, *Dynamic Receiver with Resonance Protector for Earphone*, filed 2018, granted 2020 — EM-Tech makes both BA and dynamic earphone receivers for the OEM market, same citation tier as Sonion/Knowles below) describes the basic construction:

> "a magnetic circuit composed of a yoke, a magnet and a top plate is disposed in a frame, and a vibration system composed of a voice coil and a diaphragm" … "a vent hole formed in the bottom surface [of the yoke] to facilitate the vibration of the diaphragm."

**audioXpress** `[VA]` (Tatarunis & Klasco, *Microspeakers' Anatomy — How to Design Audio Systems with Very Small Drivers*, 16 Jul 2019 — same outlet/tier as the audioXpress piece already cited in §4) adds the suspension detail that distinguishes a microspeaker from a full-size dynamic driver:

> "a single diaphragm forms the surround, diaphragm, and dust cap… The voice coil is typically bobbin-less… This is a one-point suspension with only surround compliance and no spider." … "Free air resonance for most microspeaker designs typically runs in the 500-700Hz range."

**No source states outright that an IEM dynamic driver lacks the 4–8 kHz cup-cavity resonance §1.1 documents for over-ear** — that conclusion is an inference from this construction (small sealed/vented chamber feeding the canal directly, no cup air volume) plus the canal-coupling mechanism already sourced at §3.2, not a direct quote. Flagged as inference, same convention as §1.3's electrostatic bass-rolloff paragraph.

**Vent-set bass rolloff** (closing, partially, the gap flagged at §7): three manufacturers independently describe the same trade-off. **Apple** `[VA]` (US 11,575,985 B2, *Mass loaded earbud with vent chamber*, 2023): "bass response may be controlled to a frequency of less than 1 kHz by shaping bass duct to contain a volume of air that acts as a corresponding acoustic mass" — a vent/duct's air column loads the diaphragm as added mass, not a simple leak. **EM-Tech** `[VA]` (US 11,368,784 B2, *Receiver unit having pressure equilibrium structure and compensation structure for low frequency*, 2022) states the trade-off directly: "if a ventilation recess is provided in order to relieve deafening of the ear, large loss occurs in the SPL in the low frequency region" — compensated by duct resonance and acoustic mesh damping. **Apple** again `[VA]` (US 9,161,118 B2, *Earphone having an acoustic tuning mechanism*, 2015) gives a numeric port-area figure — "about 1 mm² to about 8 mm²" — tied to a back-volume resonance of "about 2 kHz to about 3 kHz," though that figure is a resonance peak, not the LF corner itself. **No source gives a clean vent-diameter-to-Hz corner number for an IEM** — the mechanism is now solid, the magnitude is not. Updates §7.

**DD+BA hybrid combination — naive is not automatically better.** **Jiang, Xu, Jiang, Kim & Hwang**, *Analysis and Development of Hybrid Earphone Combining Balanced-Armature and Dynamic Receivers*, Applied Sciences 9(23):5047, 2019, DOI 10.3390/app9235047 (peer-reviewed, open-access CC-BY, Pusan National University acoustics group). Full text `[V]` — read directly.

The dynamic and BA units share one front chamber, and "the SPL of a hybrid earphone can be treated as the summation of the SPLs of the dynamic and BA earphones. In addition, the dynamic, BA, and hybrid earphones have the same peak frequency in the SPL curve because they have the same front chamber." With a bare (prototype, non-optimized) front-chamber tube, that summation is **worse than either driver alone**:

> "The root-mean-square value of the SPL deviation for the dynamic, BA, and hybrid earphones with the prototype acoustic tube are 8.94, 6.04, and 9.70, respectively."

**A hybrid built by simply wiring a DD and a BA into a shared chamber can be a net regression against the target curve**, not an improvement — the combination needs deliberate acoustic crossover design, not just component selection. The fix here is a passive acoustic low-pass: a tube in front of the dynamic unit, sized as "acoustical mass and acoustical resistance," whose diameter — not position ("the tube position has no influence on the frequency response of the hybrid earphone") — sets how much of the dynamic unit's high-frequency output reaches the shared chamber. Optimized (Nelder–Mead search, bounded 0.1–2 mm; optimum found at the lower bound, 0.1 mm) against the Harman target curve:

> "After the optimized acoustic tube is used, the high-frequency response of the dynamic earphone does not exist. The BA earphone is responsible for the high-frequency response. The dynamic earphone improves the low-frequency response." … "the difference in the RMS value of the hybrid earphone became 4.60."

**This paper does not use "phase" or "notch" language anywhere in the text** — its account of the shared-chamber interaction is SPL-summation and acoustic-tube filtering, not a BA-to-BA-style phase-cancellation notch (Knowles AN-030, §2.2). Do not stretch this citation into a phase-null claim it doesn't make; a DD-to-BA phase-notch analog to AN-030 remains genuinely open (§7).

**Diaphragm breakup in small dynamic IEM diaphragms: no source found.** A cluster of general audio-transducer patents surfaced a breakup-frequency figure via search-engine synthesis only, unverified by direct fetch — **not cited**. Marked open, §7.

### 2.2 Balanced armature

Both major BA manufacturers publish genuine engineering documentation, and it is the strongest manufacturer-tier material in this whole base.

**Sonion** `[VA]` (*What is Balanced Armature Receiver Technology?*, Nov 2016, Rev_004 — an engineering training deck with measured response curves and construction cross-sections) states the property that matters most:

> "**Balanced armature receiver technology has a non-flat response curve.** … Internal modifications include adding compensation holes to the membrane, resulting in damping of the second peak. External modifications include a damping screen in the spout, resulting in damping of the first peak."

So a BA has a first and second resonant peak *by construction*, and shipping IEMs flatten them with acoustic damping. A "peaky/shouty" complaint on a BA IEM therefore has a physical origin upstream of any target curve. The LF corner is likewise mechanical: "Compensation holes in the membrane determine the low frequency roll off" — a fixed property EQ is fighting, not a free parameter.

And the seal asymmetry, which is the single most citable statement for triaging a "no bass" complaint on an IEM:

> "Balanced armature technology only works if the output is delivered directly inside the ear canal, otherwise the low frequency (bass) disappears. In most hearing aids and earphones, it is critical that the balanced armature receiver is used in a sealed ear canal for proper performance."

Sonion's own comparison table lists BA as "Limited leak tolerant" against moving coil's "Leak tolerant", and BA as "Inherently non-linear" against moving coil's "Inherently linear". **No dB figure is attached to "disappears"** — the mechanism and its asymmetry are sourced; the magnitude is not.

**Knowles AN-030** `[VA]` (*BA Tweeters in TWS Earphones*, rev. A, 2023 — 7 measured SPL graphs, parts table, circuit schematics, named couplers) supplies the numbers, and three of them change how IEM treble complaints should be read:

- **Nozzle tubing.** A 3.4 mm × 1.5 mm acoustic tube produces "over 15 dB SPL boost to the 9-14 kHz bandwidth" versus an open nozzle.
- **Eartip choice alone.** Five tips of varying size and shape, with **insertion depth held constant by an end-cap**, give "a ~10 dB spread in the treble performance from 9-20 kHz". Attributable to tip geometry alone.
- **Crossover polarity.** "It is clear when the two drivers are out of phase from each other as their combined responses will create a notch, or valley, in the response" — the published example shows a deep narrow null in the ~3–4 kHz crossover region, reaching below 75 dB SPL against a ~105 dB in-phase level.

That third one has a direct consequence: **a "hollow/recessed mids" complaint on a hybrid IEM may be a fixed acoustic null that EQ boost cannot fill.** Boosting into a cancellation adds level without restoring the notch.

Also from AN-030: BA tweeters are differentiated by first-peak resonance with expected crossovers of **4.5 kHz (RAN) / 5.5 kHz (RAX) / 6.5 kHz (RAU)**, with RAX options "for 8.5 kHz up to 12 kHz crossovers" — i.e. a *driver* property, not a target-curve property. Acoustic damping is the standard low-pass element in wired multi-driver IEMs ("Acoustic dampening screens or constricted channels have been used as a low-pass filter alternative for wired multi-driver earphones"), with an explicit phase-shift caveat. Knowles' *Acoustic Interface Design Guide* `[VA]` gives the canonical damper ladder — **330 / 680 / 1000 / 1500 / 2200 / 3300 / 4700 Ω** — "used between the speaker outlet and the ear canal to smoothen the frequency response."

*(Note a scope difference, not a contradiction: Sonion describes back-venting as a design tool for hearing-instrument receivers; Knowles states of its TWS tweeter parts that "A BA tweeter does not need back-venting and has a self-enclosed back volume." Different parts, different applications.)*

### 2.3 Electrostatic and planar IEM drivers

**Provisional negative finding: no public Sonion EST datasheet was located.** Sonion lists EST tweeters (e.g. EST65DB01) but search surfaced only marketplace listings and reseller blogs; likely NDA-gated. Planar IEM drivers were not investigated. Both are open.

---

## 3. The acoustic variables that dominate

These are not driver-technology effects, and on measured magnitude several of them exceed the EQ moves the tuner would make.

### 3.1 Over-ear: pads, seal, reseat

**Pads.** DIY-Audio-Heaven `[VA]` publishes measured FR overlays, so these are measurement-backed rather than asserted:

> Sennheiser HD 650, new versus worn pads: "The new pads have about 1.2dB less bass", with "deviations are larger" above 5 kHz. HD 58X: "a difference below 1kHz of about 1dB max."

Pad state alone therefore moves bass on the order of **~1–1.2 dB** on these models, with larger and less predictable deviation above 5 kHz. Pads are also the driver-to-ear spacer, so they move the treble as well as the bass.

**Seal.** From the same source: "Breaking the seal lowers the bass response and increases the 350Hz region (in this case)" (AKG K371, closed). Glasses and hair under the pads give a "bad seal", resulting in "poor bass extension and sometimes to a honky sound."

That combination is worth carrying into the vocabulary logic: **"thin AND honky" is one coherent seal complaint, not two independent tonal ones.** Headphone Test Lab `[VA]` publishes a leakage protocol using "the temple arm of a chunky pair of spectacles" and "a hemp mat which has acoustic resistance similar to that of human hair" — glasses and hair are first-class, routinely-measured seal defects. That page publishes method only; **no dB figures, do not attribute numbers to it.**

**Reseat variance — the error bar under everything.** Struck (CJS Labs), *Voice Coil*, July 2019 `[VA]`:

> "For headphones, the accuracy may be considered to be acceptable if the standard deviation is less than 2 dB from 500 Hz to 5 kHz."

with "a minimum of 5 frequency response measurements … performed on each device", the headphone "completely removed from the HATS and re-mounted for each of the five trials", and "large variations at low frequencies due to leakage and at high frequencies due to slight variations in position."

Crucially, the same source scopes this to over-ears: "Repositioning and averaging is generally not required for insert earphones having only a single repeatable position."

**So an over-ear AutoEq correction is a curve carrying roughly ±2 dB of legitimate slop in its best band, and worse at both ends.** Corrections smaller than that are below the noise floor of the data they were derived from.

### 3.2 In-ear: canal resonance, insertion depth, tips, venting

**Ear-canal resonance is why an IE target cannot reuse an OE target.** Chasin, *The Hearing Review*, 2013 `[VA]` (trade-technical tier): a ~28 mm canal gives F = v/4L ≈ "approximately 3035 Hz theoretically", measured "typically around 2700 Hz" once tympanic-membrane compliance adds "a few mm of acoustic length". The mechanism that matters:

> occluding the **outer** canal — the pressure anti-node — "significantly reduce[s] the level of the associated resonance at 2700 Hz", while occlusion near the tympanum does almost nothing.

An IEM sits at the anti-node and removes a resonance an over-ear leaves intact. That is the acoustic reason the two target families differ, stated as a mechanism rather than as an observed offset.

**The mechanism is real and listeners do not want it corrected — this is a tested negative, not an absence of evidence.** Olive 2025 `[V]` (`SOURCES.md` §2.2d) set out to answer exactly this question: whether a midband control at 3 kHz, aimed at the individual variation in the main ear-canal resonance, improves personalization. The variation available to chase is large — he cites it as varying by two octaves and more than 10 dB between individuals. The control offered was generous: a 3 kHz peak/dip at Q 2, adjustable from +6 dB to −10 dB, on a baseline the same 36 listeners were freely re-balancing in bass and treble. **The mean adjustment was +0.1 dB, and only 5 of 36 listeners moved it as far as ± 2 dB.** He calls the result surprising and does not explain it away.

Two independent findings in the same region point the same way: Ravizza et al.'s five most-preferred curves span **± 3.5 dB across an octave centered at 4 kHz**, and Olive's own earlier work found two IE targets **differing by 5 dB between 2 and 8 kHz** to be equally preferred. Listeners appear to tolerate several dB through this region rather than seeking a particular value in it.

**Carry the author's caveat with the finding.** The bass and treble filters were re-randomized on every trial while the midband filter was fixed at 0 dB, which he names as a possible cause of the small adjustments and proposes inverting in a future study. He also records that the raw data shows listeners did move the filter — the movements were simply negligible. So: strong enough to stop us building a canal-compensation control, not strong enough to assert that individual canal resonance is perceptually irrelevant.

**Consequence for the feature.** The inter-individual acoustic variance documented above is a reason the IE and OE target *families* differ. It is not a reason to offer the user a 3 kHz knob. See `PRIMER.md`, fourth must-be-told rule.

**Insertion depth — direction sourced, magnitude still open.** Crinacle `[VA]` (on a stated "IEC60318-4 compliant coupler", i.e. the same rig family as AutoEq/Harman IEM data): "A shallower insert causes the resonance to decrease in frequency. A deeper insert causes the resonance to increase in frequency", demonstrated on the Sony IER-Z1R where a shallow insert yields a "painfully large 6kHz spike" and a deep insert causes "SPL between 6kHz and 10kHz to drop significantly." **"Significantly" is not a number**; this establishes direction, band and sign only. The Knowles eartip figure (~10 dB across 9–20 kHz at *controlled* depth) remains the honest stand-in for magnitude.

**Venting and the occlusion effect — first hard numbers.** Kuk & Ludvigsen, *The Hearing Review*, 2002 `[VA]`:

> "a 2 mm vent reduced the occlusion effect by 8.5 dB at 200 Hz but had no effect at 500 Hz"

with the occlusion effect decreasing as insertion depth increases, via the "modified resonance frequency of the occluded ear canal".

**A caution to carry, not to resolve.** The occlusion effect *adds* low-frequency energy from the wearer's own body, which argues for **less** bass, not more. The community claim that Harman's IE target carries +4 dB "due to occlusion-induced noise" is therefore not self-evidently coherent. The **+4 dB figure itself is solid** — Olive, *Acoustics Today* 2022 `[V]`, "an additional 4 dB of bass (Olive et al., 2016)" — but the *rationale* is unresolved and the primary (Olive, Welti & Khonsaripour, AES 2016 Headphone Technology, paper 6-1) is paywalled `[X]`. Do not publish the occlusion rationale as sourced.

*(One detail from that paywalled paper's public abstract is worth having `[VA]`: the experimental instrument was "a 2nd order low shelving filter" whose level **and corner frequency** were both adjusted, "with and without loudness normalization and control of leakage effects". The published IE bass preference is natively expressed in the same parameter space the tuner emits, and leakage was a confound large enough to need controlling.)*

---

## 4. Measurement rigs, and the ceiling on trust

This section gates the tuner's treble behavior. Four independently-read sources bound the same thing and agree.

**The 711 / IEC 60318-4 occluded-ear simulator.** COMSOL's implementation documentation `[VA]` — an FEA vendor implementing the IEC spec, with no stake in headphone outcomes, and the cleanest statement found anywhere:

> "The length of the cylinder is prescribed by the IEC standard to be such as to produce a half-wavelength resonance at around 13.5 kHz. In this model L = 12.5 mm, which gives a resonance at 13.8 kHz." "The transfer impedance and microphone response are specified in the frequency range 100 Hz to 10 kHz. **Above 10 kHz, the 711 coupler does not simulate a human ear.**"

Brüel & Kjær `[VA]`, on the same coupler, states it is "only qualified for frequencies up to 8 kHz", and that customers "were attempting to make measurements on their products using 711-based ear simulators in a frequency range where the acoustic impedance was not defined." Their Type 5128 required "extensive research (more than ten years) to be able to accurately define an average acoustic impedance to 20 kHz."

audioXpress `[VA]` (Butterworth, 2018, trade press with own measurements) supplies the uncertainty figure and the reason the artifact is unstable:

> "Due to resonances in the acoustic transfer impedance of the occluded-ear simulator above 10 kHz, high measurement uncertainties, e.g., in the order of 10 dB, can occur in earphone responses." "Because the resonance of the ear simulator chamber is determined in part by the distance from the microphone diaphragm to the headphone under test, the frequency of the resonance drops when the headphone under test is further away from the mic diaphragm."

and notes that irregularities in the real human ear canal prevent this artifact arising naturally. GRAS claims the RA040X reduces the 13.5 kHz resonance "by 14 dB without significantly affecting response below 10 kHz"; the reviewer measured "-7.9 dB" on a real device — roughly half the claim.

**Where the artifact actually lands, and why it matters to `sibilant`.** A claim circulates that the resonance sits at 8–11 kHz for a real IEM because of the λ/2 distance to the microphone membrane. **That figure is not published anywhere reachable above forum tier and is not asserted here.** What stands instead is a labeled derivation, given so the reasoning can be judged rather than trusted: λ/2 of 12.5 mm gives 13.7 kHz, reproducing COMSOL's own 13.8 kHz and validating the model; audioXpress `[VA]` states the resonance drops as the source sits further from the diaphragm; an IEM nozzle plus tip adds roughly 3–9 mm, which would place it between 11.0 and 8.0 kHz. **This is a simple open-tube model with a changed boundary condition — a plausibility check, not a computed prediction.**

It is corroborated behaviorally rather than analytically: Crinacle normalizes insertion depth so that the coupler spike lands **at 8 kHz** `[VA]`. That has two consequences. The ~8 kHz feature in such a published curve is a rig resonance deliberately parked there, not an earphone property; and everything above roughly 6 kHz in that curve is contingent on the seating choice.

**Operational rule this supports:** treat **8 kHz as the qualified limit and 10 kHz as the hard confidence floor.** Above 10 kHz an IEM curve carries uncertainty on the order of the corrections the tuner would apply. Do not emit narrow high-Q bands above ~10 kHz, and do not read a feature at ~8 kHz as an earphone property. This is independently consistent with AutoEq's own optimizer capping at 10 kHz (`SOURCES.md` §1.1). In corrective mode this rule becomes a fitting constraint — `CORRECTIVE.md` §5 carries the operational form (moderated depth and Q above the ceiling, listening pass expected to trim, magnitudes never quoted at below-8 kHz precision).

**SBAF / HPDB — a deliberate negative result.** Their published methodology `[VA]` (forum/measurement-community tier, on GitHub, which is a better citation than the forum) states the rig verbatim: "MiniDSP EARS with screws removed (better seal) with compensation 3.2", "Flat Plate Coupler (no pinna with foam and felt overlay)", compensation designed for "a straight line across as perceptive neutral", "1/6 octave smoothed", "normalized to the region between 500 to 1500Hz". Their own caveat notes the flat plate "does have not an ear, e.g. pinna, concha, etc."

**They do not use a 711 at all.** Their data is honestly documented and internally useful for relative comparisons (A vs B, pad vs pad, open vs closed — and they do publish controlled pad-swap file pairs), but it is **not comparable to the 60318-4-referred profiles our chain carries**, and a flat-plate coupler is especially inappropriate for IEMs, which load into a sealed residual canal volume that a flat plate does not present. Cite them as evidence of why rig provenance must be checked; do not use their curves as tuner input.

---

## 5. The provenance gap in our own baseline

`SOURCES.md` §1.1 classes AutoEq as the highest-confidence source in this project "because the numbers are executable, not editorial." That remains true **of the constants**. It is not true of the profile data.

Verified `[VA]`: `results/oratory1990/over-ear/` exists in the AutoEq repository, and `results/oratory1990/README.md` "is a list of model names and links only. It states no rig, no coupler, no target, no compensation, no methodology." The repository top-level README names its data sources — oratory1990, crinacle, Innerfidelity, Rtings, legacy headphone.com measurements — and its targets, "but contains no technical detail on how any of those measurements were conducted, on what equipment, or any documented limitation."

**Consequences the tuner must respect:**

1. The rig behind a given AutoEq profile is **not documented in AutoEq**. Do not assume a profile is 711-, GRAS- or 5128-referred.
2. Profiles from **different contributors are not on a known common scale**. Two profiles are not necessarily comparable, and neither is a profile against a published target.
3. We know exactly what the filters *are*. We do not know what they were measured *against*.

This is a genuine limitation of the feature, not a defect to be engineered around, and it belongs in any user-facing explanation of what the tuner is doing.

---

## 6. Synthesis — the failure mode to read a complaint against

| | **Dynamic / moving coil (over-ear)** | **Planar magnetic** | **Electrostatic** | **Balanced armature (IEM)** | **Dynamic / moving coil (IEM)** |
|---|---|---|---|---|---|
| Drive | Voice coil at one point | "uniform driving force _directly_ across the entire diaphragm" | Uniform E-field, push-pull between "two parallel-arranged fixed electrodes" | Maxwell force; armature between two magnets | Voice coil, one-point suspension (surround only, no spider); small sealed/vented chamber couples straight to the canal |
| Impedance vs frequency | **Varies** — HD 550 "roughly 170 Ω at 1 kHz, and 320 Ω at 70 Hz" | "flat", "purely resistive load" | Own energizer; not a user variable | Rises with frequency (high inductance) | Not separately sourced — inherits §1.1's inductive-load mechanism, unconfirmed at IEM scale |
| Signature FR defect | **Narrow high-Q peak ~4–8 kHz**, cup-cavity reflection + concha | Broad shaping; magnet diffraction in treble; **no** break-up spike | Excursion-limited LF *(inference from construction, not cited)* | **Non-flat by construction** — first and second peaks, damped acoustically | Vent geometry sets the LF corner (mechanism sourced 3 ways, no Hz number); **no cup resonance** the over-ear peak depends on *(inference, not a quote)* |
| Rule out first | **Source output impedance → ~2.94 dB bass lift in the worked example** | — (flat impedance) | Bias/energizer mismatch = level, not tone | **Seal** — bass "disappears" without a sealed canal | Vent/pressure-relief trade-off before reading a bass complaint as target error; on hybrids, crossover-region FR deviation before EQ (§2.1) |

**Cutting across all of them:**

1. **Pad condition and seal** (over-ear) — ~1–1.2 dB bass from pad age alone; broken seal loses bass *and* lifts ~350 Hz.
2. **Insertion depth, tip, and vent** (in-ear) — tip geometry alone spans ~10 dB across 9–20 kHz; a 2 mm vent moves the occlusion effect 8.5 dB at 200 Hz.
3. **Reseat variance** (over-ear) — up to 2 dB standard deviation is considered *acceptable* in the best band.
4. **Rig validity ceiling** — 8 kHz qualified, 10 kHz confidence floor, and above that the correction the user is already running stands on undefined ground.
5. **Multi-driver combination is not owned by any one driver technology, and is not free.** BA-to-BA (Knowles AN-030, §2.2) shows a direct measured phase-cancellation example: two drivers out of phase produce "a notch, or valley, in the response," reaching below 75 dB SPL against a ~105 dB in-phase level. DD-to-BA (Jiang et al. 2019, §2.1, full text `[V]`) shows a different but related failure mode — a bare shared-chamber hybrid **regressed** against the target curve relative to either driver alone (RMS deviation 9.70 vs. 8.94 dynamic-alone / 6.04 BA-alone) until an acoustic crossover (a tuned front-chamber tube) was added, after which it improved to 4.60. **A "hollow/recessed" or uneven complaint on any multi-driver IEM should be checked against a crossover-region defect before it is read as a target error** — on a BA-BA design that may be a phase-cancellation notch (AN-030); on a DD-BA hybrid it may be an untuned or poorly-tuned acoustic crossover, which is a distinct mechanism, not a confirmed phase notch (§2.1).

**The operational rule this base supports.** For an over-ear, corrections smaller than ~2 dB in the midrange, or anywhere above 8 kHz, sit within the measurement noise of the data the AutoEq correction was derived from. A "boomy" complaint should be checked against source impedance (dynamic only), pad state and seal *before* it is read as a target error. A "splashy/piercing" complaint on a dynamic has a specific physical suspect — the cup-cavity resonance at 4–8 kHz — which is narrow, fit-dependent, acoustically un-removable, and therefore exactly what EQ exists for.

This does **not** license an idle gate, a refusal, or a disabled control. It licenses a `clarify` — and in several of these cases `clarify` is the honest answer, because the fix is a pad, a tip, a seal or an amplifier, and no filter the tuner can emit will substitute for it.

---

## 7. Open items

- **Insertion depth with published dB figures** — still open. Direction is sourced; magnitude is not. One `[S]` lead (an Etymotic ER-2 spec reportedly stating "A change of 10 mm in the length of the sound tube will change the frequency response by 0.5 dB at some frequencies") failed TLS and **must not be cited**.
- **Foam vs silicone** broken out separately, and a bore-diameter series.
- **Dynamic-driver IEM vent** setting the bass rolloff corner — **mechanism now sourced three ways** (§2.1: Apple mass-loaded-duct patent, Apple back-volume-resonance patent, EM-Tech pressure-relief patent), **but no source gives a clean vent-diameter-to-Hz corner number.** Partial close, not full.
- ~~**DD+BA hybrid crossover, full text**~~ **RESOLVED 2026-07-25** — **Read in full `[V]`.** §2.1 is written around it; local copy is gitignored, not committed. The paper's own account is shared-front-chamber SPL summation plus acoustic-tube filtering, **not** phase/notch language — a DD-to-BA phase-notch citation analogous to Knowles AN-030 (§2.2) remains genuinely open.
- **Diaphragm breakup in small (5–12 mm) dynamic IEM diaphragms** — no citable source found. Do not cite the unverified ~15 kHz/~20 kHz figure that turned up as search-engine synthesis without a direct-fetch source behind it.
- **"No cup resonance" for IEM dynamic drivers** (§2.1) is an inference from construction + the existing canal-coupling mechanism, not a direct quote from any source.
- **Numeric seal-loss curve** for IEMs — mechanism sourced, magnitude not.
- **Planar IEM drivers**; **Sonion EST datasheets** (provisionally: none public).
- **B&K 5128 pinna/canal geometry** and a direct 5128-vs-711 comparison plot; **IEC 60318-7** named but not confirmed by any source read.
- **Peer-reviewed sources on over-ear measurement variance** — none reached. Two candidates (an *Acta Acustica* 2021 cross-site study; the ICA 2016 ear-simulator paper) were respectively not fetched and TLS-broken.
- **Occlusion rationale** for the Harman IE bass shelf — needs Olive et al. 2016 full text.
- **GRAS technical documentation** — `grasacoustics.com` returns 403 domain-wide to this fetcher; the RA0402 "± 2.2 dB from 10 to 20 kHz" tolerance is `[S]` and uncorroborated.
- **oratory1990's reasoning** — permanently `[X]`; reddit and web.archive.org are both blocked at the fetcher. His preset *data* in the AutoEq repo remains citable; his method and rationale are not.
