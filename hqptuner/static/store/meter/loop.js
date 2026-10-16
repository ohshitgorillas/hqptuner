// The meters' animation loop: thirty times a second it lays the feed frames that arrived since its last step
// (store/meter/feed.js) on its own timeline of playback time (model/gauges/timeline.js) and moves its playhead along it,
// the engine's reported output delay plus the user's offset behind the feed (model/gauges/pace.js), since the daemon
// sends them in clumps. Each step folds the playback the playhead crossed since the step before, each frame weighted by
// how much of it was crossed, so every step shows the same span of playback; steps the level bars and the VU needles
// toward that reading on the real time elapsed, the needles against the VU reference preference
// (model/gauges/meter/vu.js); steps the spectrum toward it smoothed across frequency, rising at once and settling as it
// falls; keeps the reading's columns as they came beside it; adds each frame the playhead passes or skips to the
// spectrogram's history once; and hands the scene to every registered painter with the same real time elapsed, so a
// painter that animates steps on it too.
//
// The loop runs on the Clock it is started with (lib/clock.js), and requests animation frames only while a painter is
// registered, the feed is open and the engine plays. The loop going idle, or the feed's geometry changing, sends the
// frames still queued to the spectrogram and empties the scene, so a restart never falls from the last reading; going
// idle also hands the painters the empty scene, so the meters clear rather than hold the last reading. A change of
// frequency span starts the spectrum afresh from the new view's columns, so neither the trace nor its ghost carries the
// last view's frequencies.

import { batch, effect, signal } from "@preact/signals";
import { PLATFORM } from "../../lib/clock.js";
import {
  emptySpectrum,
  foldCrossed,
  frameDt,
  pickBins,
  smoothColumns,
  spanShare,
  stepLevel,
  stepSpectrum,
  traceColumns,
} from "../../model/gauges/meter/meter.js";
import { PLAYHEAD_IDLE, movePlayhead } from "../../model/gauges/pace.js";
import { TIMELINE_EMPTY, ahead, cross, extend } from "../../model/gauges/timeline.js";
import { restVu, stepVu } from "../../model/gauges/meter/vu.js";
import { engineStatus, PLAYING } from "../signals.js";
import { freqSpan } from "../faceplate/view.js";
import { meterChannel, vuReference } from "../ui/prefs.js";
import { effectiveDelay } from "./delay.js";
import { meterFeedOpen, meterGeometry, takeMeterFrames, toSpectrogram } from "./feed.js";

/** Spectrum columns the trace carries across the plot. */
const TRACE_COLS = 600;
/** The time between two steps, ms, and how early an animation frame may land and still step. */
const STEP_MS = 1000 / 30;
const SLACK_MS = 4;

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/** @typedef {import("../../model/gauges/meter/meter.js").LevelReading} LevelReading */
/** @typedef {import("../../model/gauges/meter/meter.js").SpectrumHold} SpectrumHold */
/** @typedef {import("../../model/gauges/pace.js").PlayheadState} PlayheadState */
/** @typedef {import("../../model/gauges/timeline.js").Timeline} Timeline */
/** @typedef {import("../../model/gauges/meter/vu.js").VuState} VuState */
/**
 * One step's scene: the level bars, the VU readings per channel, the smoothed trace as shown, and the held target's
 * trace columns before that smoothing and its fall, dBFS.
 *
 * @typedef {{ levels: LevelReading[], vu: number[], spectrum: SpectrumHold | null, raw: Float32Array | null }} MeterScene
 */
/**
 * A painter, handed each step's scene and the seconds the step ran its ballistics for, as frameDt clamps them; the
 * empty scene the loop hands on going idle runs for none.
 *
 * @typedef {(scene: MeterScene, dt: number) => void} Painter
 */

/** @type {MeterScene} */
const EMPTY = { levels: [], vu: [], spectrum: null, raw: null };

/** @type {Set<Painter>} */
const painters = new Set();
const painterCount = signal(0);
/** @type {MeterScene} */
let scene = EMPTY;
/** @type {MeterFrame | null} */
let target = null;
/** The VU needles behind the scene's readings: at rest until the first step after the loop starts. */
/** @type {VuState} */
let needles = restVu(0);
/** @type {object | null} */
let geo = null;
/** @type {Timeline} */
let timeline = TIMELINE_EMPTY;
/** @type {PlayheadState} */
let playhead = PLAYHEAD_IDLE;
/** The trace columns of the current target in the picked channel at the frequency span, kept until any changes. */
/** @type {{ target: MeterFrame | null, pick: string, span: string, cols: Float32Array }} */
let columns = { target: null, pick: "", span: "", cols: new Float32Array(0) };
/** The frequency span the held spectrum was painted at: a step at another starts the spectrum afresh. */
let heldSpan = "";
/** @type {(() => void) | null} */
let stopper = null;

/**
 * Register a painter, called with the scene and the seconds since the last step once per step; hand back its unregister
 * function.
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
 * The trace columns for `t` in the picked channel, across frequency span `span`'s view.
 *
 * @param {MeterFrame} t
 * @param {string} span
 * @returns {Float32Array}
 */
function traceOf(t, span) {
  const pick = meterChannel.value;
  if (columns.target !== t || columns.pick !== pick || columns.span !== span) {
    columns = { target: t, pick, span, cols: traceColumns(pickBins(t, pick), TRACE_COLS, spanShare(span)) };
  }
  return columns.cols;
}

/** Send the frames on the timeline to the spectrogram and start the playhead again. */
function drain() {
  if (timeline.frames.length) toSpectrogram(timeline.frames);
  timeline = TIMELINE_EMPTY;
  playhead = PLAYHEAD_IDLE;
}

/**
 * The playback `ms` of real time moves the playhead across, the effective delay behind the feed, folded by the time
 * crossed of each frame; null when it crosses none. Every frame leaving the timeline reaches the spectrogram, the
 * skipped ones first.
 *
 * @param {number} ms
 * @returns {MeterFrame | null}
 */
function crossed(ms) {
  const line = extend(timeline, takeMeterFrames());
  const move = movePlayhead(playhead, ahead(line), { dt: ms, delay: effectiveDelay.peek() * 1000 });
  const skipped = cross(line, move.skip);
  const shown = cross(skipped.timeline, move.cross);
  playhead = move.state;
  timeline = shown.timeline;
  batch(() => toSpectrogram(skipped.passed.concat(shown.passed)));
  if (!shown.pieces.length) return null;
  return foldCrossed(shown.pieces);
}

/**
 * The spectrum one step moves to from `held` toward the trace columns `raw`, smoothed across frequency: a rise shows at
 * once and a fall settles toward the reading; with no `held` of the same length the trace lands on the reading outright.
 *
 * @param {SpectrumHold | null} held
 * @param {Float32Array} raw
 * @param {{ now: number, dt: number }} at  ms, s
 * @returns {SpectrumHold}
 */
function traceStep(held, raw, at) {
  const cols = smoothColumns(raw);
  const was = held && held.disp.length === cols.length ? held : null;
  return stepSpectrum(was || emptySpectrum(cols.length), cols, at, !was);
}

/** Send the queued frames to the spectrogram and empty the scene, its target and its VU needles. */
function idle() {
  target = null;
  scene = EMPTY;
  needles = restVu(0);
  drain();
}

/**
 * The scene one step stamped `now` moves to, `ms` after the last, its ballistics run for `dt`.
 *
 * @param {number} now  ms
 * @param {{ ms: number, dt: number }} step  ms, and s as frameDt clamps it
 * @returns {MeterScene}
 */
function advance(now, { ms, dt }) {
  const g = meterGeometry.peek();
  if (g !== geo) {
    geo = g;
    idle();
  }
  target = crossed(ms) ?? target;
  if (!target) return EMPTY;
  const prev = scene;
  const span = freqSpan.value;
  const held = span === heldSpan ? prev.spectrum : null;
  heldSpan = span;
  const raw = traceOf(target, span);
  const levels = target.channels.map((ch, i) => {
    const was = prev.levels[i];
    const t = { peak: ch.peak, rms: ch.rms };
    return was ? stepLevel(was, t, now, dt) : { peak: t.peak, rms: t.rms, hold: t.peak, holdAt: now };
  });
  const rms = target.channels.map((ch) => ch.rms);
  const was = needles.needles.length === rms.length ? needles : restVu(rms.length);
  needles = stepVu(was, rms, dt, Number(vuReference.value));
  return { levels, vu: needles.vu, spectrum: traceStep(held, raw, { now, dt }), raw };
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
      const dt = frameDt(prev, now);
      scene = advance(now, { ms: now - prev, dt });
      prev = now;
      painters.forEach((fn) => fn(scene, dt));
    }
    request();
  }
  /** @param {boolean} on */
  function run(on) {
    if (on === live) return;
    live = on;
    if (!on) {
      idle();
      painters.forEach((fn) => fn(EMPTY, 0));
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
