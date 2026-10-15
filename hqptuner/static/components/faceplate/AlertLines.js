// Alert lines: one line per alert in the order given, each led by its severity's glyph and colored by its severity. A
// line that lists settings carries one row per setting under its sentence, reading `Label: value`. A line whose alert
// carries an action is a button.

import { html } from "../../lib/dom.js";

/** @typedef {import("../../model/shell/alerts.js").Sev} Sev */
/** @typedef {import("../../model/shell/alerts.js").Alert} Alert */
/** @typedef {import("../../model/shell/alerts.js").AlertItem} AlertItem */

/** @type {Record<Sev, string>} */
const GLYPH = { crit: "⚠", warn: "⚠", advice: "♪" };

/**
 * The rows under a line's sentence, one per listed setting; nothing when it lists none.
 *
 * @param {AlertItem[] | undefined} items
 */
const Items = (items) =>
  items?.length
    ? html`
        <span class="aitems">
          ${items.map((it) => html`<span>${it.label}: <span class="av">${it.value}</span></span>`)}
        </span>
      `
    : null;

/**
 * One alert's line. A line whose alert carries an action is a button that takes it.
 *
 * @param {Alert} a
 */
function Line(a) {
  const inner = html`
    <span class="ag" aria-hidden="true">${GLYPH[a.sev]}</span>
    <span>${a.text}</span>
    ${Items(a.items)}
  `;
  return a.act
    ? html`<button type="button" class="aline" data-sev=${a.sev} onClick=${a.act}>${inner}</button>`
    : html`<p class="aline" data-sev=${a.sev}>${inner}</p>`;
}

/**
 * The lines of a set of alerts.
 *
 * @param {{ alerts: Alert[] }} props
 */
export const AlertLines = ({ alerts }) => alerts.map(Line);
