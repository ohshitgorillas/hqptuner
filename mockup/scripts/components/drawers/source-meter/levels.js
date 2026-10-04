// Source meter level bars: per channel a vertical peak bar, RMS bar and held peak over a dBFS scale, and a table of
// the held peak and RMS readings.

import { h } from "../../../lib/shell/dom.js";
import { stepLevel } from "../../../../../hqptuner/static/model/gauges/meter.js";
import { levelTarget } from "../../../model/gauges/meter-source.js";
import { minusText } from "../../../../../hqptuner/static/model/shell/format.js";
import { edgeLabels, pct } from "./axes.js";
import { chName } from "./controls.js";

/**
 * @typedef {import('../../../../../hqptuner/static/model/gauges/meter.js').LevelReading} LevelReading
 * @typedef {import('../../../model/gauges/meter-source.js').MockColumn} MockColumn
 */

/**
 * The levels block's elements: one bar per channel, one reading cell pair per channel.
 *
 * @typedef {object} LevelsBlock
 * @property {HTMLElement} el
 * @property {HTMLElement} lvScale
 * @property {{ pk: HTMLElement, rm: HTMLElement, hd: HTMLElement, el: HTMLElement }[]} bars
 * @property {{ peak: HTMLElement, rms: HTMLElement }[]} cells
 */

/** @type {Record<string, number[]>} */
const LEVEL_TICKS = {
  "-48": [0, -6, -12, -24, -36, -48],
  "-60": [0, -10, -20, -30, -40, -50, -60],
  "-90": [0, -15, -30, -45, -60, -75, -90],
  "-120": [0, -20, -40, -60, -80, -100, -120],
};

/**
 * The levels block: head with its title and `floorCtl` (false on the page), the scale, one bar per channel and the
 * readings table.
 *
 * @param {number} nch
 * @param {HTMLElement | false} floorCtl
 * @returns {LevelsBlock}
 */
export function levelsView(nch, floorCtl) {
  const lvScale = h("div.lvs", { "aria-hidden": "true" });
  const bars = Array.from({ length: nch }, (_, i) => {
    const pk = h("i.pk"),
      rm = h("i.rm"),
      hd = h("i.hd");
    return { pk, rm, hd, el: h("div.lvb", {}, h("div.trough", {}, pk, rm, hd), h("span.lvn", { text: chName(i) })) };
  });
  const cells = Array.from({ length: nch }, () => ({ peak: h("span.npk"), rms: h("span.nrm") }));
  const el = h(
    "div.lside",
    {},
    h("div.mhead", {}, h("b.mt", { text: "Levels" }), h("span.grow"), floorCtl),
    h(
      "div.lvwrap",
      {},
      lvScale,
      bars.map((b) => b.el),
      h(
        "div.lvtab",
        {},
        h("span.u", { text: "dBFS" }),
        Array.from({ length: nch }, (_, i) => h("span.lvh", { text: chName(i) })),
        h("span.lvh.l", { text: "Peak" }),
        cells.map((c) => c.peak),
        h("span.lvh.l", { text: "RMS" }),
        cells.map((c) => c.rms),
      ),
    ),
  );
  return { el, lvScale, bars, cells };
}

/**
 * The levels' painter over `view`: `scale` repaints the dBFS scale for the floor, `step` runs one frame of the
 * ballistics toward the latest column and paints the bars and readings.
 *
 * @param {LevelsBlock} view
 * @param {import('../source-meter.js').MeterState} st  view state, read at each paint
 * @param {() => MockColumn} latest
 */
export function levelsPainter(view, st, latest) {
  /** @param {number} db */
  const frac = (db) => Math.max(0, Math.min(1, (db - st.floor) / -st.floor));
  /** @type {LevelReading[]} */
  let lv = view.bars.map(() => ({ peak: -60, rms: -60, hold: -60, holdAt: 0 }));
  function scale() {
    edgeLabels(
      view.lvScale,
      "top",
      LEVEL_TICKS[String(st.floor)].map((d) => ({ at: 1 - frac(d), text: d === 0 ? "0 dBFS" : minusText(d) })),
    );
  }
  /**
   * @param {number} now  ms
   * @param {number} dt   s
   */
  function step(now, dt) {
    const c = latest();
    lv = lv.map((v, ch) => stepLevel(v, levelTarget(c, ch, now), now, dt));
    view.bars.forEach((b, ch) => {
      const v = lv[ch];
      b.pk.style.height = pct(frac(v.peak));
      b.rm.style.height = pct(frac(v.rms));
      b.hd.style.bottom = pct(frac(v.hold));
      view.cells[ch].peak.textContent = minusText(v.hold.toFixed(1));
      view.cells[ch].rms.textContent = minusText(v.rms.toFixed(1));
    });
  }
  return { scale, step };
}
