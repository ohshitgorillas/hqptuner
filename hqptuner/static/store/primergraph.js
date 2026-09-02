// The filter primer graph's state: the knobs the reader turns, the chip values
// each slider snaps to, the "Show me" rows that set the whole state at once,
// and the filter, readouts and spectrum designed from them
// (docs/plans/filter-primer-graph.md).
//
// Nothing here touches a field or the daemon. Every curve the graph draws is
// textbook FIR design from lib/dsp/fir.js on the standard interpolate, filter,
// decimate chain; no HQPlayer filter is plotted or approximated.
import { computed, signal } from "@preact/signals";
import {
  designLowpass,
  foldSpectrumDb,
  gaussianPulse,
  kaiserAttenuation,
  magnitudeDb,
  minimumPhase,
  ringing,
  sourceSpectrumDb,
} from "../lib/dsp/fir.js";

/** Length chips, in milliseconds of filter. */
export const LENGTH_CHIPS = { short: 0.5, medium: 2, long: 8 };
/** Roll-off chips, 0 the slow end (a wide band straddling Nyquist), 1 the fast end (a narrow band ending at Nyquist). */
export const ROLLOFF_CHIPS = { slow: 0, medium: 0.5, fast: 1 };
/** Transient chips, the pulse sigma in microseconds. */
export const TRANSIENT_CHIPS = { click: 20, snap: 100, thud: 500 };

/** Source rates the graph offers, in Hz. */
export const RATES = [44100, 96000, 192000];
/** Oversampling factors the output rate segment offers, over the source's family base; 8x on 48 is the 384 kHz ceiling. */
export const FACTORS = [2, 4, 8];

// The transition band as a fraction of the cutoff Nyquist at each end of the
// roll-off slider; the band narrows and slides up to end at Nyquist as the
// slider moves toward fast.
const WIDTH_SLOW = 0.5;
const WIDTH_FAST = 0.05;
/** Points on the frequency grid the spectrum is computed on. */
const FREQ_POINTS = 1024;

/**
 * @typedef {{ spurs: boolean, fakeHires: boolean, risingNoise: boolean }} Content
 * @typedef {{ rate: number, outputRate: number | null, phase: string, lengthMs: number, rolloff: number,
 *             transientUs: number, content: Content }} Row
 */

const QUIET = { spurs: false, fakeHires: false, risingNoise: false };

/**
 * The base of a source rate's family: 44.1 for 44.1, 48 for 96 and 192.
 * @param {number} hz
 * @returns {number}
 */
export const familyBase = (hz) => (hz % 44100 === 0 ? 44100 : 48000);

/** @type {Record<string, Row>} */
const SHOW_ME = {
  intro: {
    rate: 44100,
    outputRate: 4 * 44100,
    phase: "linear",
    lengthMs: LENGTH_CHIPS.medium,
    rolloff: ROLLOFF_CHIPS.medium,
    transientUs: TRANSIENT_CHIPS.snap,
    content: QUIET,
  },
  "phase-length": {
    rate: 44100,
    outputRate: 4 * 44100,
    phase: "linear",
    lengthMs: LENGTH_CHIPS.long,
    rolloff: ROLLOFF_CHIPS.medium,
    transientUs: TRANSIENT_CHIPS.click,
    content: QUIET,
  },
  "roll-off": {
    rate: 96000,
    outputRate: 2 * 48000,
    phase: "linear",
    lengthMs: LENGTH_CHIPS.medium,
    rolloff: ROLLOFF_CHIPS.fast,
    transientUs: TRANSIENT_CHIPS.snap,
    content: { ...QUIET, risingNoise: true },
  },
};

export const rate = signal(SHOW_ME.intro.rate);
/** Output rate in Hz, or null for no oversampling: no filter, output equals input. */
export const outputRate = signal(SHOW_ME.intro.outputRate);
export const phase = signal(SHOW_ME.intro.phase);
export const lengthMs = signal(SHOW_ME.intro.lengthMs);
export const rolloff = signal(SHOW_ME.intro.rolloff);
export const transientUs = signal(SHOW_ME.intro.transientUs);
export const content = signal(SHOW_ME.intro.content);

/**
 * Set the whole graph to the state a prose section describes.
 * @param {string} id
 * @returns {void}
 */
export function showMe(id) {
  const r = SHOW_ME[id] || SHOW_ME.intro;
  rate.value = r.rate;
  outputRate.value = r.outputRate;
  phase.value = r.phase;
  lengthMs.value = r.lengthMs;
  rolloff.value = r.rolloff;
  transientUs.value = r.transientUs;
  content.value = { ...r.content };
}

/**
 * Change the source rate, keeping the output rate at the same factor over the
 * new rate's family base (4x of 44.1 becomes 4x of 48).
 * @param {number} hz
 * @returns {void}
 */
export function setRate(hz) {
  const out = outputRate.value;
  const factor = out === null ? null : Math.round(out / familyBase(rate.value));
  rate.value = hz;
  outputRate.value = factor === null ? null : factor * familyBase(hz);
}

/** Top of the frequency axis: the larger of twice the source rate and the output rate. */
export const axisHz = computed(() => Math.max(2 * rate.value, outputRate.value ?? 0));

/**
 * The oversampling filter the state describes, on the interpolate, filter,
 * decimate chain: designed at the larger of source and output rate, cutting at
 * half the smaller; taps = ms x design rate forced odd; cutoff at the centre of
 * a transition band that straddles Nyquist at the slow end and ends at it at
 * the fast end. Minimum phase is the same magnitude, converted. No
 * oversampling is no filter: a single unit tap at the source rate.
 */
export const design = computed(() => {
  const fs = rate.value;
  const out = outputRate.value;
  if (out === null) return { designRate: fs, taps: 1, cutoffHz: fs / 2, widthHz: 0, h: Float64Array.of(1) };
  const designRate = Math.max(fs, out);
  const nyquist = Math.min(fs, out) / 2;
  const widthHz = (WIDTH_SLOW + (WIDTH_FAST - WIDTH_SLOW) * rolloff.value) * nyquist;
  const cutoffHz = nyquist - (rolloff.value * widthHz) / 2;
  const taps = Math.max(3, Math.round((lengthMs.value / 1000) * designRate)) | 1;
  const linear = designLowpass({ rate: designRate, taps, cutoffHz, widthHz });
  const h = phase.value === "minimum" ? minimumPhase(linear) : linear;
  return { designRate, taps, cutoffHz, widthHz, h };
});

/** The transient as a pulse at the design rate. */
export const pulse = computed(() => gaussianPulse((transientUs.value / 1e6) * design.value.designRate));

/**
 * The readout row: output kHz, taps, length ms, transition band kHz,
 * attenuation dB, ring before and after dB. Null where a value does not
 * apply: everything but output under no oversampling, ring before under
 * minimum phase.
 */
export const readouts = computed(() => {
  const { designRate, taps, widthHz, h } = design.value;
  const out = outputRate.value;
  const outputKhz = out === null ? null : out / 1000;
  if (out === null) {
    return {
      outputKhz,
      taps: null,
      lengthMs: null,
      transitionKhz: null,
      attenuationDb: null,
      ringBeforeDb: null,
      ringAfterDb: null,
    };
  }
  const ring = ringing(h, pulse.value);
  return {
    outputKhz,
    taps,
    lengthMs: lengthMs.value,
    transitionKhz: widthHz / 1000,
    attenuationDb: kaiserAttenuation(taps, widthHz, designRate),
    ringBeforeDb: phase.value === "minimum" ? null : ring.beforeDb,
    ringAfterDb: ring.afterDb,
  };
});

/**
 * The frequency pane's curves on a uniform grid from 0 to the axis top: the
 * source and its images (periodic in the source rate), the filter (periodic in
 * the design rate), and the output stream, their product folded into the
 * output rate.
 */
export const spectrum = computed(() => {
  const fs = rate.value;
  const top = axisHz.value;
  const { designRate, h } = design.value;
  /** @type {number[]} */
  const freqsHz = Array.from({ length: FREQ_POINTS }, (_, i) => (i / (FREQ_POINTS - 1)) * top);
  // Every image of the source is the source folded about a multiple of Nyquist.
  const folded = freqsHz.map((f) => {
    const m = f % fs;
    return m > fs / 2 ? fs - m : m;
  });
  const sourceDb = sourceSpectrumDb(fs, folded, content.value);
  const filterDb = magnitudeDb(h, designRate, freqsHz);
  const product = sourceDb.map((v, i) => v + filterDb[i]);
  const resultDb = foldSpectrumDb(product, freqsHz, designRate, outputRate.value ?? fs);
  return { freqsHz, sourceDb, filterDb, resultDb };
});
