// The meters' animation loop: once per animation frame it folds the feed frames that arrived since the last one
// (store/meter/feed.js), steps the level bars toward them on the real time elapsed, shows the spectrum as the newest
// reading has it while its held peaks hold and decay, and hands the result to every registered painter. Between feed
// frames the bars keep integrating, so the meters move at the display's rate whatever rate the daemon serves.
//
// The loop runs on the Clock it is started with (lib/clock.js). Playback stopping, or the feed's geometry changing,
// empties the scene, so a restart never falls from the last track's reading.

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
import { engineStatus } from "../signals.js";
import { meterChannel } from "../ui/prefs.js";
import { meterGeometry, takeMeterFrames } from "./feed.js";

/** Spectrum columns the trace carries across the plot. */
const TRACE_COLS = 600;
const PLAYING = 2;

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../model/gauges/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../model/gauges/meter.js").LevelReading} LevelReading */
/** @typedef {import("../../model/gauges/meter.js").SpectrumHold} SpectrumHold */
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

/**
 * The scene one animation frame stamped `now` moves to, `dt` seconds after the last.
 *
 * @param {number} now  ms
 * @param {number} dt  s
 * @returns {MeterScene}
 */
function advance(now, dt) {
  const playing = Number(((engineStatus.peek() || {}).status || {}).state) === PLAYING;
  const g = meterGeometry.peek();
  if (!playing || g !== geo) {
    geo = g;
    target = null;
    scene = EMPTY;
  }
  if (!playing) return EMPTY;
  const frames = takeMeterFrames();
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
    scene = advance(now, frameDt(prev, now));
    prev = now;
    painters.forEach((fn) => fn(scene));
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
