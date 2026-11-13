// Settings rail readouts drawn from a field's own options: a field's or a catalog entry's option list as a seg control,
// and a readout over a declared field that prints the option it lights.

/** @typedef {import("../../../store/faceplate/drawer.js").FieldOption} FieldOption */
/** @typedef {import("../../../store/faceplate/drawer.js").FieldSpec} FieldSpec */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */
/** @typedef {import("../../../model/shell/settings.js").Control} Control */

/**
 * A seg readout's control over a field's options, or a catalog entry's.
 *
 * @param {readonly (FieldOption | SchemaOption)[]} options
 * @returns {Control}
 */
export const seg = (options) => ({ type: "seg", options: options.map((o) => ({ v: o.value, label: o.label })) });

/**
 * A readout of a field: its id, its label, its options as a seg, and the option it lights.
 *
 * @param {FieldSpec} field
 * @returns {SettingsReadout}
 */
export const fieldReadout = (field) => ({
  id: field.id,
  label: field.label,
  control: seg(field.options),
  value: field.value,
});
