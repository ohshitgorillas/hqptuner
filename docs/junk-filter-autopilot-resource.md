# Junk filter auto-pilot: approach and results

Reference for the junk filter auto-pilot: what each filter setting targets, the detector that currently performs best for it, how that detector scores against the labelled corpus, and which approaches lost to it. Living document until the feature is locked in. A result overwrites its predecessor only when it supersedes and improves it; a new capture round appends to the corpus section; an approach that is beaten moves to the regressions section with only enough of its data to show why it is not tried again.

Companion: `hqptuner/engine/junkadvisor.py` (classifier), `hqptuner/engine/metering.py` (spectral aggregates fed by hqplayerd's metering stream), `scripts/junkcal_burst.py` (raw burst capture), `scripts/junkburst_blocks.py` (unpack and scoring).

## 1 · What each setting targets

| Setting | Target | Signature in the spectrum |
|---|---|---|
| 20k | Fake hi-res: 1x content permanently upsampled into an Nx container | Brick wall at the source Nyquist, 20 to 24 kHz, with images, dither or nothing above it |
| 30k, 40k | Spurs: constant low-level tones in a narrow band from recording or playback equipment | Fixed-frequency peaks above 25 kHz, tens of dB below content, hidden by transients |
| 50k | DSD-derived or heavily noise-shaped masters | Ultrasonic noise floor that rises with frequency |

A fourth class, resampled hi-res (wall at a source Nyquist above 40 kHz, 40k is the right setting), is labelled `SHELVED` and left out of every score until the fake hi-res detector is settled. Engine of Hell is the one example: wall at 44 kHz in a 96 kHz container.

The three signatures need three different time behaviours. A spur is only visible where the music is not, so it is read from a long-window minimum. A ramp is visible in a single spectrum. A brick wall is visible in loud frames and vanishes in quiet ones, so it is read from the top of a short window's distribution. One aggregate cannot serve all three; the engine keeps one per family.

## 2 · Ground truth

The label is real or fake hi-res only, set by the owner per album from knowledge of the master, with a spectrum render as tiebreak. Spurs and rising HF noise count as real. A spectrum rule is never the answer key: grading a detector against a rule on the same spectrum measures the distance between two definitions, not the detector.

Bursts that span a track boundary are kept and scored in their own table, since they are the release test.

Corpus, under `/srv/hqptuner/state/junkburst/`: 428 bursts, stamps 084537Z to 215204Z. 417 carry a label keyed by artist and album in `labels.tsv`, joined to burst stamps through Roon history in `tracks.tsv`; one album is labelled by track and 30 track matches are low confidence. The 11 bursts stamped 215130Z to 215204Z have no track identity and no label.

Bursts whose 5 s spans overlap are the same audio captured by more than one instance of the capture script and collapse to the earliest stamp before scoring. The whole corpus collapses to 265 unique labelled bursts, 82 FAKE and 183 REAL, 10 of them transitions. A label other than `FAKE` or `REAL` drops the burst from every table.

Each burst is about 5 s of raw metering frames at the source rate, 2 channels, 1025 bins, about 94 frames per second, gzipped JSON with the wire bytes intact so any statistic can be recomputed.

Wall shapes on the rendered spectra, all fake: Master of Puppets, a hard wall at about 20.5 kHz with shaped noise rising above it; Foundations of Burden and Wine Dark Sea, soft walls, a 20 to 25 dB fall over two to three kHz at 22 and 24 kHz, then a dither floor; OK Computer, content stops at the old Nyquist with no clear fall below it. The soft-wall pair and OK Computer are the shapes the 20k detector must still catch. Every album the detector misses in full carries a wall on its render, so the remaining misses are detector misses, not label errors.

## 3 · 20k detector, current best

This detector lives in the scoring script only; the engine classifies on the 30 s block minimum.

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

Morningrise's 38 misses split two ways. 27 carry no reading: on the p90 curve some bin at the 26 kHz window top clears the floor plus `CONTRAST_DB`, because p90 keeps each bin's loudest tenth of frames and images or transient noise above the wall stand 11 dB over dither in loud frames, so `_content_edge` walks past the wall to the window top and returns None. The minimum curve drops those frames and reads the same blocks at 45 to 56 dB fall. The edge finder locates where anything stops; the wall detector needs where the music stops. The other 11 are a quiet passage where both curves read about 19 dB: the reference sits near the dither floor, so a reference-band fall is capped by passage level. Edge loss is the larger defect and is arithmetic; the level cap is the smaller and is the statistic's limit.

**By family.** The fake albums fall into three shapes, assigned by eye and by which detector misses them: soft wall with a dither floor above (Foundations of Burden, Wine Dark Sea, AVOW, White1, White2, Master of Puppets, Masterpiece, Guidance, My Arms Your Hearse, Symphony No. 5, The Chronic Re-Lit, Awaken My Love, Marked for Death, Another Eternity), hard wall with junk above (Morningrise, Orchid, The Hot Rock, Touched by the Crimson King, Vile Nilotic Rites, Amassakoul, Dragon New Warm Mountain), and no shelf, images from a gentle filter (OK Computer, CALIGULA, Amnesty). Wrong blocks at 1 s by family, p90 fall against the block minimum through `junkadvisor.classify`:

| Family | Blocks | p90 fall | Minimum |
|---|---:|---:|---:|
| Soft wall | 185 | 12 | 23 |
| Hard wall | 130 | 79 | 31 |
| No shelf | 40 | 39 | 40 |
| Real | 900 | 10 | 6 |

The two statistics miss different families: p90 keeps the soft wall that a minimum erases, and the minimum drops the junk above a hard wall that fools p90's edge finder. The larger of the two falls is the unscored combination. No statistic tried sees the no-shelf family; images are its signature, and a mirror test about the source Nyquist is the open candidate for it. That test is written (`scripts/junkburst/jbcandidates.py`, `f_folds`: Pearson correlation between the block-median residual 0.5 to 6 kHz below a fold and its mirror above, folds at 22.05 and 24 kHz, larger of the two) and reads no separation on any album, OK Computer included. Its per-block values are unexamined, so it is open, not beaten.

The cut is in-sample on the whole corpus. Any new capture set is graded once against it and never used to retune.

Transition bursts, 44 blocks, 33 fake: p90 fall 11 wrong at its own cut of 34 dB, all fake called real.

**Window.** Accuracy is flat from 0.125 s to 5 s. Block length buys stability only: bursts with a verdict flip fall 70, 64, 50, 26, 18 across 0.125, 0.25, 0.5, 1, 2 s. The knee is 1 s.

**Policy.** Engage on one fake block. Release only after N consecutive real blocks that carry a reading; a block with no reading holds state, because silence, a fade or content ending below 20 kHz says nothing about the master. A sample-rate change resets state at once. Same-rate track transitions bleed the filter into the next track for up to N seconds, chosen over flapping. N is open.

## 4 · 30k and 40k, current

Per-bin minimum over about 30 s, spur peak against its baseline. The labelled corpus counts spurs as real and cannot grade it.

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
- **Walk-up edge finder as a replacement.** Edge at the first bin 20 dB below the reference mean held for the guard width, from the reference band upward. Steady wrong 266 at a 16 dB step, 236 at 24, against 144 for the existing finder; a reference-floor guard from 8 to 16 dB changes nothing. It catches Morningrise, Orchid, The Hot Rock and Touched by the Crimson King where the existing finder walks past a hard wall, and loses Foundations of Burden, Wine Dark Sea, AVOW, White1 and Master of Puppets, where a soft wall never reaches 20 dB below the reference inside the window, and opens Is It Now? and Rage Against the Machine on notches in real music. The two finders miss different families; as a replacement it is beaten, as a second edge whose fall is taken alongside the first it is unscored.
- **Texture as a veto inside the fall.** A fall call vetoed to real when per-bin spread 1.5 to 4 kHz above the found edge exceeds 0.5 to 0.9 of the reference-band spread. The veto fires on fake blocks, not real ones: soft wall 122 to 150 wrong, hard wall 46 to 110, real unchanged. Dither jitter above a wall is not smaller than music spread, the same cause that beat the standalone texture candidates, so texture does not earn a place conditionally either.

## 7 · Tooling

- `scripts/junkcal_burst.py`: captures raw 5 s bursts while hi-res plays, 120 s apart, into `/srv/hqptuner/state/junkburst/`. Restart by hand for a new round.
- `scripts/junkburst_blocks.py unpack --workers 8`: decodes new bursts into `derived/`, first gzip member only. `report --labels`: collapses overlapping bursts, grades every candidate against `labels.tsv` and `tracks.tsv` at every window and writes `JB_REPORT`, a bare name under the capture directory or an absolute path. `JB_CLIFF_LO` moves the cliff window bottom for the run only. Unpack needs a shell that can write under `/srv`; the agent sandbox cannot, and it cannot see host processes either.
- Spectrum renders for labelling by eye: a stdlib-only script at the repo root, `.junkburst_render_scratch.py`, takes slug and stamp arguments and writes spectrogram and min, median, p90 line PNGs under `.junkburst-spectra-output/`. The venv has no matplotlib.
- The scoring script is the package `scripts/junkburst/`; `scripts/junkburst_blocks.py` is its entry shim. A run scores eleven candidates, seven of them beaten. `readings` takes its content edge from the walk-up finder (`jbcurves.py`, `_walk_up`). The finder behind the 144 result, highest smoothed bin inside the window above floor plus `CONTRAST_DB`, lives in `hqptuner/engine/junkadvisor.py` `_content_edge` and belongs back in `readings` before the p90 table is rerun.
- One capture instance at a time. Each restart of `junkcal_burst.py` without killing the previous one adds a writer on the same file names; the collapse step removes the duplicate bursts but a same-second collision corrupts the file, and a corrupt capture has no derived pair.
- Current labelled reports sit at the repo root, untracked: `.junkburst-report-labelled.md` at the 20 kHz window bottom, `-16k` and `-18k` variants beside it. Labels keyed by artist and album in `labels.tsv`, with `BY_TRACK` on an album whose tracks differ and one row per track after it.
- Track identity comes from Roon's server logs under `/srv/roon`, times in America/Los_Angeles; hqplayerd status carries no title.
