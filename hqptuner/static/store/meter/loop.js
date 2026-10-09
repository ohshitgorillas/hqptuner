// The meters' animation loop: thirty times a second it takes the feed frames that arrived since its last step
// (store/meter/feed.js) into its own queue and paces them out on their frame time, the engine's reported output delay
// plus the user's offset behind the feed (model/gauges/pace.js), since the daemon sends them in clumps. Each step
// folds the frames handed out, steps the level bars toward them on the real time elapsed, eases the spectrum toward
// that reading smoothed across frequency while the ghost above it moves in the picked ghost style, keeps the reading's
// columns as they came beside it, adds the frames to the spectrogram's history, and hands the scene to every registered
// painter.
//
// The loop runs on the Clock it is started with (lib/clock.js), and requests animation frames only while a painter is
// registered, the feed is open and the engine plays. The loop going idle, or the feed's geometry changing, sends the
// frames still queued to the spectrogram and empties the scene, so a restart never falls from the last reading; going
// idle also hands the painters the empty scene, so the meters clear rather than hold the last reading.

import { batch, effect, signal } from "@preact/signals";
import { PLATFORM } from "../../lib/clock.js";
import {
  easeTrace,
  emptySpectrum,
  foldFrames,
  frameDt,
  pickBins,
  smoothColumns,
  stepLevel,
  stepSpectrum,
  traceColumns,
} from "../../model/gauges/meter.js";
import { PACE_IDLE, pace } from "../../model/gauges/pace.js";
import { engineStatus } from "../signals.js";
import { pageRange } from "../ui/faceplate.js";
import { meterChannel, spectrumGhost } from "../ui/prefs.js";
import { effectiveDelay } from "./delay.js";
import { meterFeedOpen, meterGeometry, takeMeterFrames, toSpectrogram } from "./feed.js";

/** Spectrum columns the trace carries across the plot. */
const TRACE_COLS = 600;
const PLAYING = 2;
/** The time between two steps, ms, and how early an animation frame may land and still step. */
export const STEP_MS = 1000 / 30;
const SLACK_MS = 4;

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../model/gauges/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../model/gauges/meter.js").LevelReading} LevelReading */
/** @typedef {import("../../model/gauges/meter.js").SpectrumHold} SpectrumHold */
/** @typedef {import("../../model/gauges/pace.js").PaceState} PaceState */
/**
 * One step's scene: the level bars, the eased and smoothed trace with its held peaks, and the held target's trace
 * columns before that smoothing and easing, dBFS.
 *
 * @typedef {{ levels: LevelReading[], spectrum: SpectrumHold | null, raw: Float32Array | null }} MeterScene
 */
/** @typedef {(scene: MeterScene) => void} Painter */

/** @type {MeterScene} */
const EMPTY = { levels: [], spectrum: null, raw: null };

/** @type {Set<Painter>} */
const painters = new Set();
const painterCount = signal(0);
/** @type {MeterScene} */
let scene = EMPTY;
/** @type {MeterFrame | null} */
let target = null;
/** @type {object | null} */
let geo = null;
/** @type {MeterFrame[]} */
let queue = [];
/** @type {PaceState} */
let paced = PACE_IDLE;
/** The trace columns of the current target in the picked channel, kept until either changes. */
/** @type {{ target: MeterFrame | null, pick: string, cols: Float32Array }} */
let columns = { target: null, pick: "", cols: new Float32Array(0) };
/** @type {(() => void) | null} */
let stopper = null;

/**
 * Register a painter, called with the scene once per animation frame; hand back its unregister function.
 *
 * @param {Painter} fn
 * @returns {() => void}
 */
export function onMeterPaint(fn) {
  painters.add(fn);
  painterCount.value = painters.size;
  return () => {
    painters.delete(fn);
    painterCount.value = painters.size;
  };
}

/**
 * The trace columns for `t` in the picked channel.
 *
 * @param {MeterFrame} t
 * @returns {Float32Array}
 */
function traceOf(t) {
  const pick = meterChannel.value;
  if (columns.target !== t || columns.pick !== pick) {
    columns = { target: t, pick, cols: traceColumns(pickBins(t, pick), TRACE_COLS) };
  }
  return columns.cols;
}

/** Send the queued frames to the spectrogram and start the pacing again. */
function drain() {
  if (queue.length) toSpectrogram(queue);
  queue = [];
  paced = PACE_IDLE;
}

/**
 * The frames `ms` of real time hands out, the effective delay behind; every frame leaving the queue reaches the
 * spectrogram, the dropped ones first.
 *
 * @param {number} ms
 * @returns {MeterFrame[]}
 */
function handOut(ms) {
  const step = pace(paced, queue.concat(takeMeterFrames()), { dt: ms, delay: effectiveDelay.peek() * 1000 });
  paced = step.state;
  queue = step.rest;
  batch(() => toSpectrogram(step.dropped.concat(step.out)));
  return step.out;
}

/**
 * The spectrum one step moves to from `held` toward `t`, smoothed across frequency; the trace eases toward each reading,
 * alike up and down, and the ghost above it moves in the ghost style picked at this step, on the page's Range.
 *
 * @param {SpectrumHold | null} held
 * @param {MeterFrame} t
 * @param {{ now: number, dt: number }} at  ms, s
 * @returns {SpectrumHold}
 */
function traceStep(held, t, at) {
  const cols = smoothColumns(traceOf(t));
  const was = held && held.disp.length === cols.length ? held : null;
  const shown = easeTrace(was && was.disp, cols, at.dt);
  const style = { ...at, ghost: spectrumGhost.value, range: Number(pageRange.value) };
  return stepSpectrum(was || emptySpectrum(cols.length), shown, style, true);
}

/** Send the queued frames to the spectrogram and empty the scene and its target. */
function idle() {
  target = null;
  scene = EMPTY;
  drain();
}

/**
 * The scene one step stamped `now` moves to, `ms` after the last.
 *
 * @param {number} now  ms
 * @param {number} ms
 * @returns {MeterScene}
 */
function advance(now, ms) {
  const dt = frameDt(now - ms, now);
  const g = meterGeometry.peek();
  if (g !== geo) {
    geo = g;
    idle();
  }
  const frames = handOut(ms);
  if (frames.length) target = foldFrames(frames);
  if (!target) return EMPTY;
  const prev = scene;
  const levels = target.channels.map((ch, i) => {
    const was = prev.levels[i];
    const t = { peak: ch.peak, rms: ch.rms };
    return was ? stepLevel(was, t, now, dt) : { peak: t.peak, rms: t.rms, hold: t.peak, holdAt: now };
  });
  return { levels, spectrum: traceStep(prev.spectrum, target, { now, dt }), raw: traceOf(target) };
}

/**
 * Start the loop on `clock`, once: it requests animation frames while a painter is registered, the feed is open and the
 * engine plays, and otherwise goes idle and hands the painters the empty scene. A second call starts nothing and hands
 * back the same stopper.
 *
 * @param {Clock} [clock]
 * @returns {() => void}
 */
export function startMeterLoop(clock = PLATFORM) {
  if (stopper) return stopper;
  let live = false;
  let requested = false;
  let prev = 0;
  function request() {
    requested = true;
    clock.requestAnimationFrame(tick);
  }
  /** @param {number} now */
  function tick(now) {
    requested = false;
    if (!live) return;
    if (now - prev >= STEP_MS - SLACK_MS) {
      scene = advance(now, now - prev);
      prev = now;
      painters.forEach((fn) => fn(scene));
    }
    request();
  }
  /** @param {boolean} on */
  function run(on) {
    if (on === live) return;
    live = on;
    if (!on) {
      idle();
      painters.forEach((fn) => fn(EMPTY));
      return;
    }
    prev = clock.now();
    if (!requested) request();
  }
  const dispose = effect(() => {
    const playing = Number(((engineStatus.value || {}).status || {}).state) === PLAYING;
    run(meterFeedOpen.value && painterCount.value > 0 && playing);
  });
  const stop = () => {
    dispose();
    run(false);
    stopper = null;
  };
  stopper = stop;
  return stop;
}
