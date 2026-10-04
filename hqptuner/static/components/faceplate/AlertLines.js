// Alert lines: one line per alert in the order given, each led by its severity's glyph and coloured by its severity.

import { html } from "../../lib/dom.js";

/** @typedef {import("../../model/shell/alerts.js").Sev} Sev */
/** @typedef {import("../../model/shell/alerts.js").Alert} Alert */

/** @type {Record<Sev, string>} */
const GLYPH = { crit: "⚠", warn: "⚠", advice: "♪" };

/**
 * The lines of a set of alerts.
 *
 * @param {{ alerts: Alert[] }} props
 */
export const AlertLines = ({ alerts }) =>
  alerts.map(
    (a) => html`
      <p class="aline" data-sev=${a.sev}>
        <span class="ag" aria-hidden="true">${GLYPH[a.sev]}</span>
        <span>${a.text}</span>
      </p>
    `,
  );
