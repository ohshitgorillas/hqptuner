// The daemon's own form as the tab suites hand it to the store, the two readers
// that pull one disclosure out of a rendered tab, and the reader that finds a
// card.
//
// A card is named by the `data-card` its `<section>` carries — the card's own
// machine identity, contract like any other wire-side marking — and never by the
// words in its head, which the owner may reword at will.

/**
 * A dropdown field's spec: the value the form carries, and the options it offers.
 *
 * @typedef {{ value: string, options: SchemaOption[] }} DropdownSpec
 */

/**
 * One field's spec: a bare value, or a dropdown's value/options pair.
 *
 * @typedef {string | boolean | DropdownSpec} FieldSpec
 */

// A form's fields, keyed by FORM FIELD name (backend's field is `backend`, DAC
// correction's is `post_correction_enabled` on /matrix). A spec value is either
// a bare value or a {value, options} pair for a dropdown.
/** @param {Record<string, FieldSpec>} spec */
export const formFields = (spec) =>
  Object.entries(spec).map(([name, v]) =>
    v && typeof v === "object" && v.options ? { name, ...v } : { name, value: v },
  );
