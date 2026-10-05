// The meters' animation loop: thirty times a second it takes the feed frames that arrived since its last step
// (store/meter/feed.js) into its own queue and paces them out on their frame time, the spectrum delay behind
// (model/gauges/pace.js), since the daemon sends them in clumps. Each step folds the frames handed out, steps the level
// bars toward them on the real time elapsed, shows the spectrum as that reading has it while its held peaks hold and
// decay, adds the frames to the spectrogram's history, and hands the scene to every registered painter.
//
// The loop runs on the Clock it is started with (lib/clock.js). Playback stopping, or the feed's geometry changing,
// sends the frames still queued to the spectrogram and empties the scene, so a restart never falls from the last
// track's reading.

import { batch } from "@preact/signals";
import { PLATFORM } from "../../lib/clock.js";
import {
  emptySpectrum,
  foldFrames,
  frameDt,
  pickBins,
  stepLevel,
  stepSpectrum,
  traceColumns,
} from "../../model/gauges/meter.js";
import { PACE_IDLE, pace } from "../../model/gauges/pace.js";
import { engineStatus } from "../signals.js";
import { meterChannel } from "../ui/prefs.js";
import { spectrumDelay } from "./delay.js";
import { meterGeometry, takeMeterFrames, toSpectrogram } from "./feed.js";

/** Spectrum columns the trace carries across the plot. */
const TRACE_COLS = 600;
const PLAYING = 2;
/** The time between two steps, ms, and how early an animation frame may land and still step. */
const STEP_MS = 1000 / 30;
const SLACK_MS = 4;

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../model/gauges/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../model/gauges/meter.js").LevelReading} LevelReading */
/** @typedef {import("../../model/gauges/meter.js").SpectrumHold} SpectrumHold */
/** @typedef {import("../../model/gauges/pace.js").PaceState} PaceState */
/** @typedef {{ levels: LevelReading[], spectrum: SpectrumHold | null }} MeterScene */
/** @typedef {(scene: MeterScene) => void} Painter */

/** @type {MeterScene} */
const EMPTY = { levels: [], spectrum: null };

/** @type {Set<Painter>} */
const painters = new Set();
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
  return () => {
    painters.delete(fn);
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
 * The frames `ms` of real time hands out, the spectrum delay behind; every frame leaving the queue reaches the
 * spectrogram, the dropped ones first.
 *
 * @param {number} ms
 * @returns {MeterFrame[]}
 */
function handOut(ms) {
  const step = pace(paced, queue.concat(takeMeterFrames()), { dt: ms, delay: spectrumDelay.peek() * 1000 });
  paced = step.state;
  queue = step.rest;
  batch(() => toSpectrogram(step.dropped.concat(step.out)));
  return step.out;
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
  const playing = Number(((engineStatus.peek() || {}).status || {}).state) === PLAYING;
  const g = meterGeometry.peek();
  if (!playing || g !== geo) {
    geo = g;
    target = null;
    scene = EMPTY;
    drain();
  }
  if (!playing) return EMPTY;
  const frames = handOut(ms);
  if (frames.length) target = foldFrames(frames);
  if (!target) return EMPTY;
  const prev = scene;
  const levels = target.channels.map((ch, i) => {
    const was = prev.levels[i];
    const t = { peak: ch.peak, rms: ch.rms };
    return was ? stepLevel(was, t, now, dt) : { peak: t.peak, rms: t.rms, hold: t.peak, holdAt: now };
  });
  const cols = traceOf(target);
  const held = prev.spectrum && prev.spectrum.disp.length === cols.length ? prev.spectrum : emptySpectrum(cols.length);
  // The trace lands on each reading outright; only the held peaks keep a memory.
  const spectrum = stepSpectrum(held, cols, { now, dt }, true);
  return { levels, spectrum };
}

/**
 * Start the loop on `clock`, once; a second call starts nothing and hands back the same stopper.
 *
 * @param {Clock} [clock]
 * @returns {() => void}
 */
export function startMeterLoop(clock = PLATFORM) {
  if (stopper) return stopper;
  let running = true;
  let prev = clock.now();
  /** @param {number} now */
  const tick = (now) => {
    if (!running) return;
    if (now - prev >= STEP_MS - SLACK_MS) {
      scene = advance(now, now - prev);
      prev = now;
      painters.forEach((fn) => fn(scene));
    }
    clock.requestAnimationFrame(tick);
  };
  clock.requestAnimationFrame(tick);
  const stop = () => {
    running = false;
    stopper = null;
  };
  stopper = stop;
  return stop;
}
