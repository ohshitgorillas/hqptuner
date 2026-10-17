# Timing policy: binding for all contributors, human or agent

Violations are rejected in review even when every test passes. Tests of timing code are also bound by `docs/spec/testing.md`, rule 7 above all.

## Words

Each word below means one thing in this document, in code and in review.

| Word | Meaning |
|---|---|
| **Frame** | One metering frame from the daemon: `bins - 1` samples, the span `xform_time` measures. |
| **Stride** | The whole frames the feed folds into one event. |
| **Event** | One `frame` event on the feed: one stride, stamped with where it starts and how long it is. |
| **Slice** | The events one spectrogram column covers. |
| **Paint** | One run of the meter loop that draws. |
| **Step** | The animation advance a paint makes, by `dt`. |

## The two clocks

The program has two clocks and no third.

| Clock | What it says | Its only source | Unit |
|---|---|---|---|
| **Playback time** | Where the music is | The backend's stamp on each meter feed event: `at`, the sample the event starts at, and `n`, the samples it covers, both whole numbers counted from the daemon's frames at the metering rate the geometry event names. The feed store converts both to ms at that rate, once. | samples on the wire, ms from the feed store on |
| **Wall time** | How long something has waited | The injected clock: `lib/clock.js` `Clock` in the browser, `hqptuner/clock.py` `Clock` on `mgr.clock` on the server | ms in the browser, s on the server |

Playback time never measures waiting. Wall time never says where the music is.

Data that arrives on any other time base (Status's track position, an apodizing bin's position, a log line's timestamp) is converted to playback time once, at the one site where it arrives, by taking the playback stamp at the feed's edge at that moment. From there it is carried as playback time and nothing else. A value kept on a foreign time base and reconciled to playback time later is a third clock, and is a defect.

Every value that carries a time names its clock and its unit in its doc comment: `at: number // playback, ms`. A time with no clock named is a defect.

## Rules

1. **Positions come from stamps, never from sums.** The backend's stamping site is the only code that adds durations to make a position. Anywhere else, a running total of `ms` is a second clock: two totals of the same thing drift whenever one gains or loses an event the other did not. A slice, a playhead or an edge takes its position from the stamps of the events it holds.
2. **Durations come off the wire.** No frame length, rate, hop or stride is assumed. Each event's length is read from the event that carries it. The program's own timing constants are display targets, each defined once: `REFRESH_HZ` (`engine/meterfeed.py`), the shortest spectrogram slice, the animation step rate. None of them stands in for a measurement.
3. **A break is explicit.** The feed store tests every event in whole samples, before any conversion: an event whose `at` is not the previous event's `at + n` is a break. A reconnect, a dropped frame and a geometry change that dropped a partial stride all show up there. Every consumer of playback time restarts at a break: a history clears, a playhead starts again. Nothing smooths, slews or interpolates across one.
4. **One playhead.** The meters, the spectrogram's edge, the apodizing strip and every future view of playback read the one playhead the meter loop moves. No view keeps a position of its own.
5. **One pacing decision a paint, contiguous.** One pure function decides what playback a paint shows. Each paint shows the playback from where the last one ended: no gap, no overlap. Skip and catch-up rules live in that function and nowhere else.
6. **Decisions are pure; stores apply; components draw.** A timing decision lives in a function under `static/model/` whose return value is the decision (testing rule 17). A store holds state and applies the decision. A component or painter draws what it is handed and decides nothing about time.
7. **Animation steps on the loop's `dt`.** The meter loop hands every painter the wall time since the last paint. A style moves the same distance over the same stretch of time whatever the paint rate. There is one step rate, defined once under `static/model/`. `dt` is a required argument everywhere it is taken: a default `dt` hides a caller that forgot it.
8. **One loop, one clock seam.** The browser's only `requestAnimationFrame` is the meter loop's (`store/meter/loop.js`). Every browser timer and time read goes through a `Clock`; outside `lib/clock.js` no code names `setTimeout`, `setInterval`, `requestAnimationFrame`, `performance.now` or `Date.now`. On the server every wait goes through `mgr.clock` (testing rule 7).
9. **A late paint costs no more than an on-time one.** Work per paint is bounded and does not grow with lateness: a paint takes a bounded number of steps, allocates nothing per step, and allocates nothing in proportion to a queue or grid. The cost target is a Raspberry Pi with no GPU.
10. **Model code never reads a clock.** A pure function takes time as an argument. Only stores, the meter loop and the server's manager and lanes hold a clock.
11. **Timing tests assert invariants.** Every timing test runs on a clock the test controls, with fakes that answer from tables (testing rules 7 and 13). It asserts a property the design promises (contiguity, equal motion over equal time, a restart at a break), never a worked example of the arithmetic. Event lengths in a test span the measured range in the table below, and include a change of length in the middle of a feed.

## The meter pipeline

Each hop owns one decision. A diff that makes a decision outside its owner is rejected.

| Hop | Owns | Module |
|---|---|---|
| Daemon metering stream, `:4322` | Frames and `xform_time` | hqplayerd |
| Metering reader | Reading frames off the socket | `engine/metering.py` |
| Meter feed | The stride, and the `at`/`n` stamp, in samples, on every event | `engine/meterfeed.py` |
| Feed route | Transport over SSE, nothing else | `api/routes/meter.py` |
| Feed store | Decoding, queueing, detecting a break in samples, converting the stamp to ms | `store/meter/feed.js` |
| Playback model | What a paint shows, and where the playhead stands | `static/model/gauges/` |
| Meter loop | The one animation loop; applies the playback decision; hands the scene and `dt` to painters | `store/meter/loop.js` |
| Spectrogram history | Slices placed by their events' stamps; the edge taken from the playhead | `store/meter/spectrogram.js` |
| Apodizing strip | Bins stamped with playback time on arrival; the edge taken from the playhead | `store/apodhistory.js`, `store/faceplate/drawers/source.js` |
| Painters | Drawing what they are handed | `components/faceplate/` |

Because the daemon offers no way to ask for less, the socket is the only throttle a consumer has: at ~43 frames/s of `channels × (16 + 8 × xformLength)` bytes, an idle connection costs megabytes a second for frames nobody uses. The reader therefore holds the connection only while `State` reports playing (state 2) and the advisor is on or a METER page is attached, and closes it otherwise — invisible on loopback, but the difference between constant load and none once the traffic crosses a Docker bridge.

## Measured facts

These are measurements, not assumptions. Code reads the wire rather than relying on them; tests use their range.

| Fact | Value | Measured by |
|---|---|---|
| Transform hop | 1024 samples (`bins` 1025) at every metering rate measured | `scripts/probes/probe_metering_stream.py capture`, header decode |
| Metering rate | Set by the daemon from the playback path, not the source rate: 44.1k for DSD64 played as DSD, 176.4k for DSD64 played as PCM at 705.6k, 48k seen on PCM | The same capture, `(bins - 1) / xform_time` |
| Feed event length | 17.3 to 23.2 ms; always shorter than a paint | `stride × xform_time` (`engine/meterfeed.py`); 21.333 ms read off `/api/meter/feed` |
| Feed arrival | In bursts of 5 events, bursts up to 262 ms apart | Arrival times read off `/api/meter/feed` |

## Checklists

**Adding a visualization style.**

- Its state steps in a pure model function that takes `dt`, and moves as far over a stretch of time whatever the paint rate.
- Its painter draws that state and nothing else.
- Its per-paint cost is bounded and allocation-free.
- It joins the all-styles behavior tests, and gets no test the other styles lack.

**Adding a value that carries a time.**

- Name its clock and unit in its doc comment.
- Take it from a stamp, the playhead or a `Clock`, never from a running sum.
- If it arrives on a foreign time base, convert it to playback time where it arrives.

**Adding a wait, poll, retry or deadline.**

- Server: `mgr.clock.sleep`, `wait`, `pace`, `spawn` or `wait_for`, as `hqptuner/clock.py` defines them.
- Browser: a `Clock` passed in, `PLATFORM` by default.
- Its test counts passes on a virtual clock, never seconds.

## Examples

A position recovered by summing, and the same position from stamps:

```js
// Rejected: a second clock. Loses time whenever an event reaches one total and not the other.
h.end += h.frameMs;

// Holds: the slice ends where its last event's playback ends.
slice.end = last.at + last.ms;
```

A default `dt`, and a required one:

```js
// Rejected: a caller that forgets dt animates at the paint rate and nothing notices.
const paint = (spectrum, range, style, { dt = DT } = {}) => {};

// Holds: every caller states the time it is painting for.
const paint = (spectrum, range, style, { dt }) => {};
```

An assumed event length, and the wire's:

```js
// Rejected: true at one metering rate.
const FRAME_MS = 21.333;

// Holds: each event carries its own.
const covered = events.reduce((sum, e) => sum + e.ms, 0);
```

One clock rebuilt from another's leftovers, and the one source read directly:

```js
// Rejected: the playhead's position worked out from what the history happens to hold.
playhead.value = fine.end + fine.frameMs + head;

// Holds: the playhead reports its own position.
playhead.value = move.at;
```

A timing test that restates the arithmetic, and one that asserts the invariant. Shape only, not values to copy:

```js
// Rejected: the expected value is the implementation's own weighted mean.
assert.equal(scene.levels[0].peak, -16.6);

// Holds: each paint starts where the last one ended.
assert.equal(second.from, first.to);
```

## Enforcement

- A gate refuses a bare `setTimeout`, `setInterval`, `requestAnimationFrame`, `performance.now` or `Date.now` under `hqptuner/static/` outside `lib/clock.js` and `vendor/`.
- Review checks every timing diff against the pipeline table: one owner per decision.
- Exemptions are owner-approved, site by site, as for every gate.
