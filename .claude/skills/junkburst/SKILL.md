---
name: junkburst
description: Junk-filter auto-pilot work on the burst corpus: where the record, the corpus, the labels and the scoring package live, the label vocabulary and its 20k mapping, the standing rulings every grade obeys, the capture-round pipeline and its sandbox limits, the grading conventions, the engine-port tolerances, and the line between measuring program material and measuring HQPlayer's filters. Load before grading a candidate, running a scoring report, rendering or reading spectrograms, porting a rule into the engine, or writing to the junk note.
---

# Junkburst

## The record

`docs/research/junkfilter/junk-filter-autopilot-resource-20k.md` is the record and the authority for this work. Read its opening block, "Where things stand", before anything else; it says what is in the engine, what is open, and how the two label vocabularies map. Section numbers are cited from code and stay fixed. Section 6 is the regressions ledger: a beaten candidate moves there with only enough of its data to show why, and nobody tries it again.

A table that grades one of the contested albums on the other side names that basis in the paragraph above it. Section 2's standing rulings list the contested albums.

## Where things live

| Thing | Path |
|---|---|
| Corpus, canonical | `/srv/hqptuner/state/junkburst/`: raw bursts, `derived/`, `labels.tsv`, `tracks.tsv` |
| Scoring package | `scripts/junkburst/`, entry shim `scripts/junkcal/junkburst_blocks.py`; candidates under `features/`, per-frame views under `views/` |
| Capture | `scripts/junkcal/junkcal_burst.py`, 5 s bursts 120 s apart while hi-res plays |
| Printer, read-only | `scripts/junkcal/junkburst_print.py` |
| Engine | `hqptuner/engine/blockstats.py`, `junkrun.py`, `junkadvisor.py`, `junkcurve.py`; stream reader `metering.py` |
| Scratch, untracked | `~/dev/hqptuner/.junkburst*`: labelled reports, renders under `.junkburst-spectra-all/<artist> - <album>/`, the blind batch under `.junkburst-eyes/` |
| Feature flag | `ADVISOR_ENABLED` in `hqptuner/config.py` |

The scratch tree sits at the root of the older checkout, not this one; both `.gitignore`s carry `/.junkburst*`.

## Labels

`labels.tsv` is the owner's, per album from knowledge of the master, with a render as tiebreak; `BY_TRACK` on an album whose tracks differ, then one row per track. Never edit, drop or relabel a row. A label you dispute goes in the report with the track and the reason.

Vocabulary in the file: `FAKE`, `REAL`, `CLEAN`, `UNSURE`, `SKIP`, `BY_TRACK`. Target scheme (section 1): the filter name alone, `20K`, `30K`, `40K`, `50K`, `2X`, `4X`, `8X`, `OFF`, `SKIP`, with a content-stop column and an above-the-stop column. For 20k grading: `FAKE` and `20K` are fake; `REAL`, `CLEAN` and every filter label but `20K` are real; `UNSURE` and `SKIP` drop the track.

## Standing rulings

Every grade, script and plan obeys these. Each is argued in the section named.

- The corner is set by the music, not by the spur: the lowest setting whose roll-off start sits clear above the track's content ceiling (section 1). A spur does not veto 20k.
- A setting's name is not where it cuts. Roll-off starts read by eye on HQPlayer's meter: 20k about 22 kHz, 30k about 35, 40k about 42, 50k about 60 (section 1).
- A rising floor is not by itself a 50k signature (sections 1 and 5).
- No block decides 20k: the wall is read per frame and the engage is a per-track latch. A plan, script or grade that puts a block between the frame and the latch is a defect (section 2). A frame is one metering transform hop as the wire carries it, 1025 bins, about 94 a second at the source rate; a block is the 1 s of frames `blockstats.py` closes into one record. The window grid under grading conventions is the burst-level grading window of the block candidates, not a licence to put one under the 20k verdict.
- The grade unit for 20k is the track, with time from the first walled frame to the engage as the second column. A quiet burst on a fake album is not a miss (section 2).
- The cost of a wrong call is one-sided: never call real content junk; a missed upsample is a missed benefit. Scores weight accordingly (section 1).
- A spectrum rule is never the answer key. Grading a detector against a rule on the same spectrum measures two definitions, not the detector (section 2).
- Eyes read a steep real roll-off as a wall. A reading of wall plus band is a lead, not a label (section 2).
- Hysteresis and hold are forbidden on the live verdict; the run rule is the amendment (section 7).

## Measuring: what is fair and what is not

The source spectrum on the metering wire is standard data. Measure it freely: bins, minima, percentiles, steps, mirror correlation, spur peaks.

HQPlayer's filters are not measured. No passband corner, transition width, roll-off, attenuation or tap count, from a capture, a plot or a sweep, with the filter engaged or not. The roll-off starts above are eyeballed on HQPlayer's own meter and carry no attenuation and no width; that is the limit. Where the record is silent on a filter, the answer is "undocumented", never a measurement. A plan step that measures a filter is a defect.

## Capture round

One round, in this order. Every step reads the corpus under `/srv`, and steps 1 to 3 and the default of step 5 write there. The agent sandbox cannot write under `/srv`, cannot see host processes, and does not list the corpus directory at all, so the owner runs the round from a host shell; the agent's inputs are the reports and renders under the scratch tree, which it can read.

1. `scripts/junkcal/junkcal_burst.py`, one instance only. A second writer on the same names corrupts same-second captures.
2. `scripts/junkcal/junkburst_blocks.py unpack --workers 8`; a capture whose gzip CRC fails prints as `corrupt`.
3. `scripts/junkcal/junkburst_blocks.py tracks`, right after the round: Roon's logs under `/srv/roon/config/database/RoonServer/Logs` rotate, and track identity comes from them alone. Writes `tracks.tsv` beside `labels.tsv`.
4. Render and sort, from the older checkout's root: `.junkburst_render_scratch.py <slug> <stamp>`, `.junkburst_round3_index.py`, `.junkburst_round3_sort.py`. The venv has no matplotlib; the renderer is stdlib only.
5. `scripts/junkcal/junkburst_blocks.py report --labels`. `JB_REPORT` is a bare name under the capture directory or an absolute path taken as written; an absolute path under the scratch tree puts the report where the agent can read it. `JB_CLIFF_LO` moves the cliff bottom for one run.

A new round is graded once at the standing cut before it joins the cut pick (section 2). The standing cut, the run rule's constants and the contested albums are read from the record and the engine at the time of the work, not from here. Section 8 has every flag.

## Grading conventions

- Baseline first: the shipped rule as `junkrun.py` runs it, and the record's current candidate, on the whole corpus, before any change.
- Tables are wrong, fake-called-real, real-called-fake, per cut, with leave-one-album-out beside the fitted score (`features/jbloao.py`).
- Per-album and per-track breakdowns after every sweep; the named failures are what moved.
- Sweeps run the grid the record already uses: cuts, warm-up, window 0.125 to 5 s, fold 22.05, 24, 44.1, 48 kHz, container 88.2, 96, 192 kHz.
- Every candidate tried lands in the record, winners in their section and losers in section 6, with the report file named. A `.junkburst-report-<variant>.md` per scoring round.
- The corpus holds no 44.1 or 48 kHz bursts and no silent frame under the engine's RMS gate; a claim about either is unmeasured.

## Engine port

A rule ships as a numpy mirror of the scoring package's arithmetic in `blockstats.py`, not a scalar rewrite. Parity is proven against stored bursts at 88.2, 96 and 192 kHz: 1e-4 dB per bin and per scalar, the step read on `p90_smoothed`, the content edge bit for bit and the cliff fall within 1e-13 dB against `features/jbcurves.py`. The oracle fixture pinning `block_record` belongs under `tests/support/fixtures/`. Each stage is one slug through the plan gate, in the order section 7 lists.

## Blind eyes check

`.junkburst-eyes/build.py` cuts a stratified batch of hashed renders with `map.tsv` and per-reader manifests; `readings/agent-N.tsv` carry `hash wall_khz above_wall spans streaks confidence`; `detector.py` and `agreement.md` join readings to labels and detector output. Readers are `spectrogram-reader` dispatches, one image each, with the path alone; twelve images go to two neighbouring readers for drift. Presence is readable by eye; faint against dense is not, and no rule is built on it.
