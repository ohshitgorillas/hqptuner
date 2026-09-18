# Junk filter auto-pilot: approach and results

Reference for the junk filter auto-pilot: what each filter setting targets, the detector that currently performs best for it, how that detector scores against the labelled corpus, and which approaches lost to it. Living document until the feature is locked in. A result overwrites its predecessor only when it supersedes and improves it; a new capture round appends to the corpus section; an approach that is beaten moves to the regressions section with only enough of its data to show why it is not tried again.

Companion: `hqptuner/engine/junkadvisor.py` (classifier), `hqptuner/engine/metering.py` (spectral aggregates fed by hqplayerd's metering stream), `scripts/junkcal_burst.py` (raw burst capture), `scripts/junkburst_blocks.py` (unpack and scoring).

## 1 · What each setting targets

| Setting | Target | Signature in the spectrum |
|---|---|---|
| 20k | Fake hi-res: 1x content permanently upsampled into an Nx container | Brick wall at the source Nyquist, 20 to 24 kHz, with images, dither or nothing above it |
| 30k, 40k | Spurs: constant low-level tones in a narrow band from recording or playback equipment | Fixed-frequency peaks above 25 kHz, tens of dB below content, hidden by transients |
| 50k | DSD-derived or heavily noise-shaped masters | Ultrasonic noise floor that rises with frequency |

A fourth class, hi-res band-limited above 24 kHz, is labelled `SHELVED` and left out of every score until ruled on; it has no member at present. Hi-res that needs no cleanup filter is labelled `CLEAN`, which grades as real in every 20k table. Engine of Hell, a wall at 44 kHz in a 96 kHz container, is one. Celestial Blues, a wall at 28.8 kHz with a spur on it in a 96 kHz container, is another: the shape of a converter with a slow roll-off at 30 kHz, Lavry-style, with a switching-supply tone in its transition band. The tone is a 30k matter (section 4), not a 20k one.

**The target is the setting, not the provenance.** The auto-pilot's output per block is one of `OFF`, `20K`, `30K`, `40K` and `50K`. A fake master does not by itself call for the 20k filter: the filter earns its place only where there is junk above the fold for it to remove. A block reads `OFF` where what sits above the fold is music, and where nothing sits there at all. Two files whose spectra match get the same treatment whatever was done to their masters, and where the spectra match the filter's effect matches too, so a provenance call on such a pair costs nothing.

**The cost of a wrong call is one-sided.** Engaging the 20k filter on a fake removes no music, since a fake has none above the fold; a needless engage on a fake costs nothing. Engaging it on real content removes that content. Never calling real content junk is the requirement; leaving junk alone is a missed benefit. Scores weight the two accordingly.

The three signatures need three different time behaviours. A spur is only visible where the music is not, so it is read from a minimum over a few seconds. A ramp is visible in a single spectrum. A brick wall in the music is visible in loud frames and vanishes in quiet ones, but the step it leaves in the noise floor at the source Nyquist is visible in both, so the wall is read from a short-window minimum at the fold (section 3). The engine still reads it from the top of a short window's distribution.

## 2 · Ground truth

The label is real or fake hi-res only, set by the owner per album from knowledge of the master, with a spectrum render as tiebreak. Spurs and rising HF noise count as real. A spectrum rule is never the answer key: grading a detector against a rule on the same spectrum measures the distance between two definitions, not the detector.

**Two questions per block, in order.** First, is there anything above the fold: the band's level, per Hz so containers at different rates compare, against full scale. Below the line the filter would remove nothing and the block is out of the score, since either answer costs nothing. Second, for a block that passes, is what sits there music or junk: on a real album it is music and the target is `OFF`, on a fake it is junk and the target is `20K`. The label decides the second question; the spectrum draws only the first, so the self-labelling trap stays closed. The level line is read from the corpus and is open.

The first question has a second way in. Junk that copies the music, images, falls with the music and its audible products fall faster. Junk at a fixed level, a shaped noise floor or a dither shelf, stays put while the music drops and its audible products lose their masking, so it matters more the quieter the passage. A block therefore also passes when the band above the fold stands within a ratio of the music level; that ratio is open beside the level line.

How the band above the fold moves against the music across a block's frames is also a signature of what it is: a fixed ratio is an image, a fixed level is a floor, neither is real content. That belongs to the second question and is unscored.

**Where the corpus sits on the first question.** The mask reading per block: summed-channel power per Hz, the block median across frames of the mean level over the band from 300 Hz to 6 kHz above the fold, at whichever of 22.05 and 24 kHz reads higher; the music level the same over 15 to 18 kHz; the ratio their difference. Over 1612 steady 1 s blocks, the report's `## Mask` section:

| Reading | Set | Blocks | p10 | p50 | p90 |
|---|---|---:|---:|---:|---:|
| Above-fold level, dB | Fake loud | 427 | -191.8 | -137.9 | -114.3 |
| Above-fold level, dB | Fake quiet | 65 | -193.4 | -151.6 | -138.4 |
| Above-fold level, dB | Real loud | 1032 | -124.5 | -118.3 | -109.2 |
| Above-fold level, dB | Real quiet | 88 | -150.8 | -136.1 | -119.2 |
| Ratio, dB | Fake loud | 427 | -75.8 | -41.0 | -15.7 |
| Ratio, dB | Real loud | 1032 | -23.0 | -13.0 | -3.3 |

Real content above the fold sits in a narrow band, and most fake blocks sit far below it: their stopband or dither shelf is what the band holds, and the 20k filter would remove nothing there. The fake albums whose above-fold median stands inside the real band are the ones with junk at content level, OK Computer at -113 dB, Vile Nilotic Rites -117, The Hot Rock -123, Wine Dark Sea and Foundations of Burden -127, CALIGULA -130. The fake side runs continuously from -155 to -102 dB, so no gap fixes the line; it is chosen by what it keeps, real blocks in the score and fake blocks that carry junk, and is open.

**Sweep of the line**, the report's `## Mask sweep` section, G graded leave-one-album-out over the kept blocks alone:

| Line | Fake kept | Real kept | Fake albums kept | G wrong | Fake called real | Real called fake |
|---:|---:|---:|---:|---:|---:|---:|
| -140 dB | 204 | 1143 | 16 | 107 | 80 | 27 |
| -130 dB | 112 | 1067 | 7 | 56 | 38 | 18 |
| -125 dB | 58 | 1017 | 6 | 44 | 30 | 14 |
| -120 dB | 31 | 693 | 3 | 31 | 21 | 10 |
| -115 dB | 13 | 424 | 2 | 8 | 8 | 0 |

A dropped block reads `OFF`, which is right on a real album and a missed benefit on a fake, so a higher line never adds a costly error and only lowers the junk it is willing to leave; the line is a judgment about how low junk sits before the filter stops mattering, not a fit. Real content above the fold sits from -125 to -109 dB, so -125 dB is the lowest line that keeps real music in play and is the working line.

At -125 dB the error is four albums. Airbag keeps 20 of 20 blocks and G misses every one: junk at content level with no floor step. Caress of Steel keeps 13 of 15 and G misses all 13. Foundations of Burden keeps 11 of 35 and G misses 10. Lateralus, The Patient, keeps 20 of 20 and G calls 12 fake; that track was labelled real when graded and is fake, so those 12 are catches and the 8 are misses. The slope reals, The Glowing Man, Eternal Return and One Beat, carry nothing above the line and drop out with their false alarms, and so does Simulation Swarm, all 5 blocks under the line. Every other fake with kept blocks is caught in full: Vile Nilotic Rites 13, The Hot Rock 8, Wine Dark Sea 5. OK Computer's four real tracks, 40 kept blocks, read real throughout.

**Real veto on the ratio.** Over the kept blocks the ratio separates the sides: real p10 to p90 runs -21.9 to -2.3 dB, fake -31.8 to -10.1. A kept block whose ratio stands at or above a line is forced to read `OFF` whatever the step says. Swept on G, held out:

| Veto line | Wrong | Fake called real | Real called fake |
|---:|---:|---:|---:|
| none | 44 | 30 | 14 |
| -8 dB | 35 | 30 | 5 |
| -12 dB | 35 | 30 | 5 |
| -15 dB | 34 | 30 | 4 |
| -18 dB | 34 | 32 | 2 |

At -15 dB the veto costs no fake block; at -18 dB it starts to take Wine Dark Sea, median -21.4. The working veto is -15 dB. Its real-side gain is 4 blocks, and its cost is The Patient, a fake whose junk above the fold sits within 7 dB of its music: 15 of that track's 20 blocks are forced real at a median ratio of -6.9 dB. The veto line is open. The sweep above reads The Patient as real, so its real-error column counts those blocks on the wrong side. Its reason is the one-sided cost: undecided blocks must fall to `OFF`, so fake is proven before engaging and real evidence overrides. With the -125 dB line and the -15 dB veto G's residue is 47 blocks of 1085: Airbag 20, Caress of Steel 13 and Foundations of Burden 10 left alone, 4 real blocks called junk. The loud-frame step below takes that to 23.

**What the residue looks like to the step.** Median signed step at the fold over kept blocks, above minus below, so a wall reads negative. Fakes caught: Vile Nilotic Rites -40.8 dB, The Hot Rock -24.4, The Past Is Still Alive -15.1, Wine Dark Sea -13.3. Fakes missed: Foundations of Burden -8.5, Airbag -6.0. Caress of Steel, fake, -6.4. Reals: Lateralus -8.8, Anhedonia -5.9, Bitches Brew -5.4, OK Computer's real tracks -1.9 to -3.3, most others -1 to -4. Airbag's minimum-curve step sits inside the real range; Foundations and Lateralus read the same size, so no cut on the step separates them and the ratio veto is what tells them apart.

**Loud-frame step**, candidate G90, open. On the Airbag render every transient stripe ends at 22.05 kHz while the minimum curve runs flat through it, so the step the eye reads lives in the loud frames. G90 is G's fold step on the per-bin 90th percentile curve instead of the minimum. Over kept blocks: fake median 11.9 dB, p10 3.1; real median 4.1, p90 8.4, p100 21.4. Per-album medians: Vile Nilotic Rites 35.4, The Past Is Still Alive 31.9, The Hot Rock 26.4, Wine Dark Sea 17.1, Airbag 15.2, Foundations of Burden 12.0, Caress of Steel 10.5; reals Lateralus 12.8, Let Down 9.5, OK Computer's other real tracks 2.5 to 5.8, the rest under 7. Caress of Steel is fake: G reads it -6.4 on the minimum curve and misses all 13 kept blocks, the loud-frame step reads it 10.5. Held out with the veto, Celestial Blues graded real: G 47 wrong, 43 fake called real, 4 real called fake; G90 34, 22 and 12; either fires 34, 21 and 13. The held-out cut for G90 lands near 14 dB because each fake album in play sits at a different height, so the fixed-cut sweep below is the better reading of what the statistic can do, at the price of the cut being chosen on the whole corpus:

| Cut | Wrong | Fake called real | Real called fake |
|---:|---:|---:|---:|
| 9 dB | 53 | 7 | 46 |
| 10 dB | 24 | 8 | 16 |
| 11 dB | 23 | 15 | 8 |
| 12 dB | 29 | 22 | 7 |
| 14 dB | 34 | 30 | 4 |

At 11 dB the fake side is Caress of Steel 8, Airbag 5, Foundations of Burden 2. The real side is one block each on Is It Now?, Meddle, Thrice Woven and Subterranean Homesick Alien, none of which reaches the filter under the policy's confirming block (section 3.2). The Patient adds 4 blocks where its ratio dips under the veto, and those are catches, not false alarms.

**Policy grade**, per unique steady burst, a burst engaging on two consecutive junk blocks, a dropped or vetoed block breaking the run. Of 98 fake bursts, 77 carry fewer than two blocks above the line and are settled `OFF` by the mask alone; 21 are in play, against about 200 real bursts.

| Rule | Veto | Real engaged | Fake engaged | Fake missed |
|---|---|---:|---:|---:|
| G at its cut | -15 dB | 0 | 9 | 12 |
| G90 at 11 dB | -15 dB | 0 | 13 | 8 |
| G90 at its held-out cut | -15 dB | 0 | 14 | 7 |
| Either fires | -15 dB | 0 | 14 | 7 |
| G at its cut | none | 0 | 11 | 10 |
| G90 at 11 dB | none | 1 | 15 | 6 |
| G90 at its held-out cut | none | 1 | 16 | 5 |
| G90 at 11 dB | -8 to -12 dB | 1 | 13 | 8 |
| G90 at 11 dB | -18 dB | 0 | 10 | 11 |
| G90 at 11 dB | -21 dB | 0 | 8 | 13 |

Under the policy no rule with the -15 dB veto engages a real burst anywhere in the corpus. The veto's whole cost is two bursts of The Patient, at 267 s and 393 s, whose junk sits within 8 dB of the music, and its whole gain is one burst of Meddle that the loud-frame step engages without it. The missed fakes at the working rule are Caress of Steel 1, Foundations of Burden 1, The Patient 2, Wine Dark Sea 1, and two more at 11 dB. Both-fire reads as G alone and either-fire as G90 alone, so the two statistics nest: every burst G engages, G90 engages too.

The working 20k rule is therefore: block kept at or above -125 dB per Hz above the fold, ratio to the music under -15 dB, loud-frame step over its cut; filter engages on the second consecutive such block and drops on the first block that fails any of the three. Celestial Blues, 10 kept blocks, reads real on every statistic.

The ratio does not serve the first question. Real ultrasonic content tracks the music to within about 15 dB, and junk sits tens of dB below it or is stopband, so a ratio route admits real blocks and drops fake ones, the reverse of a mask. It reads as a second-question signal and is unscored there.

Bursts that span a track boundary are kept and scored in their own table, since they are the release test.

Corpus, under `/srv/hqptuner/state/junkburst/`: 508 bursts, labelled by artist and album in `labels.tsv` and joined to burst stamps through Roon history in `tracks.tsv`; three albums are labelled by track: Dragon New Warm Mountain I Believe in You with Simulation Swarm fake and Love Love Love and Change real, OK Computer OKNOTOK with Airbag fake and Paranoid Android, Subterranean Homesick Alien, Exit Music (For a Film) and Let Down real, and Lateralus (Hi-Res Remaster) with The Patient fake, the only track of it captured. Caress of Steel is fake. A real-side error concentrated on one album is a label to re-examine before it is a detector defect. Every OK Computer figure in this document pools the album's 14 bursts, 6 of them Airbag, under one fake label; the next run regrades it by track. 30 track matches are low confidence, and a burst with no Roon line has no track identity and no label. A capture round grows the corpus; each new round is graded once at the standing cut before it joins the cut pick.

Bursts whose 5 s spans overlap are the same audio captured by more than one instance of the capture script and collapse to the earliest stamp before scoring. The whole corpus collapses to 334 unique labelled bursts, 107 FAKE and 227 REAL, 1612 steady 1 s blocks, 492 of them fake. A label other than `FAKE`, `REAL` or `CLEAN` drops the burst from every table; `CLEAN` grades as real.

Each burst is about 5 s of raw metering frames at the source rate, 2 channels, 1025 bins, about 94 frames per second, gzipped JSON with the wire bytes intact so any statistic can be recomputed.

Wall shapes on the rendered spectra, all fake: Master of Puppets, a hard wall at about 20.5 kHz with shaped noise rising above it; Foundations of Burden and Wine Dark Sea, soft walls, a 20 to 25 dB fall over two to three kHz at 22 and 24 kHz, then a dither floor; OK Computer, content stops at the old Nyquist with no clear fall below it. The soft-wall pair and OK Computer are the shapes the 20k detector must still catch. Every album the detector misses in full carries a wall on its render, so the remaining misses are detector misses, not label errors.

## 3 · 20k detector: floor step at a source Nyquist, and its loud-frame form

The working rule is the loud-frame step with the mask and veto of section 2; the floor step below is its minimum-curve form, nested inside it, and the account of how the fold step was found. Both live in the scoring script only, as candidates G and G90; the engine classifies on the 30 s block minimum through the reference-band fall.

**Signal.** In quiet and in loud passages alike, fake hi-res carries the source's noise floor, dither or shaped noise, up to the source Nyquist and the upsampler's stopband above it, so the floor itself steps at 22.05 or 24 kHz. A real converter floor has no reason to step there. The music above the floor is not measured at all, so the reference-band level cap and the edge-finder confusion of the previous best do not arise.

**Statistic.** Per-bin minimum over a 1 s block, 9-bin median smooth, then at each fold in 22.05 and 24 kHz the median over the 1.5 kHz band starting 300 Hz above the fold minus the median over the 1.5 kHz band ending 300 Hz below it. G is the larger absolute step of the two folds. A fold outside the burst's grid drops out. A block reads fake at 8 dB or more.

**Score, steady bursts, 1612 labelled 1 s blocks, cut chosen by minimum wrong-side in sample, then leave-one-album-out (each album graded at the cut picked over every other album):**

| Detector | Cut | Wrong | Fake called real | Real called fake | Wrong, held out |
|---|---:|---:|---:|---:|---:|
| G, floor step | 8.1 dB | 134 | 110 | 24 | 139 |
| p90 fall, previous best | 33 dB | 230 | 205 | 25 | 343 |

The held-out number is the one to trust, since errors come as whole albums. G's barely moves; the p90 fall's loss is almost all real called fake, so its cut fits particular real albums and G's does not.

G's wrong blocks by album, held out. Fake side: OK Computer OKNOTOK 56 of 60, CALIGULA 30 of 30, Masterpiece 9 of 10, Wine Dark Sea 8 of 40, Amassakoul 5 of 10, one each on Danny Brown and Pallbearer. Real side: Lateralus 13 of 20, The Glowing Man 6 of 10, Eternal Return 3 of 20, One Beat 3 of 5, Nevermind 1 of 10, Is It Now? 1 of 285. Every hard-wall album is caught in full, Morningrise 60 of 60 among them, and every soft-wall album but Masterpiece; Amnesty, filed under no shelf below, is caught in full.

The error is two families. The no-step fakes, CALIGULA and OK Computer, are 86 of the 112 fake misses: their floor runs flat through the fold. The slope reals, The Glowing Man, Eternal Return and One Beat, carry a steep natural roll-off through the fold. Lateralus, The Patient, is fake, so the 13 blocks in the real column above are catches. The Glowing Man's min, median and p90 all slide about 30 dB from 16 to 26 kHz and then flatten, no wall, and a slope of that steepness through the 24 kHz fold reads as an 8 dB difference between G's two bands. G cannot tell a slope from a step.

**Window.** Block length does not move G's error rate. Over the blocks the -125 dB line keeps, 84 wrong of 1075 at 1 s, 49 of 643 at 2 s, 17 of 217 at 5 s, all near 8 percent, and each of the three error albums is missed in the same proportion at every length: OK Computer 60 of 60, 36 of 36, 12 of 12. A longer minimum settles the curve but raises no shelf that is not there. Raw wrong counts across lengths fall only because block counts fall. The working block length is 1 s. Transition bursts, 44 blocks at 1 s, 33 fake: 10 wrong, 3 fake called real, 7 real called fake.

**Quiet passages.** A block is quiet when its absolute 15 to 18 kHz p90 level on the per-bin median curve sits under minus 105 dB, the corpus 10th percentile of that level. A rule on level above the block floor does not work: the floor is the 10th percentile of the whole curve, which on a fake with a deep stopband is the stopband itself, near minus 195 dB on Guidance, so the reference sits 100 dB above it in any passage and such an album never reads quiet; that rule measures stopband depth, not music level. Over the 1612 steady 1 s blocks the level rule marks 153 quiet, 65 of them fake across 11 albums. G at the quiet split's own cut of 4.4 dB: 8 wrong, CALIGULA 5 of 5 and Eternal Return 3 of 4 real called fake; every other quiet fake album is clean, median step 8.6 dB on Amassakoul, 8.8 on Amnesty, 13.7 on White1, 15.5 on Foundations of Burden, 21.8 on Morningrise, 35.6 on AVOW, 62.3 on Kondrashin's Symphony No. 5. Quiet detection on the floor step holds wherever a step exists. Wine Dark Sea's quiet blocks read a median 4.8 dB, under the loud cut of 8.1 dB, so one cut for both regimes misses them and a 4.4 dB cut costs Eternal Return; the cut is open until the real-side slope defect is addressed.

Two renders fix what quiet detection can and cannot do. Guidance, soft wall: min, median and p90 all flat to 21 kHz, then about 70 dB down to a floor between minus 175 and minus 195 dB; the minimum curve steps about 60 dB at the fold, dither against stopband, and dither does not leave in a quiet bar, so a fake with a deep stopband is detectable in quiet by construction. CALIGULA, no shelf: median and p90 one flat plateau from 8 kHz to 48 kHz near minus 120 dB, min near minus 138, no break at either fold; the spectrogram shows a shade change of 2 to 3 dB at 21 kHz, the shape of an upsample with no image filter, where the source floor images across the band at its own level. G at 8 dB cannot reach it. Its 5 quiet blocks read G steps between minus 2.2 and plus 0.6 dB at both folds, mixed sign.

Real albums clean for G at every block: Dark Side of the Moon 115, Meddle 55, Thrice Woven 40, Animals 25, Rheia 15, Anhedonia, Bitches Brew, Bone Machine, Shostakovich's Symphony No. 5, Vertigo. Guidance reads 0 wrong of 27 fake blocks; Wine Dark Sea reads 0 wrong on a burst 7 s into its first track.

### 3.1 Reference-band fall, previous best

**Statistic.** Per-bin 90th percentile of the summed-channel power over a 1 s block, then the existing cliff arithmetic of `junkadvisor`: content edge inside 20 to 26 kHz, fall measured from the 15 to 18 kHz reference to the median above the edge plus guard. A block reads fake at a fall of 36 dB or more. A block with no edge inside the window carries no reading.

**Score, 265 unique bursts, 1 s blocks, steady bursts, 1275 blocks of which 375 fake, cut chosen by minimum wrong-side:**

| Detector | Cut | Wrong | Fake called real | Real called fake |
|---|---:|---:|---:|---:|
| p90 fall | 34 dB | 144 | 134 | 10 |
| mean linear power fall | 35 dB | 154 | 149 | 5 |
| `junkadvisor.classify` on the block minimum | | 114 | 108 | 6 |
| share of frames with content above 24 kHz | 0.045 | 327 | 208 | 119 |

The real side is nearly clean for the p90 fall. The fake side misses a third of its blocks, and the misses are whole albums, not scattered blocks: Morningrise 38 of 60, CALIGULA 19 of 20, OK Computer OKNOTOK 10 of 10, The Hot Rock 10 of 10, Amnesty 10 of 10, Orchid 13 of 15, Touched by the Crimson King 9 of 15, Foundations of Burden 6 of 30, Vile Nilotic Rites 5 of 15.

The block minimum does not miss the same albums. It catches Orchid, Touched by the Crimson King and Vile Nilotic Rites in full and misses Morningrise on 11 blocks, not 38, while losing Wine Dark Sea 10 of 10 and Amassakoul 10 of 10 that the p90 fall catches. Both miss CALIGULA, OK Computer, The Hot Rock and Amnesty. The minimum sees Morningrise's wall because its edge finder is not fooled by loud-frame noise above the wall, as above.

The misses split into blocks with no reading and blocks with a reading below the cut. No reading: Morningrise 27, Orchid 13, The Hot Rock 10, Touched by the Crimson King 9, Vile Nilotic Rites 5, Amnesty 5. On the p90 curve some bin at the 26 kHz window top clears the floor plus `CONTRAST_DB`, because images or transient noise above a hard wall stand 11 dB over dither in loud frames, so `_content_edge` walks past the wall to the window top and returns None; the edge finder locates where anything stops, and the wall detector needs where the music stops. Below the cut: CALIGULA 17, Morningrise 11, OK Computer 10, Foundations of Burden 6, Amnesty 5. Morningrise's 11 are a quiet passage where the reference sits near the dither floor, so a reference-band fall is capped by passage level; that cap is the statistic's limit, and the reason the floor step replaced it.

**By family.** The fake albums fall into three shapes, assigned by eye and by which detector misses them: soft wall with a dither floor above (Foundations of Burden, Wine Dark Sea, AVOW, White1, White2, Master of Puppets, Masterpiece, Guidance, My Arms Your Hearse, Symphony No. 5, The Chronic Re-Lit, Awaken My Love, Marked for Death, Another Eternity), hard wall with junk above (Morningrise, Orchid, The Hot Rock, Touched by the Crimson King, Vile Nilotic Rites, Amassakoul, Dragon New Warm Mountain), and no shelf, images from a gentle filter (OK Computer, CALIGULA, Amnesty). Wrong blocks at 1 s by family, p90 fall against the block minimum through `junkadvisor.classify`:

| Family | Blocks | p90 fall | Minimum |
|---|---:|---:|---:|
| Soft wall | 185 | 12 | 23 |
| Hard wall | 130 | 79 | 31 |
| No shelf | 40 | 39 | 40 |
| Real | 900 | 10 | 6 |

The two statistics miss different families: p90 keeps the soft wall that a minimum erases, and the minimum drops the junk above a hard wall that fools p90's edge finder. The larger of the two falls loses to either alone (regressions). No statistic tried sees the no-shelf family; images are its signature, and a mirror test about the source Nyquist is the open candidate for it. That test is written (`scripts/junkburst/jbcandidates.py`, `f_folds`: Pearson correlation between the block-median residual 0.5 to 6 kHz below a fold and its mirror above, folds at 22.05 and 24 kHz, larger of the two) and reads no separation on any album, OK Computer included. Its per-block values are unexamined, so it is open, not beaten.

Transition bursts, 44 blocks, 33 fake: p90 fall 11 wrong at its own cut of 34 dB, all fake called real.

**Window.** Accuracy is flat from 0.125 s to 5 s. Block length buys stability only: bursts with a verdict flip fall 70, 64, 50, 26, 18 across 0.125, 0.25, 0.5, 1, 2 s. The knee is 1 s.

### 3.2 Policy

**Policy.** Changing the junk filter on the running engine costs nothing: no interruption, no glitch, no silence. So the 20k setting follows the blocks. It engages where a block reads junk above the fold and drops where the next block reads nothing to remove or music, a clean passage on a fake included. Some flapping is accepted; bleed into content that does not want the filter is capped at 4 s, which at 1 s blocks and a 1 to 2 s poll leaves room for one confirming block and no more. A sample-rate change resets state at once. The 30k and 40k settings keep a hysteresis of their own on a 3 to 5 s minimum (section 4).

## 4 · 30k and 40k, current

Per-bin minimum over about 30 s, spur peak against its baseline. The labelled corpus counts spurs as real and cannot grade it. Release follows the spur, not the track: a spur that fades out with its track releases the filter with it, and the filter is not held for a spur that might return. The window is 3 to 5 s, long enough for transients to fall out of the minimum and no longer; a 30 s minimum releases far too late. Whether a spur stays visible under a loud passage at that length is ungraded.

## 5 · 50k, current

Ramp slope over the top of the band on the current aggregate. The labelled corpus counts rising noise as real and cannot grade it.

## 6 · Regressions

Beaten approaches, kept so they are not repeated.

- **30 s per-bin minimum for the 20k wall.** A minimum keeps each bin's quietest frame, so quiet passages erase the wall and a loud frame cannot restore it: detection misses, release takes tens of seconds. It scores 114 wrong to the p90 block's 144 on the same 1275 blocks, so on accuracy alone it is not beaten yet; it loses on release time.
- **Lowering the cliff window bottom** to 18 or 16 kHz, reference band moved down with it. Wrong-side stays at 160 and 166 against 164 at 20 kHz, and the same albums are missed. The window is not where the misses come from.
- **Presence share above 22 or 24 kHz** (fraction of frames in the block with content above the cut). No threshold beats calling every block real: fakes carry images, dither or a noise shelf above the wall, so presence does not separate them.
- **Steepest 1 kHz fall at 20, 25 or 30 dB, and a two-row release rule**, both on the folded minimum. The fall rule flips its verdict inside an album and misses walled albums outright; the release rule never releases.
- **Self-labelled corpus** (label from a rule on the same spectrum). Grading a detector against a rule on the same spectrum measures the distance between two definitions, and every candidate reads a negative gap against it.
- **Per-burst labels on per-block readings.** A quiet block inside a real burst reads as a miss; labels must be per block.
- **Texture above the wall, three forms.** Fakes look tight above the wall on the line renders: smooth across bins, lines close together. Three statistics of that tightness over 24 to 26 kHz against 15 to 18 kHz, each as a ratio: per-bin p90 minus p10 across the block's frames (343 wrong at 1 s), p90 minus p10 of the summed band level across frames (350), and mean absolute residual of the block median after the 9-bin smooth (358). All three sit at the all-real baseline of 375 against 144 for the p90 fall, and no NaN guard helps except by dropping readings toward the majority class. The cause is the real side: most real hi-res carries nothing musical above 24 kHz either, only converter noise floor, which is as stationary and as smooth as dither. The reals whose ultrasonics carry music are the minority the eye happened to see. Real and fake differ by a step at a source Nyquist, not by texture above it.
- **Walk-up edge finder as a replacement.** Edge at the first bin 20 dB below the reference mean held for the guard width, from the reference band upward. Steady wrong 266 at a 16 dB step, 236 at 24, against 144 for the existing finder; a reference-floor guard from 8 to 16 dB changes nothing. It catches Morningrise, Orchid, The Hot Rock and Touched by the Crimson King where the existing finder walks past a hard wall, and loses Foundations of Burden, Wine Dark Sea, AVOW, White1 and Master of Puppets, where a soft wall never reaches 20 dB below the reference inside the window, and opens Is It Now? and Rage Against the Machine on notches in real music. The two finders miss different families; as a replacement it is beaten.
- **Larger of the two falls per block**, the existing finder's and the walk-up's. 229 wrong at a 55 dB cut, 207 fake called real, 22 real called fake, against 144 for the existing finder alone on the same 1275 blocks. The walk-up fall runs larger on real music than on a soft wall, so the larger-of-two reading pulls real albums over any cut low enough to catch the fakes, and the cut climbs until the fakes fall out. Combining the two finders has to be by agreement, not by maximum.
- **Floor step less the median step at control folds 27, 30 and 33 kHz** (candidate GC). On a 1275-block set, 63 wrong to G's 64, with the errors moved from the fake side to the real side, Lateralus 13 of 20 and One Beat 5 of 5. A control fold on a real converter floor is not flatter than the fold itself.
- **Floor step with its side bands subtracted** (candidate H: G's fold step minus the mean of the same two-band difference centred 2 kHz below and 2 kHz above the fold, meant to cancel a slope and keep a step). 156 wrong in sample and 176 held out against G's 134 and 139 on the same 1612 blocks. It fixes the slope cases it was built for, The Glowing Man 6 to 1, and Masterpiece 9 to 1, and breaks every soft wall whose fall spans 2 kHz or more, Foundations of Burden 2 to 9, White1 0 to 6, White2 0 to 2, and opens Is It Now? on notches, 1 to 14. A side band 2 kHz off the fold sits inside a soft wall's fall, so the subtraction cancels the wall along with the slope. The slope defect is 27 real blocks held out; no candidate has earned its cost fixing it.
- **Spread collapse above the fold** (candidate S): per-bin p90 minus per-bin minimum across frames, mean over 300 Hz to 1.8 kHz above the fold against the same band below it, on kept blocks with the veto. Fake median 0.91, real 0.95, held out 99 wrong. Real ultrasonic content in the kept blocks carries no more frame-to-frame dynamics than noise at that band width.
- **Pinned edge** (candidate P): per frame, the highest bin between 15 and 30 kHz standing 10 dB over the frame's 34 to 40 kHz mean, then the share of frames with that edge within 300 Hz of the fold. Reads 0 on nearly every block of either label: a single noisy bin near the search top clears 10 dB by chance in most frames, so the edge never lands at the fold. A stricter form, the edge being the highest bin with the whole kilohertz above it under the threshold, reads 0 on every block too, held out 58 of 58 fake blocks called real. Per-frame metering spectra do not carry a clean edge at this frame rate; the pinned edge the eye reads on a spectrogram is a many-frame average.
- **Mirror test in time** (candidate M): per offset from 500 Hz to 6 kHz, the correlation across a block's frames between the level at fold plus offset and at fold minus offset, less the same with the upper bin shifted 1 kHz off the mirror, median over offsets. Over the kept blocks fake median 0.031, real 0.033, OK Computer 0.040, real p90 0.096; held out it calls all 98 kept fake blocks real. The band above the fold on OK Computer does not move as a mirror of the band below it. Together with the time-averaged mirror test, which also read nothing, images are not what that album carries above the fold, or the metering's frames do not resolve them.
- **Frame correlation of the above-fold band against the music band** as an images test. Pearson across a block's frames between the two band levels: fake loud median 0.64, real loud 0.75, CALIGULA 0.10, OK Computer 0.64. Both bands ride the passage's loudness swings, so everything correlates and images are not singled out. A mirror-offset form that subtracts the correlation at a bin shifted off the mirror is untried.
- **Texture as a veto inside the fall.** A fall call vetoed to real when per-bin spread 1.5 to 4 kHz above the found edge exceeds 0.5 to 0.9 of the reference-band spread. The veto fires on fake blocks, not real ones: soft wall 122 to 150 wrong, hard wall 46 to 110, real unchanged. Dither jitter above a wall is not smaller than music spread, the same cause that beat the standalone texture candidates, so texture does not earn a place conditionally either.

## 7 · Tooling

- `scripts/junkcal_burst.py`: captures raw 5 s bursts while hi-res plays, 120 s apart, into `/srv/hqptuner/state/junkburst/`. Restart by hand for a new round.
- `scripts/junkburst_blocks.py unpack --workers 8`: decodes new bursts into `derived/`, first gzip member only. `report --labels`: collapses overlapping bursts, grades every candidate against `labels.tsv` and `tracks.tsv` at every window and writes `JB_REPORT`, a bare name under the capture directory or an absolute path. `JB_CLIFF_LO` moves the cliff window bottom for the run only. Unpack needs a shell that can write under `/srv`; the agent sandbox cannot, and it cannot see host processes either.
- Spectrum renders for labelling by eye: a stdlib-only script at the repo root, `.junkburst_render_scratch.py`, takes slug and stamp arguments and writes spectrogram and min, median, p90 line PNGs under `.junkburst-spectra-output/`. The venv has no matplotlib.
- The scoring script is the package `scripts/junkburst/`; `scripts/junkburst_blocks.py` is its entry shim. The quiet split and its per-album tables live in `jbquiet.py`, the mask deciles, per-album medians and the line sweep in `jbmask.py`, the veto sweep in `jbveto.py`, the mirror candidate in `jbmirror.py`, the edge candidates and their section in `jbedge.py`, and the burst-level policy grade with the loud-frame sweep in `jbpolicy.py`. `readings` takes its content edge from a vectorised port of `hqptuner/engine/junkadvisor.py` `_content_edge` and the `_cliff` fall (`jbcurves.py`, `_content_edges`, `_cliff_falls`) that agrees with the engine's functions bit for bit on the edge and within 1e-13 dB on the fall; `readings_walkup` keeps the walk-up finder for candidate AW. Leave-one-album-out grading lives in `jbloao.py`.
- `scripts/junkburst_print.py`: read-only printer over the derived captures, writing nothing. Table 1 is one named burst per album at the headline window, its signed fold step and its min-curve levels at 21, 23, 25 and 30 kHz. Table 2 is every block of every burst of every FAKE album, min and median of the reference-above-floor value.
- One capture instance at a time. Each restart of `junkcal_burst.py` without killing the previous one adds a writer on the same file names; the collapse step removes the duplicate bursts but a same-second collision corrupts the file, and a corrupt capture has no derived pair.
- Current labelled reports sit at the repo root, untracked: `.junkburst-report-labelled.md` at the 20 kHz window bottom, the `-16k` and `-18k` variants at the cliff bottom `JB_CLIFF_LO` names, and the `-E`, `-edge` and `-family` variants, one per scoring round. Labels keyed by artist and album in `labels.tsv`, with `BY_TRACK` on an album whose tracks differ and one row per track after it.
- Track identity comes from Roon's server logs under `/srv/roon`, times in America/Los_Angeles; hqplayerd status carries no title.
