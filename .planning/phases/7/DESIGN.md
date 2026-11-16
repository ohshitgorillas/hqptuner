# Phase 7: the playhead's design (Plan 4)

Status: proposed, awaiting the owner's approval of the spec text in section 6. Nothing under `hqptuner/` and no test has changed. Section 7 holds the owner's decision and is empty until it is given.

What this record rests on: the red run of the suites of Plans 2 and 3 at HEAD `91d11ab3` (log `/tmp/gate-node-lgpuT5LB.log`, 733 tests, 588 pass, 145 fail); the three captures through `tests/js/contracts/streams.js`; `docs/spec/timing.md`; the code named in each section. D-10 and D-11 are read as the owner wrote them in `CONTEXT.md`.

## 1. Diagnosis

### What is red and what is green

- All 145 failures are in `tests/js/contracts/steady-lag.test.js`. Every test of `steady-motion.test.js` and `steady-spectrogram.test.js` passes against today's rule. The defect is lag, not motion and not the picture, which is what D-11 says of the motion suite.
- The lag is read against each stream's own heard clock (D-10), never against Status `position`.
- The streams set the spectrum offset to 0.69 s (`OFFSET_S`), so every lag level reads about 690 ms above its anchor error. Only differences between levels, and the spread inside one read, are findings.

### Today's rule, in four parts

`pacePaint` (`hqptuner/static/model/gauges/playhead.js`, line 121) and `paint` (`hqptuner/static/store/meter/loop.js`, line 191) do these four things:

1. The anchor is set once, at the first paint after a restart, to the newest frame end less the delay.
2. After the anchor the playhead moves on wall `dt` only.
3. It stands at the newest frame end when it reaches it.
4. Nothing corrects it after the anchor.

### Property 1: the anchor takes whatever the first paint sees (part 1)

Read from the red run. The cases of group B-other and group C in the appendix fail on this.

- The held reader of the second capture, serial 16 (a rate change at 96000 to 44100, State stays 2). The replay shows the first paint after the restart at T+253 ms, 64 ms after the first frame landed, with the playhead at 56975.6 against a heard stamp of 58122.1. The anchor is the newest end less the delay, so it sat 457 ms below the settled line, about the settled lead of that start (514 ms, the figure in `streams.js`) less the lead the first paint saw. Level 1151.90 against 706.33 for serial 14, a start from stopped with no rush: `+   apart: 445.5668924240255,` in `test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_16_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader`.
- The held reader of the first capture, serial 33 (the same kind of change, State goes to 0 across it). The loop had stopped with State 0, so its playhead is null until T+653 ms. That first paint comes after the rush has landed, and the anchor is within 10 ms of the line (level 680.00 against the 690 ms offset, a lag error of -10 ms). So the same kind of rush leaves an error of -10 ms there and +457 ms in the second capture, because the loop's first paint with frames fell at a different point of the rush. This is the D-02 candidate "when the loop connected", and the red run shows it at work. It is a reading, not a fit: two replays, read paint by paint with a scratch script that is not kept.
- The pages that join late. The cases of group C compare the reader that holds with a page joining 400 ms or 900 ms after a serial change, and the joins with each other, and differ by up to 437.8 ms (`+   apart: 437.8,` in `test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_16`). A join's first paint sees whatever of the rush has landed by then. Same property as above; I did not trace each of the 85 cases paint by paint, so for the 85 it is the property they are consistent with, unconfirmed case by case.

### Property 2: nothing corrects the playhead after the anchor (part 4)

Read from the red run. The cases of group A and group B-drift fail on this.

- `+   moved: 72.3,` in `test_the_lag_holds_through_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader`: the lag moves by 95.49 ms over the read (level 764.99; spread 95.49 less one frame of 23.2 ms is the 72.3). The read holds 644 paints of 50 ms, 32.2 s, and the stream's drift is 2.97 ms per second: 32.2 s at 2.97 ms per second is 95.6 ms. The lag moves exactly as far as the stamps drift against wall time, which is what a playhead that moves on `dt` alone must do. The made-up faster and slower streams give the same: 544 paints, 27.2 s at 2.5 ms per second is 68.0 ms, read 67.87.
- The cases of group B-drift fail because one of the two reads they compare is a drifting one, so the two lags differ by what the drift has added (`+   apart: 26.7,` for serial 31 against serial 36 of the first capture).

### Property 3: the cap at the newest end (part 3)

No case of the red run shows it. At the 1.19 s effective delay of these streams (0.69 s offset plus about 0.5 s output delay) the playhead never reaches the newest end between bursts. It stays in the rule below, where it is unchanged except for what follows a stand.

### Unconfirmed

- The cross-rate cases of group B-other (the `across_the_change` cases and the pairs whose two starts differ in rate) fail on property 1. They would also fail the float-error clause of D-11 if the anchor were perfect, which section 3 shows. I could not separate the two causes in these cases from the red run.
- The 85 cases of group C: see above.
- Why the first capture's loop paints later than the second's. State 0 across the change stops the loop, so its first paint with frames waits for Status to show playing. That the second capture's State stays 2 and its first paint falls inside the rush is read from the replay; that State is what separates the two is a reading of the stream definitions, not a test of it.
- Fields not relied on: Status `output_fill`, `display_position` and `process_speed`. The hqpdoc MCP tools were not available to this executor. `.planning/phases/7/CAPTURE.md` ("What HQPlayer's own docs say") records that the readme and the manual name no Status field of this kind, and `docs/spec/protocol.md` line 301 lists `output_fill` and `process_speed` with units only. The rule below reads none of the three. It reads the stamps, the wall time a paint takes arrivals at, and the effective delay, which already reaches the page.

## 2. The proposed rule

One rule for all three behaviors: the playhead stands on the music's line. The line is the stamps' lead over wall time, read off the arrivals. The playhead stands one delay behind it, moves at wall speed, and follows the line by a bounded share of wall speed. It takes a rise of the line at once only during the opening of a restart.

Words used: the lead of a paint is the newest queued frame's end (playback ms) less the paint's wall time `now` (ms on the loop's clock). The stamps are counted from the connect, so a lead is compared only with leads of the same restart. The line is the lead the stamps hold once the start's rush is over.

### The inputs

Stamps (through the queued frames), the wall time of the paint (new input `now`, the loop's animation-frame time in ms on its clock), whether the paint took arrivals (new input `arrived`), the effective delay, `dt`, and the carried state of the last paint. No Status field other than the one the effective delay already reads (`output_delay`).

### The decision, paint by paint

1. If the paint took arrivals, it has seen a lead: the newest end less `now`. A paint sees an arrival no earlier than it landed, so the lead it sees is the line's lead less the wait between landing and paint, plus however early the burst landed against the line.
2. The line's lead, the ceiling, is the greatest lead seen over a short fixed span of recent paints. It is held in two half-spans (the greatest of the half being filled and of the one before), so it needs two numbers and an age, allocates nothing and forgets a rush's overshoot one span after it.
3. Where no paint in the span took arrivals, the ceiling keeps its last value.
4. The playhead's aim is `now + ceiling - delay`. The playhead is moved to the aim by `followLine`: it moves at wall speed, plus or minus a bounded share of that speed toward the aim. During the opening span after a restart a rise is taken at once. After it nothing moves the playhead by a step except a break or a changed delay.
5. A changed delay jumps the playhead by the change first, back for a raised delay and forward for a lowered one, as today, and then it follows the aim.
6. It never passes the newest queued frame's end. At the cap it stands until the next arrival. Having stood, it then returns to the line at the bounded share, which replaces today's "no catch-up for the time it stood".

### The four cases the brief names

- **An opening stretch.** At a break the state is discarded and the first paint anchors exactly where today's does, at the newest end less the delay. Then, for the opening span, each rise of the ceiling is taken at once, so the playhead rides up with the rush and ends on the line instead of 457 ms below it. For the first part of the opening it is still behind the music, as it is today, because the stamps have not yet reached their line; the visible cost is a jump forward during the rush, at the start, where a break already stands. The opening lies before every read of the suites (1500 ms after a serial change).
- **A gap between arrivals.** No lead is seen, the ceiling holds, the playhead moves on wall time along the line, the queued music carries it.
- **Stamps that drift against wall time.** Seen leads rise or fall with the drift, the ceiling follows them one span late, the playhead follows the ceiling at the bounded share. A drift of 3 ms per second is far below the share, and the error is the drift times the span.
- **A break.** Rule 3 is unchanged: the state is discarded, the playhead restarts one delay behind the newest end, and nothing is followed across the break. A loss of music that leaves no break (the first capture's serial 34, which drops 107 ms) shows as a fall of the seen leads, so the ceiling falls one span after it and the playhead follows at the bounded share.

### The constants

Rule 2 makes them display targets, each defined once in model code, none stands in for a measurement. They are chosen in Plan 5 from the figures below and not from the suites' tolerances, and Plan 5 reports each value it takes.

| Constant | What bounds it, from the captures |
|---|---|
| Opening span | At least the rush: the stamps are within 50 ms of their settled lead by +355 ms at most, and frames resume up to 217 ms after the serial change (`streams.js` header), so 572 ms. A provisional 1000 ms. |
| Window span | At least the longest wait between bursts of the steady feed, 262 ms (`timing.md`, Measured facts), so a span holds an arrival. A provisional 500 ms. A longer span carries a rush's overshoot (up to 606 ms against a settled 577, the third capture's serial 21) further past 1500 ms after the serial change. |
| Follow share | Above the drift (3 ms per second, 0.3 percent) and below the quarter of wall speed that the steady-motion suite lets a move stray by. A provisional 0.2. At 0.2 a fall of 107 ms takes about 535 ms. |

A budget with the provisional values, by arithmetic from the figures above and not by a run, in ms after the serial change. A rush's overshoot is over by 217 + 355 = 572 at the latest and leaves the span at 1072 at the latest. The largest overshoot read off the three captures is the second capture's serial 16, 561 against a settled 514, so 47 ms: at a share of 0.2 the fall takes 235 ms and the playhead is on the line by about 1310, inside the 1500 before a read. The 107 ms loss of the first capture's serial 34 starts 264 before the serial change; the last arrival before it leaves the span by 236 at the latest, and the fall of 107 ms takes 535 ms, so the follow ends by about 771. Both fit with room. Whether the suites agree is Plan 5's check; if one stays red there, the choices are another span or share, and either needs the owner.

### The binding rules

- Rule 1 (positions from stamps): the line is the stamps' lead over wall time; no running total of event `ms` is kept. The playhead is the one allowance, and section 6 widens its sentence.
- Rule 3 (a break restarts, nothing smooths across one): the state is discarded at a break, so nothing is followed across it.
- Rule 4 (one playhead): the one playhead signal stays the only position; no view gains one.
- Rule 5 (one pacing decision a paint): `pacePaint` stays the one decision a paint, now composed of the two functions of section 4; each paint still shows the playback from where the last ended, no gap, no overlap.
- Rules 6 and 10 (decisions pure, no clock in model code): `now` and `dt` come in as arguments; the two new functions are pure and live under `static/model/`.
- Rule 9 (a late paint costs no more than an on-time one): the state is two numbers and two ages; a paint takes one decision however late it is.

### Why the rule has to correct after the anchor

D-01 of this phase says a correction after the anchor changes the owner's v2.0.0 rule ("wall speed, arrivals do not steer it; drift and stall handling only if a measurement shows them needed"). The measurements are `.planning/phases/7/CAPTURE.md` (a gain of 446 ms over 170 s at 44100 with no change, and lead after a rate change) and the second capture's drift (2.12 ms per second), as Plan 2 Task 3 prints them. They show the stamps do drift against wall time and do run ahead by up to 606 ms after a start, and the red run shows the lag follows both. The change is that arrivals now steer the playhead through the ceiling, by a bounded share of wall speed. A burst landing early or late still changes nothing about its speed beyond that bound, because the ceiling is a maximum over a span and the share bounds the move.

## 3. D-11: what no rule can do

D-11 and the suite pin that the lag at one rate equals the lag at another within floating-point error: `FLOAT_MS = 1e-6` in `steady-lag.test.js` line 37. The rule above cannot reach that, and I believe no rule can, from these inputs. The reasons are in the test code, not guessed:

1. The heard clock of each start follows that start's own settled lead. The leads are 514, 539, 514, 419, 514 (first and second captures), 526, 577, 498 ms (third capture), listed in the `streams.js` header. Two starts have equal lag to 1e-6 ms only if the playhead reproduces each start's lead to 1e-6 ms.
2. The page sees an arrival at the paint that takes it. In the replay `frames.now` is set at the paint, after the frames that reached the page by then are delivered (`world.js`), and the paints are 50 ms apart (`PAINT_MS`). Arrivals land at whole milliseconds (`fixedEvents`). A lead seen at a paint is below the arrival's own lead by the part of a paint between the two, 0 to 50 ms. The best reading of the line is the greatest over a span, within the best phase of the span, never exact.
3. The made-up streams land bursts early or late by up to 40 ms (`JITTER_MS`) against the line. There the line is not in the data to any precision finer than the jitter.

So the float-error clause holds only where an estimate happens to be exact. What the rule can do is bring each start's lag to the same value within the part of a paint between a landing and the paint that sees it (up to 50 ms in the replays), and closer where the span finds a good phase. Where one metering frame is below a paint (a frame is 5.33 ms at 192000, 10.67 ms at 96000, 23.2 ms at 44100, against a paint of 50 ms in the replays and about 16.7 ms in a browser), even the same-rate clause is not certain; whether it holds is Plan 5's check against the suites.

### The choices for the owner

This record picks none.

- (a) Cross-rate cases read as same-rate cases do: within one metering frame of the finer rate. Changes `apart` in `steady-lag.test.js` for the cases that differ in rate and drops `FLOAT_MS`.
- (b) A tolerance of one paint for any two lags. Needs a statement of what the page's resolution is, 50 ms in the replays and 16.7 ms in a browser.
- (c) Keep `FLOAT_MS` and read each cross-rate case that stays red as a defect of the rule. Plan 5 then returns to the owner with those cases and no rule can turn them green.
- (d) Change the streams so each arrival lands on a paint and the made-up streams carry no jitter. Each start still has its own settled lead (point 1), so the heard clock would also need one lead for all starts, which no longer reproduces the captures. This rewrites Plan 3's streams and is the largest change.

Whichever the owner picks is a change to Plan 3's committed test, made by the owner's decision, not by Plan 5. The spec text in section 6 does not depend on the choice.

## 4. The split (testing rule 17)

The behavior holds three results, so it is split before it is written. Each decision, its pure function under `hqptuner/static/model/gauges/playhead.js`, the one value its test asserts, and, where the decision is new, the null stub the test is red against (testing rule 8).

| Decision | Pure function | Result type | The one value a test asserts | Null stub (zero value) |
|---|---|---|---|---|
| The line's lead from what the paints have seen | `settledLead({ lead, seen, dt, restart })`: the state of the last paint, the lead this paint saw or null, `dt`, whether the paint restarts | `LeadState { peak, prior, age, since, ceiling }` | `ceiling`, playback ms less wall ms | exported, returns `{ peak: 0, prior: 0, age: 0, since: 0, ceiling: 0 }` |
| Where the playhead stands after following the line | `followLine({ head, aim, dt, since })`: the playhead, the aim `now + ceiling - delay`, `dt`, wall ms since the restart | `number`, playback ms | the playhead's next position | exported, returns `0` |
| What a paint shows (existing) | `pacePaint` takes `now`, `arrived` and `lead` and calls the two above | `PaintDecision` with `lead` added | the existing values of the paint (`from`, `to`, `playhead`, `first`, `last`, `lead`'s frame index, `consumed`, `restart`); the carried state is checked by feeding paints in turn, not by asserting it | none: it exists and changes |

The tests of each new decision use leads of hundreds of milliseconds and positions away from 0, so the zero value differs from every value they expect. The opening is inside `followLine` as the choice between taking a rise at once and following at the share, decided by `since`; no boolean carries two meanings.

The name `lead` is used twice, once for the frame index in `PaintDecision` (today's field) and once for the seen lead. Plan 5 renames one before writing.

### The caller-side delta

- `pacePaint`'s one caller, `paint` in `hqptuner/static/store/meter/loop.js`, changes at one call site: it passes `now` and `arrived`, carries the `lead` state as it carries `end`, `playhead` and `delayed` now, and hands it back. One file, one site.
- The two new functions have exactly one caller each, `pacePaint`. Today's head computation (line 121 of `playhead.js`) moves into them with new logic, so they are not forwarders.
- Tests that change are listed in section 5. `pacePaint` has one test file (`tests/js/model/gauges/playhead.test.js`).

## 5. What changes where

### Code and header comments

- `hqptuner/static/model/gauges/playhead.js`: the header comment, which states today's four parts; `PaintInput` and `PaintDecision`; `pacePaint`'s head computation; the two new functions.
- `hqptuner/static/store/meter/loop.js`: the header comment's paragraph on the playhead ("The playhead moves at wall speed, on the loop's `dt`, and jumps by a changed delay; it never passes the newest queued frame's end"); `paint`, to pass `now` and `arrived`; the carried state beside `end`, `started` and `delayed`; `reset`, which clears it.
- `hqptuner/static/store/meter/delay.js` is read, unchanged: `effectiveDelay` stays the one delay.
- `hqptuner/static/store/meter/feed.js` and `spectrogram.js` are unchanged: the stamps and breaks come out as they do, and the spectrogram's edge is the playhead.

### Tests that pin today's rule and are rewritten under the new one

- The D-06 list: `tests/js/model/gauges/playhead.test.js` (lines 477, 593 to 599, 609, 630, 680, named in D-06; by test name: `test_the_paint_after_a_seek_to_${seek}_ms_stands_the_playhead_the_delay_behind_the_newest_end`, `test_in_${run.name}_the_playhead_moves_exactly_its_wall_time_at_every_paint_while_the_feed_lands`, `test_a_burst_landing_early_or_late_leaves_the_playhead_where_it_was_at_every_paint_short_of_the_newest_end` and the two paint-rate tests that follow) and `tests/js/store/meter/loop.test.js` (line 166).
- Contract 1 in `tests/js/contracts/trace-and-meters.test.js`, with `wallProbe` in `tests/js/contracts/trace-probes.js`, which reads each move against wall time.
- The wall-time scroll cap in `tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py` ("it never scrolls further than its wall time covers").
- Other pins the rule breaks: `.planning/phases/7/CAPTURE.md` is pinned by `tests/js/model/gauges/playhead.test.js` and `tests/js/store/meter/loop-painters.test.js`, per the code map. Any other test that reads the playhead against wall time is found by Plan 5's run, not by search here.

### For the orchestrator to update, not edited here

`.planning/PROJECT.md` line 76, the key decision row "The meter playhead advances on the loop's `dt` between frames, capped at the newest stamp less the delay" (D-07 calls it stale already, since the cap is now the newest end). Proposed replacement of the decision cell once the owner approves: "The meter playhead stands one delay behind the stamps' line, moves on the loop's `dt` and follows the line by a bounded share of wall speed, capped at the newest frame's end". The rationale cell: "A rush after a start put the stamps ahead of wall time, so an anchor taken at the first paint left each start a different lag; Phase 7".

## 6. The spec text

Each passage replaces the one before it in `docs/spec/timing.md`, nothing else changes. Written soft-wrapped, no em dash. Constants are not in the spec text: Rule 2 holds them as display targets defined once in code.

### 6.1 "The two clocks", the playhead sentences

Before (everything after "Wall time never says where the music is." in the paragraph at line 27):

```text
The playhead moves at wall speed, on the loop's `dt`. When the delay changes, it jumps by the change: back for a raised delay, forward for a lowered one. It never passes the newest queued frame's end, a stamp, and if it reaches it, it stands there until the next arrival. Arrivals do not steer it: a burst landing early or late changes nothing about its speed. It never moves backward outside a break or a raised delay. At a break it restarts one delay behind the newest frame's end.
```

After:

```text
The playhead stands on the music's line, one delay behind where the stamps stand ahead of wall time. That lead is read off the arrivals, as the greatest seen over a short fixed span of recent paints, so a burst landing early or late does not move it. The playhead moves at wall speed, on the loop's `dt`, and follows the line by a bounded share of wall speed, up or down, so a stamp that drifts against wall time, or music lost without a break, is followed and a burst is not. When the delay changes, it jumps by the change: back for a raised delay, forward for a lowered one. It never passes the newest queued frame's end, a stamp, and if it reaches it, it stands there until the next arrival. It never moves backward outside a break or a raised delay. At a break it restarts one delay behind the newest frame's end, and through the opening span that follows it takes each rise of the line at once, because a start or a rate change lets the stamps run ahead of wall time before they settle.
```

### 6.2 Rule 1, the allowance

Before (the last three sentences of Rule 1):

```text
The one allowance is the playhead, which moves on the loop's `dt` at wall speed, jumps by the change when the delay changes, and never passes the newest queued frame's end, its only cap. The stamps stay the only authority for where the music is. A running total of event `ms` stays a defect.
```

After:

```text
The one allowance is the playhead, which moves on the loop's `dt` at wall speed, follows the line the stamps set by a bounded share of wall speed, jumps by the change when the delay changes, and never passes the newest queued frame's end, its only cap. The stamps stay the only authority for where the music is: the line is their lead over wall time. A running total of event `ms` stays a defect.
```

### 6.3 Rule 5, skip and catch-up

Before (last sentence of Rule 5):

```text
Skip and catch-up rules live in that function and nowhere else.
```

After:

```text
Skip, catch-up and the playhead's follow of its line live in that function, and in the pure functions it calls, and nowhere else.
```

### 6.4 Measured facts, one row added after "Feed arrival"

Before: no row. After:

```text
| Opening rush | After a start or a rate change the stamps run ahead of wall time and are within 50 ms of their settled lead by 355 ms after the first frame at most; that lead is 419 to 577 ms; frames resume up to 217 ms after the serial change | `scripts/probes/meter/arrival_patterns.py` on the three captures, "lead at +0,100,200,300,500" and "mean lead" |
```

## 7. The owner's decision

Pending. To be filled with the owner's approval, or the owner's changes and the re-approved text, character for character, and with the choice among (a) to (d) of section 3.

## Appendix: every failing case of the run, cited by its exact test name

Group A, 18 cases, property 2 (nothing corrects the playhead after the anchor): the lag moves with the drift.

- test_the_lag_holds_through_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader
- test_the_lag_holds_through_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader_joined_400_ms_after_serial_19
- test_the_lag_holds_through_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader_joined_900_ms_after_serial_19
- test_the_lag_holds_through_serial_1_a_start_from_stopped_at_44100_in_made_up_stamps_faster_held_reader
- test_the_lag_holds_through_serial_1_a_start_from_stopped_at_44100_in_made_up_stamps_faster_held_reader_joined_400_ms_after_serial_1
- test_the_lag_holds_through_serial_1_a_start_from_stopped_at_44100_in_made_up_stamps_faster_held_reader_joined_900_ms_after_serial_1
- test_the_lag_holds_through_serial_1_a_start_from_stopped_at_44100_in_made_up_stamps_slower_held_reader
- test_the_lag_holds_through_serial_1_a_start_from_stopped_at_44100_in_made_up_stamps_slower_held_reader_joined_400_ms_after_serial_1
- test_the_lag_holds_through_serial_1_a_start_from_stopped_at_44100_in_made_up_stamps_slower_held_reader_joined_900_ms_after_serial_1
- test_the_lag_holds_through_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_faster_held_reader
- test_the_lag_holds_through_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_faster_held_reader_joined_400_ms_after_serial_2
- test_the_lag_holds_through_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_faster_held_reader_joined_900_ms_after_serial_2
- test_the_lag_holds_through_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_slower_held_reader
- test_the_lag_holds_through_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_slower_held_reader_joined_400_ms_after_serial_2
- test_the_lag_holds_through_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_slower_held_reader_joined_900_ms_after_serial_2
- test_the_lag_holds_through_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader
- test_the_lag_holds_through_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader_joined_400_ms_after_serial_36
- test_the_lag_holds_through_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader_joined_900_ms_after_serial_36

Group B-drift, 10 cases, property 2: one of the two reads compared is a drifting one.

- test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader
- test_the_lag_after_serial_15_a_same_rate_change_at_96000_is_the_lag_after_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader
- test_the_lag_after_serial_16_a_rate_change_96000_to_44100_is_the_lag_after_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader
- test_the_lag_after_serial_17_a_rate_change_44100_to_96000_is_the_lag_after_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader
- test_the_lag_after_serial_18_a_rate_change_96000_to_44100_is_the_lag_after_serial_19_a_steady_play_at_44100_with_drift_in_capture_2_shape_held_reader
- test_the_lag_after_serial_31_a_start_from_stopped_at_44100_is_the_lag_after_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader
- test_the_lag_after_serial_32_a_same_rate_change_at_44100_is_the_lag_after_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader
- test_the_lag_after_serial_33_a_rate_change_44100_to_96000_is_the_lag_after_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader
- test_the_lag_after_serial_34_a_same_rate_change_at_96000_is_the_lag_after_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader
- test_the_lag_after_serial_35_a_rate_change_96000_to_44100_is_the_lag_after_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader

Group B-other, 32 cases, property 1 (the anchor takes what the first paint sees), the cross-rate ones also under section 3.

- test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_16_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_17_a_rate_change_44100_to_96000_in_capture_2_shape_held_reader
- test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_18_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_15_a_same_rate_change_at_96000_is_the_lag_after_serial_16_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_15_a_same_rate_change_at_96000_is_the_lag_after_serial_17_a_rate_change_44100_to_96000_in_capture_2_shape_held_reader
- test_the_lag_after_serial_15_a_same_rate_change_at_96000_is_the_lag_after_serial_18_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_16_a_rate_change_96000_to_44100_is_the_lag_after_serial_17_a_rate_change_44100_to_96000_in_capture_2_shape_held_reader
- test_the_lag_after_serial_17_a_rate_change_44100_to_96000_is_the_lag_after_serial_18_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_1_a_start_from_stopped_at_44100_is_the_lag_after_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_faster_held_reader
- test_the_lag_after_serial_1_a_start_from_stopped_at_44100_is_the_lag_after_serial_2_a_same_rate_change_at_44100_in_made_up_stamps_slower_held_reader
- test_the_lag_after_serial_1_a_start_from_stopped_at_44100_is_the_lag_after_serial_3_a_rate_change_44100_to_96000_in_made_up_bursty_held_reader
- test_the_lag_after_serial_20_a_start_from_stopped_at_192000_is_the_lag_after_serial_21_a_rate_change_192000_to_44100_in_capture_3_shape_held_reader
- test_the_lag_after_serial_20_a_start_from_stopped_at_192000_is_the_lag_after_serial_22_a_rate_change_44100_to_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_20_a_start_from_stopped_at_192000_is_the_lag_after_serial_23_a_same_rate_change_at_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_21_a_rate_change_192000_to_44100_is_the_lag_after_serial_22_a_rate_change_44100_to_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_21_a_rate_change_192000_to_44100_is_the_lag_after_serial_23_a_same_rate_change_at_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_2_a_same_rate_change_at_44100_is_the_lag_after_serial_3_a_rate_change_44100_to_96000_in_made_up_bursty_held_reader
- test_the_lag_after_serial_31_a_start_from_stopped_at_44100_is_the_lag_after_serial_33_a_rate_change_44100_to_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_31_a_start_from_stopped_at_44100_is_the_lag_after_serial_34_a_same_rate_change_at_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_32_a_same_rate_change_at_44100_is_the_lag_after_serial_33_a_rate_change_44100_to_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_32_a_same_rate_change_at_44100_is_the_lag_after_serial_34_a_same_rate_change_at_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_33_a_rate_change_44100_to_96000_is_the_lag_after_serial_34_a_same_rate_change_at_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_33_a_rate_change_44100_to_96000_is_the_lag_after_serial_35_a_rate_change_96000_to_44100_in_capture_1_shape_held_reader
- test_the_lag_after_serial_34_a_same_rate_change_at_96000_is_the_lag_after_serial_35_a_rate_change_96000_to_44100_in_capture_1_shape_held_reader
- test_the_lag_is_the_same_across_the_change_192000_to_44100_at_serial_21_in_capture_3_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_192000_at_serial_22_in_capture_3_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_96000_at_serial_17_in_capture_2_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_96000_at_serial_33_in_capture_1_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_96000_at_serial_3_in_made_up_bursty_held_reader
- test_the_lag_is_the_same_across_the_change_96000_to_44100_at_serial_16_in_capture_2_shape_held_reader
- test_the_lag_is_the_same_across_the_change_96000_to_44100_at_serial_18_in_capture_2_shape_held_reader
- test_the_lag_is_the_same_across_the_change_96000_to_44100_at_serial_35_in_capture_1_shape_held_reader

Group C, 85 cases, property 1 for a page that joins at a different point.

- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_31
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_34
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_36
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_14
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_15
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_16
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_17
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_18
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_20
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_23
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_1
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_2
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_3
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_stamps_faster_serial_1
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_stamps_faster_serial_2
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_stamps_slower_serial_2
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_34
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_16
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_17
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_18
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_19
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_20
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_23
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_made_up_bursty_serial_1
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_made_up_bursty_serial_2
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_made_up_bursty_serial_3
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_made_up_stamps_faster_serial_2
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_made_up_stamps_slower_serial_2
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_34
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_14
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_15
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_16
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_17
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_18
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_19
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_20
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_23
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_1
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_2
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_3
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_stamps_faster_serial_1
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_stamps_faster_serial_2
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_stamps_slower_serial_2
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
