// The page's Source section, store half: the parts of its meter that hold still between animation frames. Whether the
// meter or a no-stream line shows (the Source drawer's rule), the page's own Range, the dB scale the spectrum and the
// levels share, the frequency axis to the source Nyquist, how many level bars, and whether the section is slim. The
// moving parts, the trace and the bars, are painted each animation frame from the meter loop (store/meter/loop.js) by
// components/faceplate/page/sourcepaint.js; the DOM half is components/faceplate/page/SourceMeter.js.
//
// One Range sets both halves: the spectrum spans full scale down to it, and the level bars run from −range up.

import { freqTicks, spectrumAxes } from "../../../model/gauges/meter-plot.js";
import { meterGeometry } from "../../meter/feed.js";
import { pageRange } from "../../ui/faceplate.js";
import { sourceMeter } from "../drawers/source.js";
import { plate } from "../view.js";

const CD_NYQUIST = 22050; // the axis top while no geometry has arrived
const STEREO = 2;

/** @typedef {import("../drawers/source.js").MeterState} MeterState */

/**
 * The page meter's still parts. Ticks are fractions of the spectrum plot: x across from 0 Hz to the Nyquist, y down
 * from full scale to the range's floor.
 *
 * @typedef {object} PageMeterView
 * @property {MeterState} state
 * @property {number} range  dB
 * @property {boolean} slim
 * @property {{ db: number, at: number }[]} db  the dB scale, full scale first, `at` down from the top
 * @property {ReturnType<typeof freqTicks>} freq  the frequency labels, `at` across from the left
 * @property {number} channels  level bars, one per channel the source carries
 * @property {number} nyquist  Hz
 */

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
  return {
    state: sourceMeter().state,
    range,
    slim: plate.value.meter === "slim",
    db: spectrumAxes(plot).db.map((t) => ({ db: t.db, at: t.y })),
    freq: freqTicks(nyquist, (f) => f / nyquist),
    channels: geo ? geo.channels : STEREO,
    nyquist,
  };
}
