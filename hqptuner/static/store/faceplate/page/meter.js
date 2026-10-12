// The page's Source section, store half: the parts of its meter that hold still between animation frames. Whether the
// meter or a no-stream line shows (the Source drawer's rule), the page's own Range, the Ranges a step wider and
// narrower, and the spectrum's dB scale, the Levels floor and the level bars' dB scale, the frequency axis to the top
// of the frequency span's view, how many level bars, and whether the section is slim. The moving parts, the trace and
// the bars, are painted each animation frame from the meter loop (store/meter/loop.js) by
// components/faceplate/page/sourcepaint.js; the DOM half is components/faceplate/page/SourceMeter.js.
//
// The Range sets the spectrum's span only: the spectrum spans full scale down to it. The level bars run from the
// Levels floor up to full scale, whatever the Range.

import { spanShare } from "../../../model/gauges/meter.js";
import { freqTicks, levelTicks, rangeSteps, spectrumAxes } from "../../../model/gauges/meter-plot.js";
import { meterGeometry } from "../../meter/feed.js";
import { METER_RANGES, meterFloor, pageRange } from "../../ui/prefs.js";
import { sourceMeter } from "../drawers/source.js";
import { plate } from "../plate.js";
import { freqSpan } from "../view.js";

const CD_NYQUIST = 22050; // the axis top while no geometry has arrived
const STEREO = 2;

/** @typedef {import("../drawers/source.js").MeterState} MeterState */

/**
 * The page meter's still parts. Ticks are fractions of their axis: x across the spectrum from 0 Hz to the top of the
 * frequency span's view, y down the spectrum from full scale to the range's floor, and down the level bars from full
 * scale to the Levels floor.
 *
 * @typedef {object} PageMeterView
 * @property {MeterState} state
 * @property {number} range  dB
 * @property {string | null} wider  the Range one step wider, null at the widest
 * @property {string | null} narrower  the Range one step narrower, null at the narrowest
 * @property {boolean} slim
 * @property {{ db: number, at: number }[]} db  the spectrum's dB scale, full scale first, `at` down from the top
 * @property {{ db: number, at: number }[]} levels  the level bars' dB scale, full scale first, `at` down from the top
 * @property {ReturnType<typeof freqTicks>} freq  the frequency labels, `at` across from the left
 * @property {boolean} edgeIsNyquist  whether the right edge is the source Nyquist, as it is at the whole band
 * @property {number} channels  level bars, one per channel the source carries
 * @property {number} nyquist  Hz
 */

/**
 * The Levels floor the page's level bars run up from, dBFS.
 *
 * @returns {number}
 */
export const levelsFloor = () => Number(meterFloor.value);

/**
 * What the page's Source section shows now, apart from what moves.
 *
 * @returns {PageMeterView}
 */
export function pageMeter() {
  const range = Number(pageRange.value);
  const geo = meterGeometry.value;
  const nyquist = geo ? geo.nyquist : CD_NYQUIST;
  const plot = { nyq: nyquist, range, w: 1, h: 1 };
  const share = spanShare(freqSpan.value);
  const top = nyquist * share;
  return {
    state: sourceMeter().state,
    range,
    ...rangeSteps(METER_RANGES, pageRange.value),
    slim: plate.value.meter === "slim",
    db: spectrumAxes(plot).db.map((t) => ({ db: t.db, at: t.y })),
    levels: levelTicks(levelsFloor()),
    freq: freqTicks(top, (f) => f / top),
    edgeIsNyquist: share === 1,
    channels: geo ? geo.channels : STEREO,
    nyquist,
  };
}
