# Phase 7: the playhead's design (Plan 4)

Status: proposed, awaiting the owner's approval of the spec text in section 6. Nothing under `hqptuner/` has changed. The tests changed twice, in Task 2 (D-12) and Task 3 (D-13); section 3 reads both results. Section 7 holds the owner's decisions.

What this record rests on: the red run of the suites of Plans 2 and 3 after Task 3's change to the tests, against today's code (log `/tmp/gate-node-MU4SUoqe.log`, 748 tests, 592 pass, 156 fail, every failure an `AssertionError`); the three captures through `tests/js/contracts/streams.js`; `docs/spec/timing.md`; the code named in each section. Task 1's first run was at HEAD `91d11ab3` with paints 50 ms apart (log `/tmp/gate-node-lgpuT5LB.log`, 733 tests, 145 fail) and Task 2's was at 60 Hz with the tolerances of D-12 (log `/tmp/gate-node-0DsPBroO.log`, 120 fail). Each figure below was read again on the run named first. D-10 to D-13 are read as the owner wrote them in `CONTEXT.md`.

## 1. Diagnosis

### What is red and what is green

- All 156 failures are in `tests/js/contracts/steady-lag.test.js`: 18 of them read how far the lag moves inside one track (`moved`) and 138 read how far two starts differ (`apart`). Every test of `steady-motion.test.js` and `steady-spectrogram.test.js` passes against today's rule. The 15 cases of the paired check (section 3) pass. The defect is lag, not motion and not the picture, which is what D-11 says of the motion suite.
- The lag is read against each stream's own heard clock (D-10), never against Status `position`.
- The streams set the spectrum offset to 0.69 s (`OFFSET_S`), so every lag level reads about 690 ms above its anchor error. Only differences between levels, and the spread inside one read, are findings.
- Since D-13 one tolerance governs every comparison between two starts: the stream's resolution, its arrival grain plus twice its jitter (section 3), 1.0 ms for the three captured streams and 81.0 ms for the made-up ones. A `+   apart: X,` line below is the difference between two lag levels less that tolerance.

### Today's rule, in four parts

`pacePaint` (`hqptuner/static/model/gauges/playhead.js`, line 121) and `paint` (`hqptuner/static/store/meter/loop.js`, line 191) do these four things:

1. The anchor is set once, at the first paint after a restart, to the newest frame end less the delay.
2. After the anchor the playhead moves on wall `dt` only.
3. It stands at the newest frame end when it reaches it.
4. Nothing corrects it after the anchor.

The page keeps no wall time for an arrival: the feed store (`hqptuner/static/store/meter/feed.js`, `decode`) stamps a frame with its playback position only, so the paint is the earliest moment the playhead can read what has arrived.

### Property 1: the anchor takes whatever the first paint finds (part 1)

Read from the red run, in two parts.

Property 1a, the anchor takes whatever of the rush has landed. The cases of group B-other and group C with a difference above 17 ms fail on this.

- The held reader of the second capture, serial 16 (a rate change at 96000 to 44100, State stays 2). The replay shows the first paint after the restart at T+236.3 ms, 16 ms after the first group of frames landed (T+220 ms), with the playhead at 56975.6, 1129.8 ms behind the heard stamp. The anchor is the newest end less the delay, so the lag stands 445 ms above the 690 ms offset (level 1135.23 below), about the settled lead of that start (514 ms, the figure in `streams.js`) less the lead the first paint saw, which by arithmetic from the rush table is 69 ms (one group of five frames, 116 ms, had landed 47 ms into the stretch). Level 1135.23 against 706.33 for serial 15, a same-rate change with no rush: `+   apart: 427.9,` in `test_the_lag_is_the_same_across_the_change_96000_to_44100_at_serial_16_in_capture_2_shape_held_reader` (428.9 ms between the two levels less the 1.0 ms resolution).
- The held reader of the first capture, serial 33 (the same kind of change, State goes to 0 across it). The loop had stopped with State 0, so its playhead is null until T+653 ms. That first paint comes after the rush has landed, and the anchor is within 10 ms of the line (level 680.00 against the 690 ms offset, a lag error of -10 ms). So the same kind of rush leaves an error of -10 ms there and +445 ms in the second capture, because the loop's first paint with frames fell at a different point of the rush. This is the D-02 candidate "when the loop connected", and the red run shows it at work. It is a reading, not a fit: two replays, read paint by paint with a scratch script that is not kept.
- The pages that join late. The cases of group C compare the reader that holds with a page joining 400 ms or 900 ms after a serial change, and the joins with each other. A join's first paint sees whatever of the rush has landed by then: serial 33 of the first capture, level 873.33 for the join at 400 ms and 693.33 at 900 ms, `+   apart: 179.0,` between the two joins. The reader that holds keeps the anchor of its last restart through a gapless change that restarts nothing, while a join anchors anew: serial 19 of the second capture is such a change, the held reader at level 1179.48 (its serial 18 anchor 1143.23 plus the drift) against 727.83 for the join at 900 ms, `+   apart: 450.7,` in `test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_19`. I did not trace each of the 49 group C cases above 17 ms paint by paint, so for them it is the property they are consistent with, unconfirmed case by case.

Property 1b, the anchor reads the newest end at a paint, and a paint is up to one paint after the arrival. The 53 cases of 17 ms and under (47 in group C, 6 in group B-other) are consistent with it, and two starts show it exactly.

- The second capture's serial 14, a start from stopped at 96000 with no rush. The first paint with a playhead falls 16.000 ms after the last arrival and the level is 706.333; the page joining 900 ms after the change paints 12.667 ms after its last arrival, level 703.000; the one joining 400 ms, 6.333 ms, level 696.333. The level less that wait is 690.333, 690.333 and 690.000: the offset plus the wait since the arrival, to the grain of the arrivals (1 ms). The first capture's serial 31 reads the same, waits 8.333 and 10.000 ms, levels 698.442 and 700.710, `+   apart: 1.3,` in `test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_31`.
- So a start without a rush lands within one paint (16.667 ms) of any other, which the tolerance of D-13 does not allow. The page has no arrival time to take that wait off. I traced two starts, not the other 51, so for those it is the property they are consistent with.

### Property 2: nothing corrects the playhead after the anchor (part 4)

Read from the red run. The cases of group A and group B-drift fail on this.

- `+   moved: 72.4,` in `test_the_lag_holds_through_serial_36_a_steady_play_at_44100_with_drift_in_capture_1_shape_held_reader`: the lag moves by 95.58 ms over the read (level 731.66; spread 95.58 less one frame of 23.2 ms is the 72.4). The read holds 32.2 s of paints and the stream's drift is 2.97 ms per second: 32.2 s at 2.97 ms per second is 95.6 ms. The lag moves exactly as far as the stamps drift against wall time, which is what a playhead that moves on `dt` alone must do. The made-up faster and slower streams give the same: 27.2 s at 2.5 ms per second is 68.0 ms, and the cases read `+   moved: 44.7,`, 44.7 ms past one frame of 23.2, a spread of 67.9.
- The cases of group B-drift fail because one of the two reads they compare is a drifting one, so the two lags differ by what the drift has added (`+   apart: 32.2,` for serial 31 against serial 36 of the first capture).

### Property 3: the cap at the newest end (part 3)

No case of the red run shows it. At the 1.19 s effective delay of these streams (0.69 s offset plus about 0.5 s output delay) the playhead never reaches the newest end between bursts. It stays in the rule below, where it is unchanged except for what follows a stand.

### Unconfirmed

- The cross-rate cases fail on property 1 and 2. The paired check of section 3 shows the rate is no part of the lag, so the rate does not enter these cases. What I did not do is trace each one paint by paint.
- A 5.4 ms difference at the second capture's serial 16: the lag at the restart paint is 1129.8 ms and 1135.23 ms as the read holds it. I did not trace where the 5.4 ms is gained.
- The cases of group C above 17 ms: see above.
- Why the first capture's loop paints later than the second's. State 0 across the change stops the loop, so its first paint with frames waits for Status to show playing. That the second capture's State stays 2 and its first paint falls inside the rush is read from the replay; that State is what separates the two is a reading of the stream definitions, not a test of it.
- How late a real browser runs the handler of a metering event. The replay hands each event over at its own wall time, so it cannot show it. A late handler stamps an arrival late, which lowers that arrival's lead, and the rule of section 2 takes the greatest lead over a span, so one late stamp does not move the line; a run of late stamps would, and nothing measured here says how often that happens.
- Fields not relied on: Status `output_fill`, `display_position` and `process_speed`. The hqpdoc MCP tools were not available to this executor. `.planning/phases/7/CAPTURE.md` ("What HQPlayer's own docs say") records that the readme and the manual name no Status field of this kind, and `docs/spec/protocol.md` line 301 lists `output_fill` and `process_speed` with units only. The rule below reads none of the three. It reads the stamps, the wall time each arrival landed, the wall time of the paint, and the effective delay, which already reaches the page.

## 2. The proposed rule

One rule for all three behaviors: the playhead stands on the music's line. The line is the stamps' lead over wall time, read off each arrival at the wall time it landed. The playhead stands one delay behind it, moves at wall speed, and follows the line by a bounded share of wall speed. It takes a rise of the line at once only during the opening of a restart.

Words used: the arrival time of a frame is the wall time (ms on the clock the feed store holds, the one `requestAnimationFrame` stamps its frames on) at which the feed store handled its event, stamped by the store the moment it arrives (D-13). The lead of an arrival is its newest frame's end (playback ms) less its arrival time. The lead of a paint is the lead of the newest frame the paint took, or none when the paint took no arrivals. `now` is the paint's wall time on the same clock. The stamps are counted from the connect, so a lead is compared only with leads of the same restart. The line is the lead the stamps hold once the start's rush is over.

### The inputs

Stamps (through the queued frames), the arrival time of each frame (new, `arrivedAt`, stamped by the feed store), the wall time of the paint (new input `now`, the loop's animation-frame time in ms on its clock), whether the paint took arrivals (new input `arrived`), the effective delay, `dt`, and the carried state of the last paint. No Status field other than the one the effective delay already reads (`output_delay`).

### The decision, paint by paint

1. If the paint took arrivals, it has seen a lead: the newest frame's end less its own arrival time. No wait between landing and paint enters it, and a burst that landed early or late shows as the lead it had.
2. The line's lead, the ceiling, is the greatest lead seen over a short fixed span of recent paints. It is held in two half-spans (the greatest of the half being filled and of the one before), so it needs two numbers and an age, allocates nothing and forgets a rush's overshoot one span after it. A late handler stamps its arrival late and so lowers that arrival's lead; the greatest of a span is not moved by one such stamp.
3. Where no paint in the span took arrivals, the ceiling keeps its last value.
4. The playhead's aim is `now + ceiling - delay`. The playhead is moved to the aim by `followLine`: it moves at wall speed, plus or minus a bounded share of that speed toward the aim. During the opening span after a restart a rise is taken at once. After it nothing moves the playhead by a step except a break or a changed delay.
5. A changed delay jumps the playhead by the change first, back for a raised delay and forward for a lowered one, as today, and then it follows the aim.
6. It never passes the newest queued frame's end. At the cap it stands until the next arrival. Having stood, it then returns to the line at the bounded share, which replaces today's "no catch-up for the time it stood".

### The four cases the brief names

- **An opening stretch.** At a break the state is discarded, the paint's own seen lead is the ceiling, and the playhead is placed on the aim, at the newest end less the delay plus the wait since that end's arrival, not at the newest end less the delay as today's anchor is. The two differ by the wait between landing and paint, 0 to 16.7 ms at 60 Hz, which is property 1b. Then, for the opening span, each rise of the ceiling is taken at once, so the playhead rides up with the rush and ends on the line instead of 457 ms below it. For the first part of the opening it is still behind the music, as it is today, because the stamps have not yet reached their line; the visible cost is a jump forward during the rush, at the start, where a break already stands. The opening lies before every read of the suites (1500 ms after a serial change).
- **A gap between arrivals.** No lead is seen, the ceiling holds, the playhead moves on wall time along the line, the queued music carries it.
- **Stamps that drift against wall time.** Seen leads rise or fall with the drift, the ceiling follows them one span late, the playhead follows the ceiling at the bounded share. A drift of 3 ms per second is far below the share, and the error is the drift times the span.
- **A break.** Rule 3 is unchanged: the state is discarded, the playhead restarts on the line the first arrivals set, and nothing is followed across the break. A loss of music that leaves no break (the first capture's serial 34, which drops 107 ms) shows as a fall of the seen leads, so the ceiling falls one span after it and the playhead follows at the bounded share.

### The constants

Rule 2 makes them display targets, each defined once in model code, none stands in for a measurement. They are chosen in Plan 5 from the figures below and not from the suites' tolerances, and Plan 5 reports each value it takes.

| Constant | What bounds it, from the captures |
|---|---|
| Opening span | At least the rush: the stamps are within 50 ms of their settled lead by +355 ms at most, and frames resume up to 217 ms after the serial change (`streams.js` header), so 572 ms. A provisional 1000 ms. |
| Window span | At least the longest wait between bursts of the steady feed, 262 ms (`timing.md`, Measured facts), so a span holds an arrival. A provisional 500 ms. A longer span carries a rush's overshoot (up to 606 ms against a settled 577, the third capture's serial 21) further past 1500 ms after the serial change. |
| Follow share | Above the drift (3 ms per second, 0.3 percent) and below the quarter of wall speed that the steady-motion suite lets a move stray by. A provisional 0.2. At 0.2 a fall of 107 ms takes about 535 ms. |

A budget with the provisional values, by arithmetic from the figures above and not by a run, in ms after the serial change. A rush's overshoot is over by 217 + 355 = 572 at the latest and leaves the span at 1072 at the latest. The largest overshoot read off the three captures is the second capture's serial 16, 561 against a settled 514, so 47 ms: at a share of 0.2 the fall takes 235 ms and the playhead is on the line by about 1310, inside the 1500 before a read. The 107 ms loss of the first capture's serial 34 starts 264 before the serial change; the last arrival before it leaves the span by 236 at the latest, and the fall of 107 ms takes 535 ms, so the follow ends by about 771. Both fit with room. Whether the suites agree, at the 1.0 ms resolution of the captured streams, is Plan 5's check; if one stays red there, the choices are another span or share, and either needs the owner.

### The binding rules

- Rule 1 (positions from stamps): the line is the stamps' lead over wall time, each lead read at its own arrival; no running total of event `ms` is kept. The arrival time says how far a stamp stands ahead of wall time, never where the music is. The playhead is the one allowance, and section 6 widens its sentence.
- Rule 3 (a break restarts, nothing smooths across one): the state is discarded at a break, so nothing is followed across it.
- Rule 4 (one playhead): the one playhead signal stays the only position; no view gains one.
- Rule 5 (one pacing decision a paint): `pacePaint` stays the one decision a paint, now composed of the two functions of section 4; each paint still shows the playback from where the last ended, no gap, no overlap.
- Rules 6 and 10 (decisions pure, no clock in model code): `now`, `dt` and every `arrivedAt` come in as arguments; the two new functions are pure and live under `static/model/`. The one clock read is the feed store's, which holds a `Clock` already.
- Rule 8 (one clock seam): the arrival time is read from the `Clock` the feed store is handed, `now()`, on the timeline `requestAnimationFrame` stamps its frames with (`lib/clock.js`), so an arrival time and a paint's `now` are comparable. No code outside `lib/clock.js` names `performance.now`.
- Rule 9 (a late paint costs no more than an on-time one): the state is two numbers and two ages, and a paint reads one lead, the newest frame's, however many arrivals it took; a paint takes one decision however late it is.

### Why the rule has to correct after the anchor

D-01 of this phase says a correction after the anchor changes the owner's v2.0.0 rule ("wall speed, arrivals do not steer it; drift and stall handling only if a measurement shows them needed"). The measurements are `.planning/phases/7/CAPTURE.md` (a gain of 446 ms over 170 s at 44100 with no change, and lead after a rate change) and the second capture's drift (2.12 ms per second), as Plan 2 Task 3 prints them. They show the stamps do drift against wall time and do run ahead by up to 606 ms after a start, and the red run shows the lag follows both. The change is that arrivals now steer the playhead through the ceiling, by a bounded share of wall speed. A burst landing early or late still changes nothing about its speed beyond that bound, because the ceiling is a maximum over a span and the share bounds the move.

## 3. D-12 and D-13: the paired check and each start's true lag

D-11 asked for one exact check across rates. The first draft of this section argued that no rule can match each captured start's lag to floating-point error, because the page reads each start's lead off arrivals seen at paints. The owner's D-12 split the check in two, and Task 2 built both contracts and ran them against today's code. Task 2's tolerance for the second contract carried a paint term, 17.667 ms on the captured streams, which came from a rule that reads arrivals at paints; D-13 removed it, and Task 3 changed the replay and the tolerance. Nothing under `hqptuner/` changed.

### The rate-agnostic check, exact

`PAIRS` in `tests/js/contracts/streams.js` holds two streams that are identical in everything but the source rate, 44100 against 192000 (the rates the owner asked for). `steady-lag.test.js` compares, at every paint of every read, the lag at one rate with the lag at the other, within `FLOAT_MS = 1e-6` ms. The cases are the five serials of the pair (a start from stopped with a rush, a same-rate change, a rate change each way, a steady play whose stamps drift 2.5 ms per second) on the reader that holds and on pages joining 400 ms and 900 ms after each serial change: 15 cases, named `test_at_every_paint_the_lag_is_the_same_at_44100_and_192000_after_serial_N_...`. How a pair holds the same information at both rates is in the `streams.js` header ("THE PAIRS"): the same arrival wall times, rush, jitter, drift, Status and delay, and every frame 20 ms, a whole number of samples at both rates, so every burst carries the same playback ms and ends on a frame end that both rates share.

Result against today's code, before and after Task 3: all 15 are green. Read off the held reader with a scratch script that is not kept, the lag level at the five serials is 702.667, 702.667, 1149.333, 1109.333 and 1123.333 ms in both streams, and the largest difference between the two at any paint is 0, 0, 1.6e-9, 4.5e-9 and 9.8e-9 ms. The paints are 60 Hz, 16.667 ms apart.

What that says about the cause: the rate is not one. The lag at a paint is a function of what arrived, the lead and the delay, and today's playhead reads nothing of the rate. The same pair shows the lag is not the same from track to track at either rate (702.667 ms at the start from stopped against 1149.333 ms at the rate change that follows it, with the same rush in both), which is property 1 of section 1 at work with the rate removed. So the red cross-rate cases of the captured starts are property 1 and 2 and not a rate leak. By D-12 the check is committed green. It has no red run against today's code, so it has no bite proof: it is a guard the rule of Plan 5 has to keep green, and a rule that reads the rate into the playhead turns it red.

### Each start's true lag

The comparisons between starts hold within the resolution the stream's own arrivals allow. `Stream.resolution` in `streams.js` is computed from the stream's own timing and replaces `FLOAT_MS` for every comparison between two starts, at one rate or at two (D-13): the arrival grain plus twice the jitter, 1 + 2 * 0 = 1.0 ms for the three captured streams (no jitter) and 1 + 2 * 40 = 81.0 ms for the made-up ones. The arithmetic is in the `streams.js` header ("THE RESOLUTION"). The one-metering-frame tolerance for starts at one rate (23.2, 10.7 and 5.3 ms) is retired.

Task 3 also changed the replay (`tests/js/contracts/world.js`): each event is handed to the page at its own wall time, with the clock reading that time while the page's handler runs. Today's feed store and loop read no clock at an event, so the playhead is unchanged. I checked it against the log of Task 2: of the 120 names red there, 109 are red in the run after Task 3, and every one of the 109 moved by the change of its tolerance, to a tenth of a ms (+22.2 where a 44100 frame of 23.2 ms gave way to 1.0, +9.7 and +4.3 for the 96000 and 192000 frames, +16.7 where a cross-rate resolution fell from 17.667 to 1.0 or from 97.667 to 81.0, -57.8 and -70.3 where the made-up streams' 81.0 replaced a frame, and 0 for the 18 `moved` cases, which no tolerance of this kind touches). Eleven names turned green (made-up same-rate cases, whose tolerance rose from a frame to 81.0 ms, the largest `apart` of them 51.8 before) and 47 turned red (captured-stream cases whose tolerance fell). Nothing was reshaped to turn a case red or green.

Result against today's code: 156 red, 748 tests in all. Group sizes, by what fails: 18 in group A (nothing corrects the playhead after the anchor), 10 in group B-drift, 32 in group B-other and 96 in group C. Of the 138 `apart` cases, 53 differ by 17 ms or less past the tolerance (property 1b) and 85 by more (property 1a and 2). The motion and the spectrogram suites stay green.

### What this leaves for the owner

Nothing open from D-12: the eight captured join cases that sat between one frame and the resolution are now read at the same 1.0 ms as every other comparison, and are among the red cases above. A tolerance of 1.0 ms is the grain of the arrivals; the resolution of a captured stream is the grain of the replay's whole-ms arrival times, not a property of the music. The record picks nothing about it.

The spec text in section 6 does not depend on the result; no sentence of it is proved wrong.

## 4. The split (testing rule 17)

The behavior holds three results, so it is split before it is written. Each decision, its pure function under `hqptuner/static/model/gauges/playhead.js`, the one value its test asserts, and, where the decision is new, the null stub the test is red against (testing rule 8).

| Decision | Pure function | Result type | The one value a test asserts | Null stub (zero value) |
|---|---|---|---|---|
| The line's lead from what the paints have seen | `settledLead({ lead, seen, dt, restart })`: the state of the last paint, the lead this paint saw or null, `dt`, whether the paint restarts | `LeadState { peak, prior, age, since, ceiling }` | `ceiling`, playback ms less wall ms | exported, returns `{ peak: 0, prior: 0, age: 0, since: 0, ceiling: 0 }` |
| Where the playhead stands after following the line | `followLine({ head, aim, dt, since })`: the playhead, the aim `now + ceiling - delay`, `dt`, wall ms since the restart | `number`, playback ms | the playhead's next position | exported, returns `0` |
| What a paint shows (existing) | `pacePaint` takes `now`, `arrived` and `arrivedAt` on each frame, computes the lead it saw from the newest frame (its end less its `arrivedAt`) and calls the two above | `PaintDecision` with the carried lead state added | the existing values of the paint (`from`, `to`, `playhead`, `first`, `last`, `lead`'s frame index, `consumed`, `restart`); the carried state is checked by feeding paints in turn, not by asserting it | none: it exists and changes |

The tests of each new decision use leads of hundreds of milliseconds and positions away from 0, so the zero value differs from every value they expect. The opening is inside `followLine` as the choice between taking a rise at once and following at the share, decided by `since`; no boolean carries two meanings. The lead of an arrival is one subtraction inside `pacePaint`, not a decision of its own. The stamping of the arrival time is the feed store's job and has no pure function: the store reads the `Clock` and writes one field.

The name `lead` is used twice, once for the frame index in `PaintDecision` (today's field) and once for the seen lead. Plan 5 renames one before writing.

### The caller-side delta

- `pacePaint`'s one caller, `paint` in `hqptuner/static/store/meter/loop.js`, changes at one call site: it passes `now` and `arrived`, carries the lead state as it carries `end`, `playhead` and `delayed` now, and hands it back. One file, one site.
- The feed store stamps the arrival: `hqptuner/static/store/meter/feed.js` changes at two sites, `openMeterFeed`, which keeps the `Clock` it is handed beyond the quiet window, and the `frame` handler's call into `decode`, which writes `arrivedAt`. The `MeterFrame` typedef (`hqptuner/static/model/gauges/meter/meter.js`) gains the optional field `arrivedAt`, wall ms, as `at` and `break` are optional there. One site constructs a `MeterFrame` from the wire, `decode`; the folded frames the meters build from a stride (`hqptuner/static/model/gauges/meter/steps.js`) are not arrivals and need no stamp.
- The two new functions have exactly one caller each, `pacePaint`. Today's head computation (line 121 of `playhead.js`) moves into them with new logic, so they are not forwarders.
- Tests that change are listed in section 5. `pacePaint` has one test file (`tests/js/model/gauges/playhead.test.js`).

## 5. What changes where

### Code and header comments

- `hqptuner/static/model/gauges/playhead.js`: the header comment, which states today's four parts; `PaintInput` and `PaintDecision`; `pacePaint`'s head computation and the restart anchor; the two new functions.
- `hqptuner/static/store/meter/feed.js`: the header comment (its paragraph on what a queued frame carries gains its arrival time), `decode` and the clock the store keeps (section 4).
- `hqptuner/static/model/gauges/meter/meter.js`: the `MeterFrame` typedef.
- `hqptuner/static/store/meter/loop.js`: the header comment's paragraph on the playhead ("The playhead moves at wall speed, on the loop's `dt`, and jumps by a changed delay; it never passes the newest queued frame's end"); `paint`, to pass `now` and `arrived`; the carried state beside `end`, `started` and `delayed`; `reset`, which clears it.
- `hqptuner/static/store/meter/delay.js` is read, unchanged: `effectiveDelay` stays the one delay.
- `hqptuner/static/store/meter/spectrogram.js` is unchanged: the stamps and breaks come out as they do, and the spectrogram's edge is the playhead.

### Tests that pin today's rule and are rewritten under the new one

- The D-06 list: `tests/js/model/gauges/playhead.test.js` (lines 477, 593 to 599, 609, 630, 680, named in D-06; by test name: `test_the_paint_after_a_seek_to_${seek}_ms_stands_the_playhead_the_delay_behind_the_newest_end`, `test_in_${run.name}_the_playhead_moves_exactly_its_wall_time_at_every_paint_while_the_feed_lands`, `test_a_burst_landing_early_or_late_leaves_the_playhead_where_it_was_at_every_paint_short_of_the_newest_end` and the two paint-rate tests that follow) and `tests/js/store/meter/loop.test.js` (line 166).
- Contract 1 in `tests/js/contracts/trace-and-meters.test.js`, with `wallProbe` in `tests/js/contracts/trace-probes.js`, which reads each move against wall time.
- The wall-time scroll cap in `tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py` ("it never scrolls further than its wall time covers").
- The feed store's tests (`tests/js/store/meter/feed.test.js`) gain the behavior "a frame the page queues carries the wall time at which the page received it"; their wording and values are the test writer's.
- Other pins the rule breaks: `.planning/phases/7/CAPTURE.md` is pinned by `tests/js/model/gauges/playhead.test.js` and `tests/js/store/meter/loop-painters.test.js`, per the code map. Any other test that reads the playhead against wall time, or builds a frame the rule reads, is found by Plan 5's run, not by search here.

### For the orchestrator to update, not edited here

`.planning/PROJECT.md` line 76, the key decision row "The meter playhead advances on the loop's `dt` between frames, capped at the newest stamp less the delay" (D-07 calls it stale already, since the cap is now the newest end). Proposed replacement of the decision cell once the owner approves: "The meter playhead stands one delay behind the stamps' line, read off each arrival's own wall time, moves on the loop's `dt` and follows the line by a bounded share of wall speed, capped at the newest frame's end". The rationale cell: "A rush after a start put the stamps ahead of wall time, so an anchor taken at the first paint left each start a different lag; Phase 7".

## 6. The spec text

Each passage replaces the one before it in `docs/spec/timing.md`, nothing else changes. Written soft-wrapped, no em dash. Constants are not in the spec text: Rule 2 holds them as display targets defined once in code. This text is a proposal. It is not approved, and it replaces the text of the first draft, which read the lead at each paint.

### 6.1 "The two clocks", the playhead sentences

Before (everything after "Wall time never says where the music is." in the paragraph at line 27):

```text
The playhead moves at wall speed, on the loop's `dt`. When the delay changes, it jumps by the change: back for a raised delay, forward for a lowered one. It never passes the newest queued frame's end, a stamp, and if it reaches it, it stands there until the next arrival. Arrivals do not steer it: a burst landing early or late changes nothing about its speed. It never moves backward outside a break or a raised delay. At a break it restarts one delay behind the newest frame's end.
```

After:

```text
The playhead stands on the music's line, one delay behind where the stamps stand ahead of wall time. The feed store stamps each event with the wall time it arrives at, and the lead of an arrival is its newest frame's end less that time. The lead of the line is the greatest lead seen over a short fixed span of recent paints, so a burst landing early or late does not move it. The playhead moves at wall speed, on the loop's `dt`, and follows the line by a bounded share of wall speed, up or down, so a stamp that drifts against wall time, or music lost without a break, is followed and a burst is not. When the delay changes, it jumps by the change: back for a raised delay, forward for a lowered one. It never passes the newest queued frame's end, a stamp, and if it reaches it, it stands there until the next arrival. It never moves backward outside a break or a raised delay. At a break it restarts one delay behind the newest frame's end, carried on at wall speed from the time that frame arrived, and through the opening span that follows it takes each rise of the line at once, because a start or a rate change lets the stamps run ahead of wall time before they settle.
```

### 6.2 Rule 1, the allowance

Before (the last three sentences of Rule 1):

```text
The one allowance is the playhead, which moves on the loop's `dt` at wall speed, jumps by the change when the delay changes, and never passes the newest queued frame's end, its only cap. The stamps stay the only authority for where the music is. A running total of event `ms` stays a defect.
```

After:

```text
The one allowance is the playhead, which moves on the loop's `dt` at wall speed, follows the line the stamps set by a bounded share of wall speed, jumps by the change when the delay changes, and never passes the newest queued frame's end, its only cap. The stamps stay the only authority for where the music is: the line is their lead over wall time, each lead read at the wall time its event arrived. A running total of event `ms` stays a defect.
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

### 6.4 The meter pipeline, the Feed store row

Before:

```text
| Feed store | Decoding, queueing, detecting a break in samples, converting the stamp to ms | `store/meter/feed.js` |
```

After:

```text
| Feed store | Decoding, queueing, detecting a break in samples, converting the stamp to ms, stamping each event with the wall time it arrived | `store/meter/feed.js` |
```

### 6.5 Measured facts, one row added after "Feed arrival"

Before: no row. After:

```text
| Opening rush | After a start or a rate change the stamps run ahead of wall time and are within 50 ms of their settled lead by 355 ms after the first frame at most; that lead is 419 to 577 ms; frames resume up to 217 ms after the serial change | `scripts/probes/meter/arrival_patterns.py` on the three captures, "lead at +0,100,200,300,500" and "mean lead" |
```

## 7. The owner's decisions

The D-11 choice, decided 2026-11-16 as D-12 (`.planning/phases/7/CONTEXT.md`, commit `963cf714`), replacing options (a) to (d) of the earlier draft of section 3: D-11's one exact cross-rate check is split into two contracts. Paired replay streams identical in everything but the source rate, with the same arrival wall times, the same playback ms per burst, the same lead and delay, give the same lag within floating-point error. Each start's true lag, across the captured starts, holds within the resolution the stream's own paints and arrivals allow, a tolerance computed from that stream's timing and never a round figure. The replays paint at 60 Hz. The heard clock stays the stamps' settled line less the output delay; the owner's ears are the check on that assumption, not a test. Built in Task 2; its result is section 3.

D-13, decided 2026-11-16 (`.planning/phases/7/CONTEXT.md`, commit `00fb1452`), amending D-12 (2): the page time-stamps each metering event the moment it arrives, so the playhead reads each arrival's own wall time, not the paint that first sees it. The resolution a stream allows carries no paint term: it is the arrival grain plus the stream's jitter, and that one computed tolerance holds for every comparison between two starts, at the same rate or at different rates; the one-metering-frame tolerance for same-rate comparisons is retired. The 17.667 ms figure came from the proposed rule reading arrivals at paints, and a tolerance derived from the design's own limit is a fudge. Built in Task 3: the replay hands each event over at its own wall time, the resolution is 1.0 ms on the captured streams and 81.0 ms on the made-up ones, and sections 2 to 6 of this record read each lead off its arrival's own stamp.

The approval of the spec text in section 6: pending. To be filled with the owner's approval, or the owner's changes and the re-approved text, character for character.

## Appendix: every failing case of the run, cited by its exact test name

The run is the one after Task 3 (log `/tmp/gate-node-MU4SUoqe.log`, 156 names). Of the 120 names of Task 2's run, 11 are green after Task 3 (made-up same-rate comparisons whose tolerance rose to 81.0 ms) and 47 are red that were green (captured-stream comparisons whose tolerance fell to 1.0 ms); section 3 has the reading. The groups are by what fails, from the reading in section 1, and each case sits in the first group its name fits.

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

Group B-other, 32 cases, property 1 (the anchor takes what the first paint finds), comparing two starts of one stream. The comparisons across a rate change are among them, and the paired check of section 3 shows the rate is not their cause.

- test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_16_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_17_a_rate_change_44100_to_96000_in_capture_2_shape_held_reader
- test_the_lag_after_serial_14_a_start_from_stopped_at_96000_is_the_lag_after_serial_18_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_15_a_same_rate_change_at_96000_is_the_lag_after_serial_16_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_15_a_same_rate_change_at_96000_is_the_lag_after_serial_17_a_rate_change_44100_to_96000_in_capture_2_shape_held_reader
- test_the_lag_after_serial_15_a_same_rate_change_at_96000_is_the_lag_after_serial_18_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_16_a_rate_change_96000_to_44100_is_the_lag_after_serial_17_a_rate_change_44100_to_96000_in_capture_2_shape_held_reader
- test_the_lag_after_serial_16_a_rate_change_96000_to_44100_is_the_lag_after_serial_18_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_17_a_rate_change_44100_to_96000_is_the_lag_after_serial_18_a_rate_change_96000_to_44100_in_capture_2_shape_held_reader
- test_the_lag_after_serial_1_a_start_from_stopped_at_44100_is_the_lag_after_serial_3_a_rate_change_44100_to_96000_in_made_up_bursty_held_reader
- test_the_lag_after_serial_20_a_start_from_stopped_at_192000_is_the_lag_after_serial_21_a_rate_change_192000_to_44100_in_capture_3_shape_held_reader
- test_the_lag_after_serial_20_a_start_from_stopped_at_192000_is_the_lag_after_serial_22_a_rate_change_44100_to_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_20_a_start_from_stopped_at_192000_is_the_lag_after_serial_23_a_same_rate_change_at_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_21_a_rate_change_192000_to_44100_is_the_lag_after_serial_22_a_rate_change_44100_to_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_21_a_rate_change_192000_to_44100_is_the_lag_after_serial_23_a_same_rate_change_at_192000_in_capture_3_shape_held_reader
- test_the_lag_after_serial_2_a_same_rate_change_at_44100_is_the_lag_after_serial_3_a_rate_change_44100_to_96000_in_made_up_bursty_held_reader
- test_the_lag_after_serial_31_a_start_from_stopped_at_44100_is_the_lag_after_serial_33_a_rate_change_44100_to_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_31_a_start_from_stopped_at_44100_is_the_lag_after_serial_34_a_same_rate_change_at_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_31_a_start_from_stopped_at_44100_is_the_lag_after_serial_35_a_rate_change_96000_to_44100_in_capture_1_shape_held_reader
- test_the_lag_after_serial_32_a_same_rate_change_at_44100_is_the_lag_after_serial_33_a_rate_change_44100_to_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_32_a_same_rate_change_at_44100_is_the_lag_after_serial_34_a_same_rate_change_at_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_32_a_same_rate_change_at_44100_is_the_lag_after_serial_35_a_rate_change_96000_to_44100_in_capture_1_shape_held_reader
- test_the_lag_after_serial_33_a_rate_change_44100_to_96000_is_the_lag_after_serial_34_a_same_rate_change_at_96000_in_capture_1_shape_held_reader
- test_the_lag_after_serial_34_a_same_rate_change_at_96000_is_the_lag_after_serial_35_a_rate_change_96000_to_44100_in_capture_1_shape_held_reader
- test_the_lag_is_the_same_across_the_change_192000_to_44100_at_serial_21_in_capture_3_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_192000_at_serial_22_in_capture_3_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_96000_at_serial_17_in_capture_2_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_96000_at_serial_33_in_capture_1_shape_held_reader
- test_the_lag_is_the_same_across_the_change_44100_to_96000_at_serial_3_in_made_up_bursty_held_reader
- test_the_lag_is_the_same_across_the_change_96000_to_44100_at_serial_16_in_capture_2_shape_held_reader
- test_the_lag_is_the_same_across_the_change_96000_to_44100_at_serial_18_in_capture_2_shape_held_reader
- test_the_lag_is_the_same_across_the_change_96000_to_44100_at_serial_35_in_capture_1_shape_held_reader

Group C, 96 cases, property 1 for a page that joins at a different point.

- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_31
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_32
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_34
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_36
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_14
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_16
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_17
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_18
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_2_shape_serial_19
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_20
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_400_ms_after_the_serial_change_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_3
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
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_a_page_joining_900_ms_after_the_serial_change_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_32
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_34
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_1_shape_serial_36
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_14
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_15
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_16
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_17
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_18
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_2_shape_serial_19
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_20
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_capture_3_shape_serial_23
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_made_up_bursty_serial_1
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_400_ms_after_the_serial_change_in_made_up_bursty_serial_3
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_31
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_32
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_34
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_capture_1_shape_serial_36
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
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_bursty_serial_3
- test_the_lag_is_the_same_for_the_reader_that_holds_and_a_page_joining_900_ms_after_the_serial_change_in_made_up_stamps_slower_serial_2
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1000_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_1900_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_1_shape_serial_33
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_1_shape_serial_35
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_21
- test_the_lag_is_the_same_for_the_reader_that_holds_and_the_apps_reader_rejoining_300_ms_after_Status_shows_playing_in_capture_3_shape_serial_22
