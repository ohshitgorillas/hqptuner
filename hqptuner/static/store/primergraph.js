// The filter primer graph's state: the knobs the reader turns, the chip values
// each slider snaps to, the named rows that set the whole state at once,
// and the filter, readouts and spectrum designed from them
// (docs/plans/filter-primer-graph.md).
//
// Nothing here touches a field or the daemon. Every curve the graph draws is
// textbook FIR design from lib/dsp (fir, pulse, spectrum) on the standard interpolate, filter,
// decimate chain; no HQPlayer filter is plotted or approximated.
import { computed, signal } from "@preact/signals";
import { designLowpass, designPoint, minimumPhase } from "../lib/dsp/fir.js";
import { filterPulse, gaussianPulse, ringing, upsampledPulse } from "../lib/dsp/pulse.js";
import {
  aliasSpectrumDb,
  foldSpectrumDb,
  groupDelaySamples,
  magnitudeDb,
  sourceSpectrumDb,
} from "../lib/dsp/spectrum.js";

/** Length chips, in milliseconds of filter. */
export const LENGTH_CHIPS = { short: 0.5, medium: 2, long: 8 };
/** Roll-off chips, 0 the slow end (a wide band straddling Nyquist), 1 the fast end (a narrow band ending at Nyquist). */
export const ROLLOFF_CHIPS = { slow: 0, medium: 0.5, fast: 1 };
/** Transient chips, the pulse sigma in microseconds; Thud rings below the plot floor, readout only. */
export const TRANSIENT_CHIPS = { click: 3, snap: 10, thud: 30 };

/** Source rates the graph offers, in Hz. */
export const RATES = [44100, 96000, 192000];
/** The output rate segment's no-conversion value: output is the source, no filter. */
export const NOS = "nos";
/** Slowest and fastest output rate the segment offers, in Hz. */
const FLOOR_HZ = 48000;
const CEIL_HZ = 384000;
/** Furthest the ladder is walked either way; three doublings covers every rate the graph offers. */
const MAX_STEP = 3;

// The transition band asked for, as a fraction of the cutoff Nyquist at each
// end of the roll-off slider, geometric between them; the band narrows and
// slides up to end at Nyquist as the slider moves toward fast. What the
// design then reaches is `designPoint`'s call: at the attenuation cap the
// band is narrower than asked.
const WIDTH_SLOW = 0.5;
const WIDTH_FAST = 0.03;
/** Points on the frequency grid the group delay is computed on. */
const FREQ_POINTS = 1024;
/** Points the spectrum grid spends on each sidelobe of the filter's comb. */
const POINTS_PER_LOBE = 4;
/**
 * Points the spectrum grid spends on each pixel the frequency pane draws in.
 * Lobe spacing alone fixes the density against the filter's length and not
 * against the window, so a long filter puts a hundred lobes in a column and
 * four points in a lobe, and the column keeps whichever of the four it was
 * handed. Sixteen a column is enough for the column's peak to be a peak.
 */
const POINTS_PER_PIXEL = 16;
/** Below this magnitude the group delay reading is blanked: a stop band arrives nowhere. */
const DELAY_MASK_DB = -60;

/**
 * @typedef {{ spurs: boolean, fakeHires: boolean, risingNoise: boolean }} Content
 * @typedef {{ rate: number, outputRate: number | null, phase: string, lengthMs: number, rolloff: number,
 *             transientUs: number, content: Content }} Row
 */

const QUIET = { spurs: false, fakeHires: false, risingNoise: false };

/**
 * Every factor is read against the source rate the reader picked, never against
 * the family base: 2x of 96 kHz is 192 kHz, and the same button at 44.1 kHz is
 * 88.2. A negative factor divides, so the segment carries the decimating end of
 * the chain as well, and the ladder is bounded at both ends: nothing slower than
 * 48 kHz and nothing past the 384 kHz ceiling.
 *
 * A factor's rank is where it sits on that ladder in doublings, 0 being no
 * conversion, so a rank survives a change of source rate even where the factor
 * itself is not offered at the new one.
 * @param {number | string} factor
 * @returns {number}
 */
const rankOf = (factor) => {
  if (factor === NOS) return 0;
  const f = Number(factor);
  return f > 0 ? Math.log2(f) : -Math.log2(-f);
};

/**
 * The factor at a rank on that ladder.
 * @param {number} k
 * @returns {number | string}
 */
const factorAtRank = (k) => (k === 0 ? NOS : k > 0 ? 2 ** k : -(2 ** -k));

/**
 * The output rate a factor produces at a source rate, or null for no conversion.
 * @param {number} hz
 * @param {number | string} factor
 * @returns {number | null}
 */
export function outputRateFor(hz, factor) {
  if (factor === NOS) return null;
  const f = Number(factor);
  return f > 0 ? hz * f : hz / -f;
}

/**
 * The factors the output rate segment offers at a source rate, ascending by the
 * rate they produce. No conversion is always offered; every other rung is in
 * only where the rate it produces sits inside the ladder's bounds.
 * @param {number} hz
 * @returns {(number | string)[]}
 */
export function outputFactors(hz) {
  /** @type {(number | string)[]} */
  const out = [];
  for (let k = -MAX_STEP; k <= MAX_STEP; k += 1) {
    const f = factorAtRank(k);
    const produced = outputRateFor(hz, f);
    if (produced === null || (produced >= FLOOR_HZ && produced <= CEIL_HZ)) out.push(f);
  }
  return out;
}

/**
 * The factor an output rate stands at over a source rate, as the segment reads it.
 * @param {number} hz
 * @param {number | null} out
 * @returns {number | string}
 */
export function outputFactorOf(hz, out) {
  if (out === null) return NOS;
  return out >= hz ? Math.round(out / hz) : -Math.round(hz / out);
}

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
    outputRate: 2 * 96000,
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

// Not a control: what the page measured. The impulse pane reduces its output to
// one column per rendered pixel, so the reduction needs a figure only the laid
// out page has. Zero means nothing has measured yet — the first paint, and any
// render with no layout behind it — and the pane falls back to its own drawing
// width there.
/** The impulse pane's plot rectangle in CSS pixels as the page renders it; 0 until the pane has measured itself. */
export const plotPx = signal(0);
/** The frequency pane's plot rectangle in CSS pixels as the page renders it; 0 until the pane has measured itself. */
export const freqPx = signal(0);

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
 * Change the source rate, holding the output rate at the same factor over the
 * new source rate: 2x of 192 kHz stays 2x at 44.1. Where the held factor is off
 * the new rate's ladder it lands on the nearest rung that rate offers.
 * @param {number} hz
 * @returns {void}
 */
export function setRate(hz) {
  const held = rankOf(outputFactorOf(rate.value, outputRate.value));
  const offered = outputFactors(hz);
  const lo = rankOf(offered[0]);
  const hi = rankOf(offered[offered.length - 1]);
  rate.value = hz;
  outputRate.value = outputRateFor(hz, factorAtRank(Math.min(hi, Math.max(lo, held))));
}

/**
 * No oversampling, or an output rate equal to the source (a ratio of one): the
 * chain is the identity, a single unit tap, and the panes draw no filter.
 */
export const noFilter = computed(() => outputRate.value === null || outputRate.value === rate.value);

/**
 * Top of the frequency axis: the Nyquist of the faster of the two streams,
 * which is as far as anything the chain carries reaches. Past it the filter
 * repeats its own passband and the fold repeats the result, neither of which
 * any stream holds (docs/plans/filter-primer-math.md section 6.4). Where the
 * chain is the identity there is no second stream, and the axis runs to twice
 * the source rate so the images the source would have keep their place.
 */
export const axisHz = computed(() =>
  noFilter.value ? 2 * rate.value : Math.max(rate.value, outputRate.value ?? rate.value) / 2,
);

/**
 * The linear-phase oversampling filter the state describes, on the
 * interpolate, filter, decimate chain: designed at the larger of source and
 * output rate, cutting at half the smaller; taps = ms x design rate forced
 * odd; cutoff at the centre of a transition band that straddles Nyquist at
 * the slow end and ends at it at the fast end. `widthHz` and `attenDb` are
 * the point the design reaches, not the band asked for. No oversampling, and
 * an output rate equal to the source, is no filter: a single unit tap at the
 * source rate.
 */
const linearDesign = computed(() => {
  const fs = rate.value;
  const out = outputRate.value;
  if (noFilter.value) {
    return { designRate: fs, taps: 1, cutoffHz: fs / 2, widthHz: 0, attenDb: 0, h: Float64Array.of(1) };
  }
  const designRate = Math.max(fs, out ?? fs);
  const nyquist = Math.min(fs, out ?? fs) / 2;
  const asked = WIDTH_SLOW * (WIDTH_FAST / WIDTH_SLOW) ** rolloff.value * nyquist;
  const taps = Math.max(3, Math.round((lengthMs.value / 1000) * designRate)) | 1;
  const { attenDb, widthHz } = designPoint(taps, asked, designRate);
  const cutoffHz = nyquist - (rolloff.value * widthHz) / 2;
  const h = designLowpass({ rate: designRate, taps, cutoffHz, widthHz: asked });
  return { designRate, taps, cutoffHz, widthHz, attenDb, h };
});

/** The same magnitude with minimum phase; the unit tap is its own conversion. */
const minimumTaps = computed(() => {
  const { taps, h } = linearDesign.value;
  return taps === 1 ? h : minimumPhase(h);
});

/** The filter the state describes, in the selected phase. */
export const design = computed(() => {
  const d = linearDesign.value;
  return { ...d, h: phase.value === "minimum" ? minimumTaps.value : d.h };
});

/**
 * The delay pane's curves on a uniform grid from 0 to the Nyquist of the
 * SLOWER of the two streams: the group delay of each phase in milliseconds,
 * blanked (NaN) where the filter magnitude is below the mask, so a stop band
 * draws nothing. Where the chain decimates, the band the source carries above
 * the output's Nyquist reaches no output sample and so has no arrival time to
 * plot; drawing to the source's own Nyquist there leaves the frame blank from
 * the filter's cliff to its right edge.
 */
export const delay = computed(() => {
  const out = outputRate.value;
  const nyquist = Math.min(rate.value, out ?? rate.value) / 2;
  const { designRate, h: linear } = linearDesign.value;
  /** @type {number[]} */
  const freqsHz = Array.from({ length: FREQ_POINTS }, (_, i) => (i / (FREQ_POINTS - 1)) * nyquist);
  const level = magnitudeDb(linear, designRate, freqsHz);
  const toMs = (/** @type {Float64Array} */ h) =>
    groupDelaySamples(h, designRate, freqsHz).map((s, i) => (level[i] < DELAY_MASK_DB ? NaN : (s * 1000) / designRate));
  return { freqsHz, linearMs: toMs(linear), minimumMs: toMs(minimumTaps.value) };
});

/** The transient as the source holds it: a pulse sampled at the source rate. */
export const sourcePulse = computed(() => gaussianPulse((transientUs.value / 1e6) * rate.value));

/** The transient as the filter sees it: the source pulse raised to the design rate by the interpolate stage. */
export const pulse = computed(() =>
  upsampledPulse(sourcePulse.value, Math.round(design.value.designRate / rate.value)),
);

/**
 * The transient through the filter at the design rate, with the index of time
 * zero: the input pulse's centre after the filter's nominal delay, half the
 * length for linear phase and nothing for minimum phase, so a linear-phase
 * output sits on the input and a minimum-phase output starts where the input
 * starts and trails after it.
 */
export const output = computed(() => {
  const { taps, h } = design.value;
  const p = pulse.value;
  const { y } = filterPulse(h, p);
  const nominal = phase.value === "minimum" ? 0 : (taps - 1) / 2;
  return { y, zero: (p.length - 1) / 2 + nominal };
});

/**
 * The readout row: output kHz, taps, length ms, transition band kHz,
 * attenuation dB, ring before and after dB. Null where a value does not
 * apply: everything but output where there is no filter, ring before under
 * minimum phase.
 */
export const readouts = computed(() => {
  const { taps, widthHz, attenDb, h } = design.value;
  const out = outputRate.value;
  const outputKhz = out === null ? null : out / 1000;
  if (noFilter.value) {
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
    attenuationDb: attenDb,
    ringBeforeDb: phase.value === "minimum" ? null : ring.beforeDb,
    ringAfterDb: ring.afterDb,
  };
});

/**
 * The grid the spectrum is read on: uniform from 0 to the axis top, stepping a
 * quarter of the sidelobe spacing so the comb is resolved rather than sampled
 * at random depth (math section 5.4 rule 1), and never fewer than sixteen
 * points for each pixel the pane reports, so a column always has a comb to
 * take its peak from. The nulls of a filter sit 1 / length apart whatever the
 * rate, so lobe spacing follows Length and nothing else, while the pixel floor
 * follows the window and nothing else; the grid takes whichever is denser, and
 * before the page has measured anything there is no floor to take. The
 * interval count rounds up to a power of two, which puts the axis top and the
 * source rate on grid points, so an alias reading lands on a sample instead of
 * between two, and puts every grid point on a bin of the magnitude reading's
 * FFT, so the filter's level is read exactly rather than chorded between bins.
 */
const spectrumGrid = computed(() => {
  const lobeHz = 1000 / lengthMs.value;
  const perLobe = Math.ceil((axisHz.value * POINTS_PER_LOBE) / lobeHz);
  const wanted = Math.max(2, perLobe, POINTS_PER_PIXEL * freqPx.value);
  const intervals = 1 << Math.ceil(Math.log2(wanted));
  /** @type {number[]} */
  const grid = Array.from({ length: intervals + 1 }, (_, i) => (i / intervals) * axisHz.value);
  return grid;
});

/**
 * The frequency pane's curves on a uniform grid from 0 to the axis top: the
 * source and its images (periodic in the source rate), the filter (periodic in
 * the design rate), the output stream (their product folded into the output
 * rate), and what the fold brings in, read apart since a power sum buries it
 * under the music: `aliasDb` the source's copies landing on each frequency,
 * unfiltered; `leakDb` what the output carries that the music did not put there.
 */
export const spectrum = computed(() => {
  const fs = rate.value;
  const out = outputRate.value ?? fs;
  const { designRate, h } = design.value;
  /** @type {number[]} */
  const freqsHz = spectrumGrid.value;
  // Every image of the source is the source folded about a multiple of Nyquist.
  const folded = freqsHz.map((f) => {
    const m = f % fs;
    return m > fs / 2 ? fs - m : m;
  });
  const sourceDb = sourceSpectrumDb(fs, folded, content.value);
  const filterDb = magnitudeDb(h, designRate, freqsHz);
  const product = sourceDb.map((v, i) => v + filterDb[i]);
  const resultDb = foldSpectrumDb(product, freqsHz, designRate, out);
  const aliasDb = aliasSpectrumDb(sourceDb, freqsHz, fs, out);
  const survived = aliasSpectrumDb(product, freqsHz, designRate, out);
  const leakDb = resultDb.map((v, i) => (freqsHz[i] > fs / 2 ? v : survived[i]));
  return { freqsHz, sourceDb, filterDb, resultDb, aliasDb, leakDb };
});
