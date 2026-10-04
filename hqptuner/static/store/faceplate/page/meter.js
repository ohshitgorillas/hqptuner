// The page's Source section, store half: what its meter shows over the v1 stream. Whether the meter or a no-stream
// line shows (the Source drawer's rule), the page's own Range, the spectrum trace and its held peaks over the newest
// spectrogram slice, the dB scale the spectrum and the levels share, the frequency axis to the source Nyquist, one
// level bar per channel, and whether the section is slim. The DOM half is components/faceplate/page/SourceMeter.js.
//
// One Range sets both halves: the spectrum spans full scale down to it, and the level bars run from −range up. The
// spectrum's hold steps once per slice, through every slice since it last stepped, on the playback those slices cover,
// so how often the page reads it never changes what it shows. Where none of the slices drawn is one it stepped (first
// read, a new track, a channel picked in the drawer), it lands on the oldest of the last LOOKBACK and steps from there.

import { computed } from "@preact/signals";
import { emptySpectrum, stepSpectrum } from "../../../model/gauges/meter.js";
import { freqTicks, spectrumAxes, spectrumPoints } from "../../../model/gauges/meter-plot.js";
import { meterGeometry, meterLevels } from "../../meter/feed.js";
import { fraction } from "../../meter/levels.js";
import { spectrogramCells } from "../../meter/spectrogram.js";
import { pageRange } from "../../ui/faceplate.js";
import { sourceMeter } from "../drawers/source.js";
import { plate } from "../view.js";

const CD_NYQUIST = 22050; // the axis top while no slice and no geometry has arrived
const STEREO = 2;
// Slices a fresh hold steps through: a full-scale peak held two seconds and decayed 1 dB a slice past the widest
// Range's floor (model/gauges/meter.js), so what it shows is what reading every slice would have shown.
const LOOKBACK = 160;

/** @typedef {import("../drawers/source.js").MeterState} MeterState */
/** @typedef {import("../../../model/gauges/meter.js").SpectrumHold} SpectrumHold */
/** @typedef {import("../../../lib/spectroraster.js").Cell} Cell */

/**
 * The spectrum's hold between slices: the hold, the newest slice's levels it stepped to, the playback it has run, ms,
 * and the newest slice's band layout.
 *
 * @typedef {object} HoldState
 * @property {SpectrumHold | null} hold
 * @property {ArrayLike<number> | null} last
 * @property {number} clock
 * @property {number[]} centres  Hz
 * @property {number} nyquist    Hz
 */

/**
 * One channel's bar: where its peak, RMS and hold sit from the floor (0) to full scale (1), and its held peak and RMS
 * in dBFS, null while the channel has no reading.
 *
 * @typedef {object} ChannelLevel
 * @property {number} peak
 * @property {number} rms
 * @property {number} hold
 * @property {number | null} peakDb
 * @property {number | null} rmsDb
 */

/**
 * The page meter's view. Points and ticks are fractions of the spectrum plot: x across from 0 Hz to the Nyquist, y down
 * from full scale to the range's floor.
 *
 * @typedef {object} PageMeterView
 * @property {MeterState} state
 * @property {number} range  dB
 * @property {boolean} slim
 * @property {{ disp: [number, number][], peak: [number, number][] }} trace  the shown level and the held peaks
 * @property {{ db: number, at: number }[]} db  the dB scale, full scale first, `at` down from the top
 * @property {ReturnType<typeof freqTicks>} freq  the frequency labels, `at` across from the left
 * @property {ChannelLevel[]} levels
 */

/** @type {HoldState} */
const EMPTY = { hold: null, last: null, clock: 0, centres: [], nyquist: 0 };

/**
 * Where `levels` sits in `cells`, searched from the newest back; -1 where it is in none.
 *
 * @param {Cell[]} cells
 * @param {ArrayLike<number> | null} levels
 * @returns {number}
 */
function indexOf(cells, levels) {
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i].slices[0] === levels) return i;
  return -1;
}

/**
 * The hold after one slice: stepped from `prev`, or landed at once where there is none or its bins differ.
 *
 * @param {SpectrumHold | null} prev
 * @param {ArrayLike<number>} levels
 * @param {number} now  ms
 * @returns {SpectrumHold}
 */
function stepHold(prev, levels, now) {
  if (prev && prev.disp.length === levels.length) return stepSpectrum(prev, levels, now, false);
  return stepSpectrum(emptySpectrum(levels.length), levels, now, true);
}

/**
 * The hold over the slices the spectrogram draws now: stepped through every slice newer than the last it saw, or
 * afresh through the last LOOKBACK when the last it saw is gone; empty when no slice is drawn.
 *
 * @param {HoldState} st
 * @param {Cell[]} cells  oldest first
 * @returns {HoldState}
 */
function foldCells(st, cells) {
  const newest = cells.at(-1);
  if (!newest || !newest.slices[0]) return EMPTY;
  const from = st.hold ? indexOf(cells, st.last) : -1;
  const steps = cells.slice(from < 0 ? Math.max(0, cells.length - LOOKBACK) : from + 1);
  let { hold, clock } = from < 0 ? { hold: null, clock: st.clock } : st;
  for (const c of steps) {
    const levels = c.slices[0];
    if (!levels) continue;
    clock += c.ms;
    hold = stepHold(hold, levels, clock);
  }
  return { hold, last: newest.slices[0], clock, centres: newest.centres, nyquist: newest.nyquist };
}

let held = EMPTY;
const spectrum = computed(() => (held = foldCells(held, spectrogramCells.value)));

/**
 * One bar per channel the source carries or the feed reads.
 *
 * @param {number} channels
 * @param {number} floor  dBFS
 * @returns {ChannelLevel[]}
 */
function levelsOf(channels, floor) {
  const lv = meterLevels.value;
  return Array.from({ length: Math.max(channels, lv.length) }, (_, i) => {
    const b = lv[i];
    if (!b) return { peak: 0, rms: 0, hold: 0, peakDb: null, rmsDb: null };
    return {
      peak: fraction(b.peak, floor),
      rms: fraction(b.rms, floor),
      hold: fraction(b.hold, floor),
      peakDb: b.hold,
      rmsDb: b.rms,
    };
  });
}

/**
 * What the page's Source section shows now.
 *
 * @returns {PageMeterView}
 */
export function pageMeter() {
  const range = Number(pageRange.value);
  const sp = spectrum.value;
  const geo = meterGeometry.value;
  const nyq = sp.hold ? sp.nyquist : geo ? geo.nyquist : CD_NYQUIST;
  const plot = { nyq, range, w: 1, h: 1 };
  /** @param {ArrayLike<number>} arr */
  const points = (arr) => spectrumPoints(arr, sp.centres, plot);
  return {
    state: sourceMeter().state,
    range,
    slim: plate.value.meter === "slim",
    trace: sp.hold ? { disp: points(sp.hold.disp), peak: points(sp.hold.peak) } : { disp: [], peak: [] },
    db: spectrumAxes(plot).db.map((t) => ({ db: t.db, at: t.y })),
    freq: freqTicks(nyq, (f) => f / nyq),
    levels: levelsOf(geo ? geo.channels : STEREO, -range),
  };
}
