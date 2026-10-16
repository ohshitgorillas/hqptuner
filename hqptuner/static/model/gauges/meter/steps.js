// Every animation step of the Source meter page, free of the DOM and of any clock: the level meter's ballistics, the
// spectrum's approach to new levels, the bars' peak caps, the aurora bands' gravity, the ridge rows and the Fade halo.
// Each step is handed `dt`, the wall time in seconds since the last paint, and moves its state as far over a stretch of
// time whether the stretch comes as one paint or as many. A hold is counted in the `dt` the steps were handed. A step
// writes the state it is handed in place and hands it back, so it allocates nothing; each state has a fresh form, and a
// caller starts from it again after a break in playback or a change of size.
//
// Ridges, and any other style that moves in whole steps, take them at STEP_HZ through a pace: each paint takes the
// whole steps its `dt` owes and carries the part step on.

import { dbToPower, powerToDb } from "../../../lib/units.js";

const STEP_HZ = 30; // whole steps a second a stepped style takes, whatever the paint rate
const STEP_SLACK = 1e-9; // share of a step a paint's time may fall short by and still take it, for rounding in the sum

const PEAK_FALL_DBPS = 20; // a level peak's fall, dB/s
const RMS_TAU_S = 0.3; // a level RMS's integration time constant, s
const HOLD_S = 1.5; // a level's held peak stays put this long after it was last reached, s
const HOLD_FALL_DBPS = 10; // a released held peak's fall, dB/s

const FLOOR_DB = -300; // the lowest level the spectrum falls toward, dBFS
const SHOWN_TAU_S = 0.15; // the shown spectrum's fall time constant, s
const GHOST_TAU_S = 1; // the spectrum ghost's fall time constant, s

const CAP_HOLD_S = 0.5; // a peak cap stays put this long after its band last reached it, s
const CAP_GRAVITY = 4; // a released peak cap's acceleration, plot fractions/s²
const AURORA_GRAVITY = 2.5; // an aurora band's acceleration, plot fractions/s²

const RIDGE_ROWS = 12; // ridge rows kept, newest first
const RIDGE_EVERY = 6; // steps from one ridge row to the next

const HALO_TAU_S = 2; // the halo's glow falls to 1/e of what it was in this long, s

/**
 * The part step a stepped style carries from one paint to the next.
 *
 * @typedef {object} Pace
 * @property {number} owed  steps' worth of time carried to the next paint, under one once a paint has taken its steps
 */

/**
 * A pace after a break: it owes one step, so the first paint after it takes one whatever its `dt`.
 *
 * @returns {Pace}
 */
export function freshPace() {
  return { owed: 1 };
}

/**
 * The whole steps a paint `dt` seconds after the last takes: what `pace` owes plus STEP_HZ a second of `dt`, the part
 * step left over written back into `pace`. Over a stretch of time the steps summed are the same whatever paints the
 * stretch comes in, give or take the one part step still owed at its end. A long gap is owed every step it spans; a
 * style takes them at a cost that does not grow with their count.
 *
 * @param {Pace} pace  written in place
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @returns {number}  whole steps, at least 0
 */
export function stepPace(pace, dt) {
  const due = pace.owed + dt * STEP_HZ;
  const whole = Math.floor(due + STEP_SLACK);
  pace.owed = Math.max(0, due - whole);
  return whole;
}

/**
 * One channel's level reading.
 *
 * @typedef {object} LevelReading
 * @property {number} peak  ballistic peak, dBFS: rises at once, falls at a fixed rate
 * @property {number} rms   integrated RMS, dBFS
 * @property {number} hold  held peak, dBFS, never below `peak`
 * @property {number} held  wall time since `hold` was last reached, s, summed from the `dt` the steps were handed
 */

/**
 * Where one channel's level is heading this paint, as the playback the paint crossed reads.
 *
 * @typedef {object} LevelTarget
 * @property {number} peak  dBFS
 * @property {number} rms   dBFS
 */

/**
 * `channels` level readings with nothing heard: every level at -Infinity dBFS.
 *
 * @param {number} channels
 * @returns {LevelReading[]}
 */
export function freshLevels(channels) {
  return Array.from({ length: channels }, () => ({ peak: -Infinity, rms: -Infinity, hold: -Infinity, held: 0 }));
}

/**
 * One reading after `dt` seconds toward `t`, written in place.
 *
 * @param {LevelReading} v
 * @param {LevelTarget | undefined} t
 * @param {number} dt  s
 */
function stepLevel(v, t, dt) {
  const peakTo = t?.peak ?? -Infinity;
  const rmsTo = dbToPower(t?.rms ?? -Infinity);
  v.peak = peakTo >= v.peak ? peakTo : Math.max(peakTo, v.peak - PEAK_FALL_DBPS * dt);
  v.rms = powerToDb(rmsTo + (dbToPower(v.rms) - rmsTo) * Math.exp(-dt / RMS_TAU_S));
  if (v.peak >= v.hold) {
    v.hold = v.peak;
    v.held = 0;
    return;
  }
  const was = Math.max(0, v.held - HOLD_S);
  v.held += dt;
  v.hold = Math.max(v.peak, v.hold - HOLD_FALL_DBPS * (Math.max(0, v.held - HOLD_S) - was));
}

/**
 * The level readings after a paint `dt` seconds after the last, each toward its own channel's target: the peak rises
 * to a louder target at once and otherwise falls at a fixed rate, never below the target; the RMS integrates the
 * target's power with a fixed time constant; the held peak rises with the peak, stays put for a fixed time after it was
 * last reached, then falls at a fixed rate, never below the peak. A reading with no target falls toward silence.
 *
 * @param {LevelReading[]} levels  written in place
 * @param {ArrayLike<LevelTarget>} targets  one per reading
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @returns {LevelReading[]}  `levels`
 */
export function stepLevels(levels, targets, dt) {
  for (let i = 0; i < levels.length; i++) stepLevel(levels[i], targets[i], dt);
  return levels;
}

/**
 * The spectrum as shown, one entry per bin.
 *
 * @typedef {object} SpectrumState
 * @property {Float64Array} disp   shown level, dBFS
 * @property {Float64Array} ghost  the shown level's slower shadow, dBFS, never below `disp`
 */

/**
 * A spectrum of `bins` bins with nothing shown: every level at -Infinity dBFS, so the first paint shows its levels
 * outright.
 *
 * @param {number} bins
 * @returns {SpectrumState}
 */
export function freshSpectrum(bins) {
  return { disp: new Float64Array(bins).fill(-Infinity), ghost: new Float64Array(bins).fill(-Infinity) };
}

/**
 * `from` after `dt` toward `to`: at once where `to` is at or above it, else closing the gap by a fixed share per unit
 * time, so it never passes below `to`.
 *
 * @param {number} from  dBFS
 * @param {number} to    dBFS
 * @param {number} keep  share of the gap left after `dt`
 */
const fallToward = (from, to, keep) => (to >= from ? to : to + (from - to) * keep);

/**
 * The spectrum after a paint `dt` seconds after the last, each bin toward its new level: the shown level rises at once
 * and falls with a short time constant; the ghost rises at once and falls with a longer one, never below the shown
 * level. A bin with no level falls toward FLOOR_DB.
 *
 * @param {SpectrumState} state  written in place
 * @param {ArrayLike<number>} levels  this paint's bin levels, dBFS, one per bin
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @returns {SpectrumState}  `state`
 */
export function stepSpectrum(state, levels, dt) {
  const shown = Math.exp(-dt / SHOWN_TAU_S);
  const ghost = Math.exp(-dt / GHOST_TAU_S);
  const { disp, ghost: shade } = state;
  for (let i = 0; i < disp.length; i++) {
    const to = Math.max(FLOOR_DB, levels[i] ?? FLOOR_DB);
    disp[i] = fallToward(disp[i], to, shown);
    shade[i] = Math.max(disp[i], fallToward(shade[i], to, ghost));
  }
  return state;
}

/**
 * Peak caps, one per band.
 *
 * @typedef {object} CapState
 * @property {Float64Array} lvl   cap height, plot fraction
 * @property {Float64Array} held  wall time since the band last reached its cap, s, summed from the `dt` the steps were
 *   handed
 */

/**
 * `bands` peak caps on the floor.
 *
 * @param {number} bands
 * @returns {CapState}
 */
export function freshCaps(bands) {
  return { lvl: new Float64Array(bands), held: new Float64Array(bands) };
}

/**
 * The peak caps after a paint `dt` seconds after the last: a band at or above its cap lifts it and restarts its hold;
 * a cap stays put for a fixed time after its band last reached it, then falls from rest under a fixed acceleration,
 * never below its band.
 *
 * @param {CapState} state  written in place
 * @param {ArrayLike<number>} bands  plot fractions, one per cap
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @returns {CapState}  `state`
 */
export function stepCaps(state, bands, dt) {
  const { lvl, held } = state;
  for (let i = 0; i < lvl.length; i++) {
    const band = bands[i] ?? 0;
    if (band >= lvl[i]) {
      lvl[i] = band;
      held[i] = 0;
      continue;
    }
    const was = Math.max(0, held[i] - CAP_HOLD_S);
    held[i] += dt;
    const over = Math.max(0, held[i] - CAP_HOLD_S);
    lvl[i] = Math.max(band, lvl[i] - (CAP_GRAVITY / 2) * (over * over - was * was));
  }
  return state;
}

/**
 * Aurora bands, each falling under gravity.
 *
 * @typedef {object} GravityState
 * @property {Float64Array} lvl  band height, plot fraction
 * @property {Float64Array} v    fall speed, plot fractions/s
 */

/**
 * `bands` aurora bands on the floor at rest.
 *
 * @param {number} bands
 * @returns {GravityState}
 */
export function freshGravity(bands) {
  return { lvl: new Float64Array(bands), v: new Float64Array(bands) };
}

/**
 * The aurora bands after a paint `dt` seconds after the last: a band whose level is at or above it lifts it and stops
 * its fall; otherwise it falls under a fixed acceleration over the paint, and comes to rest on its level where it would
 * pass below it.
 *
 * @param {GravityState} state  written in place
 * @param {ArrayLike<number>} bands  plot fractions, one per band
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @returns {GravityState}  `state`
 */
export function stepGravity(state, bands, dt) {
  const { lvl, v } = state;
  for (let i = 0; i < lvl.length; i++) {
    const band = bands[i] ?? 0;
    const fallen = band >= lvl[i] ? band : lvl[i] - v[i] * dt - (AURORA_GRAVITY / 2) * dt * dt;
    if (fallen <= band) {
      lvl[i] = band;
      v[i] = 0;
      continue;
    }
    lvl[i] = fallen;
    v[i] += AURORA_GRAVITY * dt;
  }
  return state;
}

/**
 * Ridge rows in a ring of RIDGE_ROWS buffers, read newest first through ridgeRow.
 *
 * @typedef {object} RidgeState
 * @property {Float64Array[]} rows  the ring's buffers, plot fractions per column; its length is the most rows kept
 * @property {number} head   the ring index of the newest row
 * @property {number} count  rows kept, up to `rows.length`
 * @property {number} phase  whole steps taken since the last row, below RIDGE_EVERY
 * @property {Pace} pace     the part step carried to the next paint
 */

/**
 * Ridges `width` columns wide with no rows, due a row at the first paint.
 *
 * @param {number} width  columns
 * @returns {RidgeState}
 */
export function freshRidges(width) {
  return {
    rows: Array.from({ length: RIDGE_ROWS }, () => new Float64Array(width)),
    head: RIDGE_ROWS - 1,
    count: 0,
    phase: 0,
    pace: freshPace(),
  };
}

/**
 * The ridges after a paint `dt` seconds after the last: the whole steps the paint owes at STEP_HZ, a copy of `row`
 * going first every RIDGE_EVERY steps, the oldest past the ring's length dropping off. However many rows the steps
 * owe, a paint copies at most the ring's length of them, so a long gap costs no more than a full ring. A row wider than
 * the ridges is cut to their width; a narrower one leaves the columns past it at 0.
 *
 * @param {RidgeState} state  written in place
 * @param {ArrayLike<number>} row  plot fractions per column
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @returns {RidgeState}  `state`
 */
export function stepRidges(state, row, dt) {
  const steps = stepPace(state.pace, dt);
  const rows = Math.ceil((state.phase + steps) / RIDGE_EVERY) - Math.ceil(state.phase / RIDGE_EVERY);
  state.phase = (state.phase + steps) % RIDGE_EVERY;
  const ring = state.rows.length;
  for (let r = Math.min(rows, ring); r > 0; r--) {
    state.head = (state.head + 1) % ring;
    const buf = state.rows[state.head];
    for (let c = 0; c < buf.length; c++) buf[c] = row[c] ?? 0;
  }
  state.count = Math.min(ring, state.count + rows);
  return state;
}

/**
 * Ridge row `k`, 0 the newest, as the ring holds it: valid for `k` below `state.count`, and overwritten by a later
 * step.
 *
 * @param {RidgeState} state
 * @param {number} k
 * @returns {Float64Array}  plot fractions per column
 */
export function ridgeRow(state, k) {
  const ring = state.rows.length;
  return state.rows[(state.head - k + ring) % ring];
}

/**
 * The Fade halo on the canvas, as one paint is to draw it.
 *
 * @typedef {object} HaloState
 * @property {boolean} drawn  whether a halo is on the canvas from an earlier paint
 * @property {boolean} clear  whether this paint draws its halo on a clear canvas, with nothing of an earlier one kept
 * @property {number} dim     share of the earlier halo's strength this paint takes away, 0 to 1; 0 where `clear`
 */

/**
 * The halo after a break: nothing on the canvas.
 *
 * @returns {HaloState}
 */
export function freshHalo() {
  return { drawn: false, clear: true, dim: 0 };
}

/**
 * The halo for a paint `dt` seconds after the last: with a halo already drawn, the share of its strength to take away
 * so that a spot dimmed paint by paint falls by e every HALO_TAU_S, whatever the paint rate; with none, a clear canvas.
 * Either way the paint draws a halo, so the next one dims it.
 *
 * @param {HaloState} state  written in place
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @returns {HaloState}  `state`
 */
export function stepHalo(state, dt) {
  state.clear = !state.drawn;
  state.dim = state.drawn ? 1 - Math.exp(-dt / HALO_TAU_S) : 0;
  state.drawn = true;
  return state;
}
