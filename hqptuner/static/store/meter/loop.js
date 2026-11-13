// The meter loop: the browser's one requestAnimationFrame, taken from the Clock
// initMeterLoop() is handed. It runs while the meter feed is open (store/meter/feed.js) and the engine is playing
// (enginePlaying, store/signals.js), whether or not a painter is subscribed, and stops when either stops holding.
//
// Each paint moves the frames the feed queued since the last paint onto the loop's own queue, handing each to the
// spectrogram's history as it does, in arrival order and once: no later than any paint shows it, and a frame a restart
// leaves behind goes before the break frame that restarts. It then asks the one pacing decision
// (model/gauges/playhead.js) what the paint shows, from where the last paint ended, the queue, whether the queue's front
// frame was queued when the last paint decided, and the effective delay in playback ms; and applies it: the playhead
// signal (store/meter/playhead.js) becomes the decision's playhead, the frames it consumed leave the queue, and its `to`
// is where the next paint starts. A decision that restarts at a break carries `restart` out, so every view of playback
// starts again there; nothing is smoothed across one. The decision is also handed where the playhead stood, the delay
// the last paint ran at and the wall time since the last paint, in ms.
//
// The playhead moves at wall speed, on the loop's `dt`, and jumps by a changed delay; it never passes the newest queued
// frame's end. The loop reads wall time for one thing, the time since the last paint, handed to the decision and kept
// for the painters as `dt`. A paint takes one decision whatever its lateness,
// and drops consumed frames in place, so its work and its allocations do not grow with how late it is.
//
// The painters' side: before the consumed frames leave the queue, the paint folds the frames its
// decision shows, `[first, last)`, into the one scene the loop fills in place (MeterScene), the meters' peak and RMS from
// all of them and the spectrum's bins from the decision's lead frame alone, then hands every painter
// subscribed through onMeterPaint that scene and `dt`, the wall time since the last paint in seconds, uncapped. A
// painter draws what it is handed and decides nothing about time.
//
// When the loop stops it holds no frames, the playhead is null, and every painter still subscribed is handed the scene
// once, restarted with nothing heard and `dt` 0, so the meters clear; no painter is called while it stays stopped. When
// it starts again it starts afresh: the first paint's `dt` is 0 and none of the idle time reaches a painter.
import { computed, effect } from "@preact/signals";
import { PLATFORM } from "../../lib/clock.js";
import { foldFrames } from "../../model/gauges/meter/meter.js";
import { pacePaint } from "../../model/gauges/playhead.js";
import { effectiveDelay } from "./delay.js";
import { meterFeedOpen, takeMeterFrames, toSpectrogram } from "./feed.js";
import { enginePlaying } from "../signals.js";
import { playhead } from "./playhead.js";

const MS_PER_S = 1000;

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../model/gauges/playhead.js").PaintDecision} PaintDecision */
/** @typedef {import("../../model/gauges/meter/meter.js").FoldScene} FoldScene */
/**
 * What one paint shows, as every painter is handed it: the frames the paint's decision shows folded the way the feed
 * folds a stride (foldFrames: per channel the loudest peak and the RMS power-averaged over each frame once, and the
 * bins of the one frame that covers most of the paint, whole, never an average of the frames the paint reached), and
 * `restart`, whether the paint started again at a break or at the first frame since the feed opened, so a painter
 * starts its own state again. A paint that shows no frame hands the scene as it stood; one that restarts and shows no
 * frame hands it with nothing heard, every peak, RMS and bin at -Infinity dBFS. It holds no channel until a paint has
 * shown a frame. The loop fills one scene in place paint to paint, and a fresh one only when the frames' channel or bin
 * count changes, so a painter reads it during its call and keeps nothing of it.
 *
 * @typedef {FoldScene & { restart: boolean }} MeterScene
 */
/**
 * A painter: handed each paint's scene and `dt`, wall time, s, since the paint before it, 0 on the first paint since
 * the feed opened.
 *
 * @typedef {(scene: MeterScene, dt: number) => void} MeterPainter
 */

/** @type {Clock} */
let clock = PLATFORM;
/**
 * The frames taken from the feed that no paint has consumed, oldest first, in a plain array changed in place.
 *
 * @type {MeterFrame[]}
 */
const queue = [];
/** Playback, ms: where the last paint ended, its decision's `to`; null when no paint has run since the feed opened. */
let end = /** @type {number | null} */ (null);
/** Whether the queue's front frame was queued when the last paint decided. */
let started = false;
/** Playback, ms: the delay the last paint ran at; null when no paint has run since the feed opened. */
let delayed = /** @type {number | null} */ (null);
/**
 * The last paint, as the painters read it: its decision, null when no paint has run since the feed opened, whose
 * `first` and `last` index `queue` as it stood before the decision's `consumed` frames left it; `at`, wall time, ms on
 * `clock`, when it ran, null when none has; and `dt`, wall time, ms, from the paint before it, 0 on the first paint
 * since the feed opened. Changed in place.
 *
 * @type {{ decision: PaintDecision | null, at: number | null, dt: number }}
 */
const painted = { decision: null, at: null, dt: 0 };
/** Counts each start and stop of the loop, so an animation frame requested before one is not painted after it. */
let run = 0;
/** @type {MeterScene} */
let scene = { channels: [], restart: false };
/**
 * The frames one paint shows, refilled in place each paint that shows any.
 *
 * @type {MeterFrame[]}
 */
const shown = [];
/**
 * The painters subscribed, oldest first, each in a record of its own so one subscription leaves without another.
 *
 * @type {Array<{ fn: MeterPainter }>}
 */
const painters = [];
/**
 * The painters subscribed when the paint now handing out its scene began, refilled in place each paint.
 *
 * @type {Array<{ fn: MeterPainter }>}
 */
const calling = [];

/** Set every peak, RMS and bin of the scene to nothing heard. */
function silence() {
  for (const ch of scene.channels) {
    ch.peak = -Infinity;
    ch.rms = -Infinity;
    ch.bins.fill(-Infinity);
  }
}

/** Drop every frame the loop holds and every decision it made, stand the playhead nowhere, and silence the scene. */
function reset() {
  queue.length = 0;
  end = null;
  started = false;
  delayed = null;
  painted.decision = null;
  painted.at = null;
  painted.dt = 0;
  playhead.value = null;
  silence();
  scene.restart = false;
}

/**
 * Fold the frames decision `d` shows into the scene, from nothing heard when it restarts; leave the scene as it
 * stood when it shows none. Reads `queue` before `d.consumed` frames leave it.
 *
 * @param {PaintDecision} d
 */
function show(d) {
  if (d.last > d.first) {
    shown.length = d.last - d.first;
    for (let i = d.first; i < d.last; i++) shown[i - d.first] = queue[i];
    scene = /** @type {MeterScene} */ (foldFrames(shown, scene, d.lead - d.first));
  } else if (d.restart) {
    silence();
  }
  scene.restart = d.restart;
}

/**
 * Hand the scene and `dt` to every painter subscribed when the paint began and still subscribed when its turn comes.
 *
 * @param {number} dt  wall time, s, since the last paint
 */
function hand(dt) {
  const n = painters.length;
  calling.length = n;
  for (let i = 0; i < n; i++) calling[i] = painters[i];
  for (let i = 0; i < n; i++) if (painters.includes(calling[i])) calling[i].fn(scene, dt);
}

/** Move the frames the feed queued since the last paint onto the queue, handing each to the spectrogram's history. */
function takeArrivals() {
  const arrived = takeMeterFrames();
  if (!arrived.length) return;
  toSpectrogram(arrived);
  for (const f of arrived) queue.push(f);
}

/**
 * Apply one decision: the playhead stands where it says, its consumed frames leave the queue, and its `to` is where the
 * next paint starts.
 *
 * @param {PaintDecision} d
 */
function apply(d) {
  const held = queue.length - d.consumed;
  queue.copyWithin(0, d.consumed);
  queue.length = held;
  started = held > 0;
  end = Number.isNaN(d.to) ? null : d.to;
  playhead.value = Number.isNaN(d.playhead) ? null : d.playhead;
  painted.decision = d;
}

/**
 * One paint of run `mine`, at wall time `now`, ms on `clock`; it asks for the next while the run is current.
 *
 * @param {number} mine
 * @param {number} now
 */
function paint(mine, now) {
  if (mine !== run) return;
  painted.dt = painted.at === null ? 0 : now - painted.at;
  painted.at = now;
  takeArrivals();
  const delay = effectiveDelay.peek() * MS_PER_S;
  const d = pacePaint({ end, playhead: playhead.peek(), delayed, started, frames: queue, delay, dt: painted.dt });
  delayed = delay;
  show(d);
  apply(d);
  request(mine);
  hand(painted.dt / MS_PER_S);
}

/**
 * Hand `fn` the scene and `dt` at every paint while the meter feed is open and the engine plays, from the first paint
 * that begins after this call, until the returned unsubscribe is called. When the loop stops, `fn` gets one clearing
 * call. A painter may subscribe or unsubscribe any painter during its own call: one unsubscribed before its turn in a
 * paint is not called in it.
 *
 * @param {MeterPainter} fn
 * @returns {() => void}  unsubscribe
 */
export function onMeterPaint(fn) {
  const sub = { fn };
  painters.push(sub);
  return () => {
    const i = painters.indexOf(sub);
    if (i >= 0) painters.splice(i, 1);
  };
}

/** @param {number} mine */
function request(mine) {
  clock.requestAnimationFrame((now) => paint(mine, now));
}

/** Whether the meter feed is open and the engine plays: the one condition the loop runs on. */
const running = computed(() => meterFeedOpen.value && enginePlaying.value);

/** @type {(() => void) | null} */
let dispose = null;

/**
 * Register once the effect that runs the loop while the meter feed is open and the engine plays and stops it when
 * either ends, and hand back its disposer. Stopping hands each painter one clearing call. Each start is afresh, holding
 * nothing from before.
 *
 * @param {Clock} [next] the clock whose animation frames the loop paints on
 * @returns {() => void}
 */
export function initMeterLoop(next = PLATFORM) {
  if (dispose) return dispose;
  clock = next;
  let was = false;
  const registered = effect(() => {
    const on = running.value;
    run += 1;
    reset();
    if (on) request(run);
    else if (was) {
      scene.restart = true;
      hand(0);
    }
    was = on;
  });
  dispose = registered;
  return registered;
}
