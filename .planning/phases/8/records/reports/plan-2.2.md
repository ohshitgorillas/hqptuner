PLAN CHECKPOINT: human-verify

Plan: .planning/phases/8/PLAN-2.md

Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 The owner checks the lag after a start at two rates on the rebuilt dev build | none | Preparation done, owner check pending. No commit: plan lease is `files: []`, verification only. |

Preparation evidence:
- Prior report rotated to `plan-2.1.md` (it was the earlier `blocked` run).
- HEAD `82453398` (Plan 1's last commit, committed 11:20:10). `/srv/hqptuner/rebuild/result` shows nonce `1795548121477767536`, `status=0`, finished 11:22:27, after HEAD and with no `hqptuner/` or `tests/` edits since. Container `python -m hqptuner` (pid 1475651) was started 11:22:26. `:8090` answers 200. No rebuild run by this agent, so none to announce; `task-check.sh` not re-run.
- `/api/status` (read-only GET): `active_rate` 22579200, `State` playing, `output_delay` 505827, source 44.1 kHz / 64bit / 2 ch. Music was playing during the captures. No write or transport command sent to hqplayerd. No Apply, Apply & Save, Discard or Save as New clicked.
- Own `scripts/snap.py` captures read element by element (1400x1000, dark):
  - `/tmp/cad-yg1aCo/snaps/page.png`, Source page: spectrum trace, fill, axes (0 to -120 dBFS, 0 to 22.05 kHz), L/R level bars with peak ticks and both VU needles all drawn and sane.
  - `/tmp/cad-yg1aCo/snaps/drawer.png`, Source drawer: spectrogram, 1 min window, right-aligned, about 5 s of history after a fresh page load, axes -60 s to 0 s and 0 to 22.05 kHz, apodizing strip drawn. No gaps or stalls visible in a still capture. A still capture cannot show lag, so it is no evidence for AC6.
- Observation, not absorbed: `--console` on a fresh load of `:8090` reports 20 console errors, none growing over 6 s: 12x `<text> attribute y: Expected length, "NaN"`, 6x `<path> attribute d: Expected number, "M28 NaN L29.9 NaN ..."`, 2x `<circle> attribute cx: Expected length, "-Infinity"`. Cause unverified; they look like a first paint before the first stream frame. Plan 1 touched `hqptuner/static/model/gauges/playhead.js` and `hqptuner/static/store/meter/loop.js`. No check was made whether these errors predate Plan 1.

Hand-back to the owner: http://10.0.0.238:8090 (Source page meters and spectrum, Source drawer spectrogram). Owner plays (1) a track from stopped, (2) a change to another track at the same rate, (3) a change to a track at a different rate, and compares the seen-versus-heard lag right after each start, well into the track, and between the two rates. Owner's words are the pass or the defect report.

Deviations: none

Open items: Console NaN/Infinity errors on first paint (above), cause and relation to Plan 1 unverified.
