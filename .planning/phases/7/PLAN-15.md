---
phase: 7
plan: 15
requirements: []
depends_on: [1, 2, 3, 4]
files:
  - tests/js/support/meterfeed.js
  - tests/js/store/meter/apodstamp.test.js
  - tests/js/store/meter/apodstrip.test.js
  - tests/js/store/meter/feed.test.js
  - tests/js/store/meter/spectrum-motion.test.js
  - tests/js/store/meter/loop-boot.test.js
  - tests/js/store/meter/loop-painters.test.js
  - tests/js/store/meter/loop.test.js
  - tests/js/support/meterrig.js
  - tests/js/contracts/schedules.js
  - tests/js/model/gauges/playhead.test.js
  - tests/js/support/seeded.js
  - tests/js/contracts/spectrogram-picture.test.js
  - tests/js/contracts/trace-and-meters.test.js
  - tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js
---

# Phase 7: One time base - Plan 15: Meter and contract test code with no clones, no conversions of its own and no float allowances

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format javascript` reports no clone with a side in `tests/js/store/meter/`, `tests/js/contracts/`, `tests/js/support/meterfeed.js` or `tests/js/model/gauges/playhead.test.js`, except import lists repeated across split test files.
- `DROPPED_44K` is built from `CONTIGUOUS_44K` by leaving out the row it is named for, not written out a second time.
- No JavaScript test keeps a seconds-to-ms, samples-to-ms or µs-to-ms conversion of its own: no `SECOND_MS`, no `* 1000`, `/ 1000` or `/ 1e6` on a time; an expected time is written by hand and plumbing calls the time base.
- The meter store suites judge the playhead's moves and the covering frame with exact comparison, with no float allowance on a time.
- Every meter and contract suite still passes or fails exactly as at commit `503ddec8`, under the same count, and the phase 8 tables are untouched.

## Context

- D-03 binds this plan, with Plan 12's clone rules, `docs/spec/testing.md` constraints and common Verify, applied to each task's own files. D-03 names the two feed tables in `meterfeed.js` as unjustified: rule 13 bans a fake that answers by the algorithm under test, not an input table built from another.
- Plans 1 to 4 have already moved these suites onto the time base, the painters' `dt` to ms and the playhead's move to exact (Plan 2 Task 3). Tasks 1 to 3 touch only duplicated code (D-03). Tasks 4 and 5 finish what the earlier plans leave in the meter store suites and the Source paint suite: the conversions they still make themselves (D-10) and the float allowances they still keep on a time (D-07, owner ruling 2026-11-18: an allowance that absorbs float drift marks slop in the code, and the code is fixed so it can be tested exactly). They sit here because these files are this plan's and Plan 3's, and Plan 3's last task waits on owner copy. The phase 8 tables (`playhead-lag`, `playhead-motion`, `playhead-scroll`) stay byte-identical.
- The new support modules' names, `meterrig.js` and `seeded.js`, are the planner's.

## Tasks

### Task 1: The dropped-frame feed table is built from the contiguous one

- **Files:** tests/js/support/meterfeed.js
- **Reads:** tests/js/support/meterfeed.js#CONTIGUOUS_44K, tests/js/support/meterfeed.js#DROPPED_44K
- **Decisions:** D-03
- **Pins:** tests/js/store/meter/feed.test.js, tests/js/store/meter/loop.test.js
- **Action:** `DROPPED_44K` is `CONTIGUOUS_44K` without its fourth row, `{ at: 2765, n: 765 }`, built from it, so the two tables cannot drift apart; its rows and order are unchanged, and the header comment's "every table is written out by hand" sentence stays true of the hand-written ones and names this one as built from another.
- **Verify:** Plan 12's common Verify over this file, with (b) over `tests/js/store/meter/feed.test.js` and `tests/js/store/meter/loop.test.js`.

### Task 2: The meter store suites share their feed and loop rigs

- **Files:** tests/js/store/meter/apodstamp.test.js, tests/js/store/meter/apodstrip.test.js, tests/js/store/meter/feed.test.js, tests/js/store/meter/spectrum-motion.test.js, tests/js/store/meter/loop-boot.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/loop.test.js, tests/js/support/meterrig.js
- **Reads:** tests/js/store/meter/loop-painters.test.js#generatedFeed, tests/js/store/meter/feed.test.js
- **Decisions:** D-03
- **Pins:** tests/js/store/meter/apodstamp.test.js, tests/js/store/meter/apodstrip.test.js, tests/js/store/meter/feed.test.js, tests/js/store/meter/spectrum-motion.test.js, tests/js/store/meter/loop-boot.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/loop.test.js
- **Action:** Clones removed: the newest apodizing stamp read (apodstamp~apodstrip), the taken-frames summary (feed~spectrum-motion), the `feed.test.js` self-clone (near-identical geometry cases folded into one parametrized case, both kept), the stopped-paint times (loop-boot~loop-painters), the history summary (loop-painters~loop), `generatedFeed` (loop-painters~spectrum-motion). Shared code goes in `meterrig.js`. Expected to stay: apodstamp~apodstrip lines 23-30, loop-painters~loop lines 45-53 and spectrogram-bands~spectrogram, import lists.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 3: The contracts share their seeded generator and their probe run

- **Files:** tests/js/contracts/schedules.js, tests/js/model/gauges/playhead.test.js, tests/js/support/seeded.js, tests/js/contracts/spectrogram-picture.test.js, tests/js/contracts/trace-and-meters.test.js
- **Reads:** tests/js/contracts/schedules.js#random, tests/js/model/gauges/playhead.test.js#random, tests/js/contracts/spectrogram-picture.test.js, tests/js/contracts/trace-and-meters.test.js
- **Decisions:** D-03, D-11
- **Pins:** tests/js/contracts/trace-and-meters.test.js, tests/js/contracts/spectrogram-picture.test.js, tests/js/contracts/spectrogram-columns.test.js, tests/js/model/gauges/playhead.test.js
- **Action:** Clones removed: the seeded `random` (schedules~playhead.test, one generator in `seeded.js` giving the same sequence for the same seed), and the probe run that both contract suites repeat (spectrogram-picture~trace-and-meters, into the harness the two already import). The harness stays (D-11); no schedule, seed or assertion changes.
- **Verify:** Plan 12's common Verify over this task's files, plus `git diff 503ddec8 -- tests/js/model/gauges/playhead-lag.test.js tests/js/model/gauges/playhead-motion.test.js tests/js/model/gauges/playhead-scroll.test.js` prints nothing.

### Task 4: The meter store suites and the Source paint suite convert no time themselves

- **Files:** tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/spectrum-motion.test.js, tests/js/support/meterrig.js, tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js
- **Reads:** tests/js/store/meter/loop.test.js#afterABurst, tests/js/store/meter/loop-painters.test.js#generatedFeed, tests/js/store/meter/loop-painters.test.js#capturedFeed, tests/js/store/meter/loop-painters.test.js#replay, tests/js/store/meter/spectrum-motion.test.js#generated, tests/js/store/meter/spectrum-motion.test.js#captured, tests/js/store/meter/spectrum-motion.test.js#play, tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js#music, tests/js/contracts/world.js#handler, hqptuner/static/lib/timebase.js
- **Decisions:** D-02, D-10
- **Pins:** tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/spectrum-motion.test.js, tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js
- **Action:** Every `SECOND_MS` goes from `loop.test.js`, `loop-painters.test.js`, `spectrum-motion.test.js` and `drawers-source-paint-blank.test.js`, and with it every samples-to-ms, seconds-to-ms and µs conversion these suites still make themselves once Plan 3 has removed their `dt` products. D-10 sorts each one. An expected value a case states is written by hand: in `loop.test.js`, the playhead's target behind the feed's edge at each delay and the jump a changed offset adds, in ms beside the seconds the user types, and the break row's start in ms (rule 13: no table works out a stamp). Plumbing calls the time base: the wall time a generated burst lands at, the capture's 60 Hz paint wait, the capture's engine delay and owner offset on their way to the store (sent as the wire carries them, or converted through the time base's µs and seconds conversions, the test writer's choice), and the frame starts, lengths and ends the paint judgements read for a generated or captured feed, read through the time base from the same whole samples the suite sends, as the replay world reads its frames (Plan 4 Task 1). `drawers-source-paint-blank.test.js`'s running newest end is the whole-sample end converted once through the time base, never a running sum of converted lengths (D-02). Where Task 2 has moved one of these rigs into `meterrig.js`, the change lands there. Every case keeps what it asserts.
- **Verify:** Testing scope: plumbing and hand-written expected values; the suites' own cases are the check; no new test; testing stops there. (1) `grep -rnE "SECOND_MS|/ *1e6|(\*|/) *1000\b|\b1000 *(\*|/)" tests/js/store/meter tests/js/support/meterrig.js tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js` prints nothing. (2) The sweep over every JavaScript test: `grep -rnE "SECOND_MS|US_PER_MS|(MS|US)_PER_S\s*=|/ *1e6|(\*|/) *1000\b|\b1000 *(\*|/)" tests/js` prints no time conversion; the one line it may print is the output drawer pin suite's kHz comparison, `hz / 1000`, in that suite or in the rig Plan 12 moved it to. (3) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test` over every file in Pins gives the same outcome per test as at commit `503ddec8`. (4) `scripts/gate.sh npx tsc -p tsconfig.node.json` passes.

### Task 5: The meter store suites judge the playhead and the covering frame exactly

- **Files:** tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/spectrum-motion.test.js
- **Reads:** tests/js/store/meter/loop-painters.test.js#replay, tests/js/store/meter/loop.test.js#afterABurst, tests/js/store/meter/spectrum-motion.test.js#COVER_EPS, tests/js/store/meter/spectrum-motion.test.js#notTheFrameCoveringMost, hqptuner/static/model/gauges/playhead.js#pacePaint
- **Decisions:** D-07
- **Pins:** tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/spectrum-motion.test.js
- **Action:** The allowances these suites keep on playback times go (D-07, owner ruling 2026-11-18), and none returns under another name: the `1e-6` in `loop-painters.test.js`'s "moves the playhead exactly its wall time at every paint" cases, the `1e-6` in `loop.test.js`'s "after a burst each paint moves the playhead its wall time" cases, and `COVER_EPS` in `spectrum-motion.test.js`'s judgement of the frame covering most of a paint. The code under them is exact: Plan 2 Task 3 makes a paint at an unchanged delay leave the playhead exactly where it stood plus its `dt`, and the stamps and coverage the loop decides by come from the time base (Plans 1 and 2). The fact in Plan 4 Task 3 binds how a move is stated: a difference of two playheads cannot equal `dt` in doubles, so a move is stated by the position it leaves, where the playhead stood plus `dt`. Measured on a scratch copy on 2026-11-18, with these three compared exactly in that form: all of them pass with Plan 2 Task 3's fix in `pacePaint`, and against `pacePaint` at `503ddec8` the four generated-feed cases of the `loop-painters.test.js` move check fail. `WHOLE_FRAME` in `spectrum-motion.test.js` is the line's level rounding in frames, not a time, and it stays. Every case keeps what it asserts.
- **Verify:** Testing scope: the same cases at exact comparison; no new test; testing stops there. (1) `grep -nE "1e-[0-9]|COVER_EPS" tests/js/store/meter/loop.test.js tests/js/store/meter/loop-painters.test.js tests/js/store/meter/spectrum-motion.test.js` prints nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test` over every file in Pins gives the same outcome per test as at commit `503ddec8`.
