// The filter primer graph's state: the knobs the reader turns, the chip values
// each slider snaps to, the "Show me" rows that set the whole state at once,
// and the filter designed from them (docs/plans/filter-primer-graph.md).
//
// Nothing here touches a field or the daemon. Every curve the graph draws is
// textbook FIR design from lib/dsp/fir.js at an oversampled rate; no HQPlayer
// filter is plotted or approximated.
import { computed, signal } from "@preact/signals";
import { designLowpass, minimumPhase } from "../lib/dsp/fir.js";

/** Length chips, in milliseconds of filter. */
export const LENGTH_CHIPS = { short: 0.5, medium: 2, long: 8 };
/** Roll-off chips, 0 the slow end (a wide band straddling Nyquist), 1 the fast end (a narrow band ending at Nyquist). */
const ROLLOFF_CHIPS = { slow: 0, medium: 0.5, fast: 1 };
/** Transient chips, the pulse sigma in microseconds. */
const TRANSIENT_CHIPS = { click: 20, snap: 100, thud: 500 };

// The transition band as a fraction of the source Nyquist at each end of the
// roll-off slider; the band narrows and slides up to end at Nyquist as the
// slider moves toward fast.
const WIDTH_SLOW = 0.5;
const WIDTH_FAST = 0.05;
const OVERSAMPLE = 4;

/**
 * @typedef {{ spurs: boolean, fakeHires: boolean, risingNoise: boolean }} Content
 * @typedef {{ rate: number, phase: string, lengthMs: number, rolloff: number, transientUs: number,
 *             content: Content }} Row
 */

const QUIET = { spurs: false, fakeHires: false, risingNoise: false };

/** @type {Record<string, Row>} */
const SHOW_ME = {
  intro: {
    rate: 44100,
    phase: "linear",
    lengthMs: LENGTH_CHIPS.medium,
    rolloff: ROLLOFF_CHIPS.medium,
    transientUs: TRANSIENT_CHIPS.snap,
    content: QUIET,
  },
  "phase-length": {
    rate: 44100,
    phase: "linear",
    lengthMs: LENGTH_CHIPS.long,
    rolloff: ROLLOFF_CHIPS.medium,
    transientUs: TRANSIENT_CHIPS.click,
    content: QUIET,
  },
  "roll-off": {
    rate: 96000,
    phase: "linear",
    lengthMs: LENGTH_CHIPS.medium,
    rolloff: ROLLOFF_CHIPS.fast,
    transientUs: TRANSIENT_CHIPS.snap,
    content: { ...QUIET, risingNoise: true },
  },
};

export const rate = signal(SHOW_ME.intro.rate);
export const phase = signal(SHOW_ME.intro.phase);
export const lengthMs = signal(SHOW_ME.intro.lengthMs);
const rolloff = signal(SHOW_ME.intro.rolloff);
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
  phase.value = r.phase;
  lengthMs.value = r.lengthMs;
  rolloff.value = r.rolloff;
  transientUs.value = r.transientUs;
  content.value = { ...r.content };
}

/**
 * The oversampling filter the state describes: designed at four times the
 * source rate, so the whole frequency axis (0 to twice the source rate) sits
 * inside the output Nyquist and none of the filter's own periodic image shows;
 * taps = ms x 4 x rate forced odd, cutoff at the centre of a transition band
 * that straddles Nyquist at the slow end and ends at it at the fast end.
 * Minimum phase is the same magnitude, converted.
 */
export const design = computed(() => {
  const designRate = OVERSAMPLE * rate.value;
  const nyquist = rate.value / 2;
  const widthHz = (WIDTH_SLOW + (WIDTH_FAST - WIDTH_SLOW) * rolloff.value) * nyquist;
  const cutoffHz = nyquist - (rolloff.value * widthHz) / 2;
  const taps = Math.max(3, Math.round((lengthMs.value / 1000) * designRate)) | 1;
  const linear = designLowpass({ rate: designRate, taps, cutoffHz, widthHz });
  const h = phase.value === "minimum" ? minimumPhase(linear) : linear;
  return { designRate, taps, cutoffHz, widthHz, h };
});
