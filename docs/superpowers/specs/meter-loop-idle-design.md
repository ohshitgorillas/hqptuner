Status: approved.

## Why

The meter loop asks for an animation frame at every paint for as long as the meter feed is open (`hqptuner/static/store/meter/loop.js:180-190`, `:210-212`, `:224-235`). The feed stays open whenever metering is on (`hqptuner/static/store/meter/feed.js:218-223`, `hqptuner/static/store/actions.js:316`), playing or not, and the server sends no frames while the engine is not playing (`hqptuner/api/routes/meter.py:4`). So an idle tuner tab paints about 60 times a second with nothing to show.

The loop is the only writer of the playhead signal (`hqptuner/static/store/meter/loop.js:116`, `:170`), and the spectrogram's window and the apodizing strip's edge read that signal (`hqptuner/static/store/meter/spectrogram.js:185`, `:194`) whether or not any painter subscribes. Nothing on this branch subscribes a painter (`onMeterPaint` has no caller outside `loop.js` and its tests), so the loop runs while the engine plays with no painter subscribed.

The loop's gate needs "the engine is playing", and the tree holds that test in 10 copies, each spelled out from `engineStatus` and `PLAYING` (`hqptuner/static/store/signals.js:21`):

- on the `engineStatus` signal: `hqptuner/static/store/meter/feed.js:92`, `hqptuner/static/store/meter/feed.js:167` (peeked), `hqptuner/static/store/faceplate/path.js:34`, `hqptuner/static/store/faceplate/path.js:62-63`, `hqptuner/static/store/faceplate/drawers/source.js:82`, `hqptuner/static/store/health.js:270-271`;
- on a status frame already in hand: `hqptuner/static/store/health.js:110`, `hqptuner/static/store/health.js:189`, `hqptuner/static/store/faceplate/engine.js:39`, `hqptuner/static/store/apodhistory.js:117`.

## Modules

`hqptuner/static/store/signals.js` holds the one test of whether the engine plays. It replaces every copy listed under **Why**.

```js
// hqptuner/static/store/signals.js
/**
 * Whether a status frame (the `status` block of /api/status) says the engine is playing: its `state` is PLAYING.
 * A missing frame is not playing.
 *
 * @param {{ state?: number | string } | null | undefined} st
 * @returns {boolean}
 */
export function isPlaying(st) { throw new Error("stub"); }

/** Whether the engine is playing, as /api/status last reported it: isPlaying of engineStatus's `status` block. */
export const enginePlaying = computed(() => { throw new Error("stub"); });
```

`hqptuner/static/store/meter/loop.js` keeps its public interface; what changes is when it runs. The loop runs, asking for animation frames, only while both hold: the meter feed is open (`meterFeedOpen`) and the engine is playing (`enginePlaying`). Whether a painter is subscribed through `onMeterPaint` is not part of the condition: the loop runs and moves the playhead with no painter subscribed. When either stops holding, the loop stops: no frame it asked for paints, it drops every frame and decision it holds, the playhead goes to null, and every painter still subscribed is handed the scene once with `restart` true and nothing heard (every peak, RMS and bin at -Infinity dBFS) and `dt` 0, so the meters clear rather than hold the last reading. When both hold again, it starts afresh, as a reopened feed does now: the first paint's `dt` is 0 and none of the idle time reaches a painter. The effect starts or stops the loop only when the two-way condition changes; a status poll that leaves it unchanged touches nothing.

```js
// hqptuner/static/store/meter/loop.js (unchanged signatures)
/** @param {MeterPainter} fn @returns {() => void} unsubscribe */
export function onMeterPaint(fn) { throw new Error("stub"); }
/** @param {Clock} [next] @returns {() => void} */
export function initMeterLoop(next = PLATFORM) { throw new Error("stub"); }
```

Frames the loop does not take while it is stopped still reach the spectrogram's history through the feed, which already hands over the oldest past `MAX_PENDING_MS` and every queued frame when playback stops (`hqptuner/static/store/meter/feed.js:132-138`, `:171`).

## Homes

| Concern | Home | Forbidden elsewhere |
|---|---|---|
| Whether the engine is playing | `isPlaying` and `enginePlaying`, `hqptuner/static/store/signals.js` | Comparing a status `state` to `PLAYING` anywhere else; `PLAYING` is read only by `signals.js`. `PAUSED` stays exported for `transportNow`'s paused lamp (`hqptuner/static/store/faceplate/path.js:64`). |
| When the browser paints the meters | the run effect in `initMeterLoop`, `hqptuner/static/store/meter/loop.js` | Any other `requestAnimationFrame`, or a second gate on the loop, in any module (`docs/spec/timing.md:42`). |
| Animation frames in tests | `fakeClock`, `tests/js/support/clock.js:15` | A suite's own frame scheduler beyond wrapping `fakeClock`'s, as `tests/js/store/meter/loop-painters.test.js:77-88` does. |

## Order

1. **The playing test's home.** `test-writer` writes the red tests for `isPlaying` and `enginePlaying` in a new `tests/js/store/signals.test.js`; `builder` adds them to `hqptuner/static/store/signals.js` and moves every copy listed under **Why** onto them: `hqptuner/static/store/meter/feed.js`, `hqptuner/static/store/faceplate/path.js`, `hqptuner/static/store/faceplate/drawers/source.js`, `hqptuner/static/store/health.js`, `hqptuner/static/store/faceplate/engine.js`, `hqptuner/static/store/apodhistory.js`. Behavior is unchanged; the suites of those modules stay green as they stand.
2. **The loop runs only while the engine plays.** `test-writer` writes the red tests for the run gate and the clearing scene described under **Modules** in `tests/js/store/meter/loop.test.js`, `tests/js/store/meter/loop-painters.test.js` and `tests/js/store/meter/loop-boot.test.js`; `builder` changes `hqptuner/static/store/meter/loop.js` and its header comment to match.
