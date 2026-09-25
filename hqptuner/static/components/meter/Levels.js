// The METER page's level meters: per channel, a peak bar with the RMS bar
// inside it and a peak-hold tick, each placed from the chosen dB floor to full
// scale. An empty level list draws every bar at the floor.
import { html } from "../../lib/dom.js";
import { db } from "../../lib/units.js";
import { fraction } from "../../store/meter/levels.js";

/** @typedef {import("../../store/meter/levels.js").Ballistic} Ballistic */

/** @param {number} channels @param {number} i */
const channelName = (channels, i) => (channels === 2 ? ["L", "R"][i] : String(i + 1));

/** @param {number} f */
const pct = (f) => `${(f * 100).toFixed(1)}%`;

/**
 * One row per channel, at least `channels` of them.
 * @param {{ levels: Ballistic[], channels: number, floor: number }} props
 */
export function Levels({ levels, channels, floor }) {
  const rows = Array.from({ length: Math.max(channels, levels.length) }, (_, i) => levels[i] || null);
  return html`
    <div class="mt-levels">
      ${rows.map((lv, i) => {
        const peak = lv ? fraction(lv.peak, floor) : 0;
        const rms = lv ? fraction(lv.rms, floor) : 0;
        const hold = lv ? fraction(lv.hold, floor) : 0;
        return html`
          <div class="mt-row">
            <span class="t-label">${channelName(rows.length, i)}</span>
            <div class="mt-trough">
              <i class="mt-peak" data-testid="meter-peak" style="width: ${pct(peak)}"></i>
              <i class="mt-rms" data-testid="meter-rms" style="width: ${pct(rms)}"></i>
              ${lv ? html`<i class="mt-hold" style="left: ${pct(hold)}"></i>` : null}
            </div>
            <span class="mt-val t-value">${lv ? db(lv.peak, 1) : ""}</span>
          </div>
        `;
      })}
    </div>
  `;
}
