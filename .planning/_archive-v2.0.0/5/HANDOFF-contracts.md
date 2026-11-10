# Handoff: meter painting contracts (phase 5, plan 3)

From session `889e317a-fe1f-4c55-befd-94784ae7fba9`, 2026-11-08. Recall: `~/.claude/skills/terminus/scripts/recall-session 889e317a-fe1f-4c55-befd-94784ae7fba9`.

## The task for the next session

Write a set of general contract tests for the meter painting code: the spectrum trace, the spectrogram's scroll and picture, the meters and the playhead that drives them. The owner wants tests that ask whether this code keeps its core promises, not tests that pin a suspected cause. The contracts below were agreed with the owner in this session. Derive the exact wording of each from the specs and the owner's rulings (D-01; the 2026-11-08 rulings: nothing interpolates except ridges and fire, the spectrum trace shows one whole frame per paint), never from the code. The owner approves the final list before any test is written. Tests first; a red run at HEAD is expected for some and is the point. Repo rules bind: `docs/spec/testing.md` (read first), no wall-clock waits, a plan names the behavior and the test writer picks unit, lane and values.

## The contracts, one behavior each

1. The playhead keeps wall time: between any two paints it advances by the wall time that passed, however frames arrive and however unevenly paints come; it never runs backward and never passes the newest music held.
2. The spectrogram scrolls at playback speed: over any run of paints it moves left by the playhead's advance in columns, within one column; never backward, never further than elapsed time allows.
3. The spectrogram picture is honest: after any sequence of paints the canvas equals what one fresh whole paint of the same view draws; every column over music shows that music, glass only where there is none.
4. The trace and meters show the music now playing: each paint shows the frame under the playhead, frames appear in playback order, a frame is skipped only when a paint gap covers it; while playing they never freeze and never go backward.
5. Unrelated changes cost the meters nothing: a status push, a settings change or a hidden list does no work that delays a meter paint. Counted, not timed.
6. Spectrum across time: over a run, the frames shown, in order with repeats collapsed, are exactly the frames played minus only the frames no paint landed in; each frame shows in one unbroken run of paints and never returns. Exact count: frames shown plus frames no paint could reach equal frames played.
7. Spectrogram across time, slices: every slice played lands in its own columns exactly once over the run and stays until it scrolls off. Exact count: slices played equal slices painted.
8. Spectrogram across time, scroll: the total columns scrolled over the whole run equals total playback time times columns per ms, within one column, after thousands of paints.

The owner first proposed "for N frames, N paints". It cannot hold for any code: frames are about 23 ms (about 43 a second), paints come at the display rate (60 to 72 Hz, slower when Safari stalls), a frame spans one to two paints by the one-whole-frame ruling, and a paint gap longer than a frame must skip frames. Contracts 6 to 8 are the form of that idea that can hold; the owner accepted them.

## How to drive them

- A virtual clock, never a wall clock.
- Each contract runs over seeded random paint and feed schedules: steady, jittered, dropped paints, feed bursts, single long stalls, runs of slow paints.
- Each also replays the owner's real Safari schedule: `.planning/phases/5/evidence/safari-paints-20261108.json` (keys `raf`, paint times in ms; `feed`, frame arrival times in ms; `scroll`, columns moved per paint in the second half, `n` where not read; `store`, the owner's prefs). It holds 1156 paints over 20 s and 930 frames, in bursts of 5. The next session decides whether it becomes a test fixture.
- Contracts 1 to 4 and 6 to 8 fit a DOM-free lane with a pixel canvas stand-in. A light browser lane can replay the same schedules through the real page.
- The existing tests (`spectroraster.test.js`, `drawers-source-paint-blank.test.js`, `spectrum-motion.test.js`, the Task 3 browser test) check narrow cases at steady 60 Hz in Chromium. That is why they pass while the owner sees failure.

## What is known at HEAD (14ac32c5)

These are findings, not contracts. They should fall out of the contracts as red; do not write tests aimed at them.

### Black lines in the spectrogram (contract 3, 7)

Cause, reproduced: when the scroll's leftover fraction of a column (`carry`) drops by 0.5 or more in the same paint that lands a slice, `landedColumn` (`hqptuner/static/lib/spectroraster.js:332`) places the slice on the current exact grid with `Math.floor`, one column right of where the kept, whole-column-shifted pixels sit. The repaint start in `scrollPlan` (`spectroraster.js:354`, `plan.from = Math.min(plan.from, next.landed ?? W)`) then skips a column painted glass earlier, and it stays glass. Wiring: `hqptuner/static/components/faceplate/drawers/source/paint.js:150` and `:156`. It needs uneven paint gaps (one dropped paint at 60 Hz suffices), seen at the 30 s window, never at steady 60 Hz.

Repro: `.planning/phases/5/evidence/blackline-repro.mjs` and its helper `probe.mjs`. They import `../hqptuner/...` and `../tests/...`, so copy both into `spike/` of a `git archive HEAD` copy and run from that copy's root: `node --import ./tests/js/support/vendor-resolve.js spike/blackline-repro.mjs 30 1016.75,1050.0833333`. At HEAD it prints `full-height glass inside: [1164]`. The original copy is `/tmp/spike-20261108T114925/copy` (17 MB, not deleted: a hook blocked `rm -rf`; deleting it is the owner's).

### Once-a-second stall from the status push (contract 5)

Evidence: Safari Timelines export `spectstutter.json` (100 MB, untracked, repo root). Each of the 10 `status` SSE events in it took 52 to 67 ms on the main thread; no other script task ran over 25 ms. In the 20 s paint capture, 18 of 56 paint gaps over 40 ms recur about every 1.06 s, the status push period.

Chain, verified by line: `store/sync.js:117` and `:144` write `engineStatus` on every push that reads differently. `ChainBody` (`hqptuner/static/app.js:48-49`) calls `railNow()`, which reads the whole `engineStatus.value` (`store/faceplate/chain.js:336`), so the chain body re-renders each push. That re-renders `<OptionList/>` (`app.js:62`): `narrowedOptions` then `rawOptions` (`store/faceplate/lists/options.js:42`) then `chainControlOf` (`store/live/chains.js:122`, map at `:86`) then `decorateOptions` (`store/plainnames.js:125`, sort and regex). `FacetPopovers` (`components/faceplate/lists/FacetPopover.js:227-232`) stay mounted after a list is first opened, children rendered while hidden (`Popover.js:144-145`), and recount through `previewCounts` (`store/faceplate/lists/facets.js:186`), which reads `engineStatus` through `runningChain` and `playbackPath` (`store/faceplate/path.js:32-38`). Also re-rendering each push: `EngineRow` (`components/faceplate/EngineRow.js:103`, `:106`), `RateDial` (`components/faceplate/drawers/output/RateDial.js:283-284`). The `playback` computed (`store/core/readings.js:112`) returns a new object each recompute, so its readers wake each push. Which status field changes each second was not checked.

### Slow stretches at about 14 fps (contracts 1, 2, 4)

In the 20 s capture there are runs of paints about 72 ms apart lasting up to half a second (for example 8.36 to 8.71 s, 11.2 to 11.8 s, 14.0 to 14.2 s), present in the first 10 s before any pixel readback. Cause unknown. Not correlated with feed bursts beyond chance (40 of 56 long gaps overlap a burst, about what chance gives). The Timelines export cannot show it: rAF ran a median 57.8 ms apart for the whole recording, likely from the Screenshots instrument (not confirmed). A rerun with Screenshots off, or a capture timing each paint callback against the gap, would separate our work from Safari's.

### Other measured facts

- Safari 27.0.1, macOS, dpr 1. Spectrogram canvas 1200 by 480, shown at 834 by 482 CSS px. Owner prefs include `hqptuner.apodWindow` 30 and `hqptuner.spectrumOffset` 0.747.
- Spectrum trace shape changed on all 1156 paints: it never froze; its stutter is the dropped paints.
- Spectrogram jumped 2 to 6 columns on 37 paints in the last 10 s, after long gaps.
- Ruled out live, in headless Chromium: delay changes (holds at 505.827 ms), arrival gaps beyond the buffer, long paint work (4.5 ms max), a single 1.5 s main-thread hitch.
- In the Safari profile, spectrogram history work (`closeSlice`, `fold` in `store/meter/spectrogram.js`) cost about 41 ms per second of recording, spread across paints; not shown to drop a paint.
- The page logs SVG errors at load (`<path> attribute d: Expected number, "M28 NaN L29.9 NaN L3…"`, `<text> attribute y: Expected length, "NaN"`, `<circle> attribute cx: Expected length, "-Infinity"`). The source component was not traced.

## Still open from earlier

- Risk check not run: `risk-check run --phase 5 --plan 3 --base 899128d2 --head HEAD`, then task-check, then the hand-back.
- Owner calls: whether the 14ac32c5 edit to the Task 3 browser test's start gate stands; whether the spectrogram history's power average of frames within a slice counts as interpolation; the ridge row that pops in at its birth.
- Uncommitted: `.planning/STATE.md`, `.planning/phases/5/PLAN-3.md`, `.planning/phases/5/reports/plan-2.md`, `plan-2.2.md`, `plan-3.md`, `plan-3.1.md`, this file and `.planning/phases/5/evidence/`. Untracked at repo root: `fuckedspecrogram.jpg` (owner's screenshot of the black lines), `spectstutter.json`.
- No repository code changed in this session.
