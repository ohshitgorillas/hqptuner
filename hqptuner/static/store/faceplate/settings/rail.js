// The Settings rail as data: per category, its open flag, the blink the alert plan holds for it, and its readout rows,
// each printed through the control's readout form.

import { readoutOf } from "../../../model/shell/settings.js";

/**
 * @typedef {import("../../../model/shell/settings.js").Control} Control
 * @typedef {import("../../../model/shell/settings.js").Accent} Accent
 * @typedef {import("../../../model/shell/alerts.js").AlertPlan} AlertPlan
 * @typedef {import("../../../model/shell/alerts.js").Blink} Blink
 * @typedef {{ id: string, label: string, wide?: boolean, control: Control, value: () => string }} SettingsReadout
 * @typedef {{ id: string, name: string, readouts: readonly SettingsReadout[] }} SettingsCategory
 * @typedef {{ label: string, text: string, swatch: string | null, wide: boolean }} RailRow
 * @typedef {{ id: string, name: string, open: boolean, alert: Blink | undefined, rows: RailRow[] }} RailEntry
 */

/**
 * One readout's row: its label over the value as the control prints it.
 *
 * @param {SettingsReadout} r
 * @param {readonly Accent[]} accents
 * @returns {RailRow}
 */
function readoutRow(r, accents) {
  const { text, swatch } = readoutOf(r.control, r.value(), accents);
  return { label: r.label, text, swatch, wide: r.wide ?? false };
}

/**
 * The rail entry of every category, in order.
 *
 * @param {readonly SettingsCategory[]} categories
 * @param {AlertPlan} plan
 * @param {string | null} open  the open drawer's category id
 * @param {readonly Accent[]} accents
 * @returns {RailEntry[]}
 */
export function settingsRail(categories, plan, open, accents) {
  return categories.map((c) => {
    const rows = c.readouts.map((r) => readoutRow(r, accents));
    return { id: c.id, name: c.name, open: c.id === open, alert: plan.blinks.set.get(c.id), rows };
  });
}
