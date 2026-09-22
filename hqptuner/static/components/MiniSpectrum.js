// The header's level readout: three bars, low, mid and high, riding the status
// poll. The backend integrates a fixed second of frames and hands the three
// levels down on /api/status (engine/metering.py); nothing here averages, and
// nothing here polls on its own.
//
// A missing triple is the floor rather than a hidden instrument: the engine is
// stopped, metering is off, or the stream sends no frames, and an instrument
// that disappears for three of its states shifts every element in the row.
import { computed } from "@preact/signals";
import { html } from "../lib/dom.js";
import { engineStatus } from "../store/signals.js";

// What the bars span. The floor is well under the quietest band a playing
// stream produces, so ordinary music spends most of the bar rather than
// pinning it.
const FLOOR_DB = -72;
const TOP_DB = 0;

const levels = computed(() => {
  const bands = (engineStatus.value || {}).bands;
  /** @type {(number|null)[]} */
  const triple = Array.isArray(bands) ? bands : [null, null, null];
  return triple;
});

/**
 * @param {number|null} db one band's level
 * @returns {number} how much of the bar it fills, percent
 */
function fill(db) {
  if (typeof db !== "number") return 0;
  const frac = (db - FLOOR_DB) / (TOP_DB - FLOOR_DB);
  return Math.round(Math.max(0, Math.min(1, frac)) * 100);
}

/** The header's three-band level readout. */
export function MiniSpectrum() {
  return html`
    <span class="mini-spectrum" data-testid="mini-spectrum" aria-hidden="true">
      ${levels.value.map(
        (db, i) => html`
          <span class="mini-well" key=${i}>
            <span class="mini-bar" style=${`height: ${fill(db)}%`}></span>
          </span>
        `,
      )}
    </span>
  `;
}
