// The Settings rail: one button per category, its engraved name over its readouts, each a label and the value as its
// control prints it, an accent's swatch before its name. A tap opens the category's drawer, or closes it when it is the
// open one. A raised alert homed on a category blinks it in the alert's colour.

import { html } from "../../../lib/dom.js";
import { settingsRail } from "../../../store/faceplate/settings/rail.js";
import { ACCENTS } from "../../../store/faceplate/settings/visual.js";
import { alertsNow } from "../../../store/faceplate/alerts.js";
import { openStage, toggleStage } from "../../../store/faceplate/view.js";

/**
 * @typedef {import("../../../store/faceplate/settings/rail.js").SettingsCategory} SettingsCategory
 * @typedef {import("../../../store/faceplate/settings/rail.js").RailRow} RailRow
 * @typedef {import("../../../store/faceplate/settings/rail.js").RailEntry} RailEntry
 */

/**
 * One readout row: its label over its value, the swatch first when it carries one.
 *
 * @param {{ row: RailRow }} props
 */
function Row({ row }) {
  return html`
    <div class=${row.wide ? "wide" : undefined}>
      <dt>${row.label}</dt>
      <dd>${row.swatch !== null && html`<i class="sw" style=${`--sw:${row.swatch}`}></i>`}${row.text}</dd>
    </div>
  `;
}

/**
 * One category's button.
 *
 * @param {{ entry: RailEntry }} props
 */
function Category({ entry }) {
  return html`
    <button
      type="button"
      class=${entry.open ? "st sst open" : "st sst"}
      data-stage=${entry.id}
      data-alert=${entry.alert}
      onClick=${() => toggleStage(entry.id)}
    >
      <span class="n">${entry.name}</span>
      <dl class="sro">${entry.rows.map((row) => html`<${Row} key=${row.label} row=${row} />`)}</dl>
    </button>
  `;
}

/**
 * The Settings rail, its entries decided from the categories, the alerts raised and the open drawer.
 *
 * @param {{ categories: readonly SettingsCategory[] }} props
 */
export function SettingsRail({ categories }) {
  const entries = settingsRail(categories, alertsNow.value, openStage.value, ACCENTS);
  return html`
    <nav class="rail srail" aria-label="Settings">
      ${entries.map((entry) => html`<${Category} key=${entry.id} entry=${entry} />`)}
    </nav>
  `;
}
