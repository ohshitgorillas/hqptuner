// The daemon's own form as the tab suites hand it to the store, and the two
// readers that pull one disclosure out of a rendered tab.

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

// One disclosure's fragment, keyed by the title in its head.
/**
 * @param {string} out
 * @param {string} title
 */
export const section = (out, title) => {
  const head = out.indexOf(`</span> ${title}</button>`);
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};

// That disclosure's state — "open" or "closed" — off the section's own class.
const MARK = '<section class="card ';
/**
 * @param {string} out
 * @param {string} title
 */
export const stateOf = (out, title) => {
  const head = out.indexOf(`</span> ${title}</button>`);
  const at = head < 0 ? -1 : out.lastIndexOf(MARK, head);
  return at < 0 ? "" : out.slice(at + MARK.length).split('"')[0];
};
