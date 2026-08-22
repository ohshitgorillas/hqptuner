// The daemon's own form as the tab suites hand it to the store, the two readers
// that pull one disclosure out of a rendered tab, and the reader that finds a
// card.
//
// A card is named by the `data-card` its `<section>` carries — the card's own
// machine identity, contract like any other wire-side marking — and never by the
// words in its head, which the owner may reword at will (docs/testing.md rule 9).

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

// The opening `<section>` tag of the card carrying `data-card="<card>"`, or
// null. The attribute run stops at the tag's own close, so a card id never
// matches inside the card ahead of it.
/**
 * @param {string} out
 * @param {string} card
 * @returns {RegExpExecArray | null}
 */
const cardTag = (out, card) => new RegExp(`<section([^<>]*\\sdata-card="${card}"[^<>]*)>`).exec(out);

// Where the card opened at `at` closes: the end of the `</section>` that brings
// the depth back to zero. A card MAY carry a nested <section>, so the first
// close after the opening tag is not necessarily the card's own — taking it
// hands back a fragment with an unclosed element in it, and every reader that
// scans the fragment then dies on the imbalance rather than on the assertion.
// -1 when the depth never closes.
/**
 * @param {string} out
 * @param {number} at
 * @returns {number}
 */
const closeOf = (out, at) => {
  const tag = /<section(?=[\s/>])|<\/section>/g;
  tag.lastIndex = at;
  let depth = 0;
  let m;
  while ((m = tag.exec(out)) !== null) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
};

// One disclosure's fragment, opening tag to its own balanced close. Empty
// string when the tab renders no such card, and empty string rather than a
// truncated fragment when the card never closes.
/**
 * @param {string} out
 * @param {string} card
 */
export const section = (out, card) => {
  const at = cardHeadAt(out, card);
  const end = at < 0 ? -1 : closeOf(out, at);
  return end < 0 ? "" : out.slice(at, end);
};

// That disclosure's state — "open" or "closed" — off the section's own class.
/**
 * @param {string} out
 * @param {string} card
 */
export const stateOf = (out, card) => {
  const tag = cardTag(out, card);
  const names = tag ? /(^|\s)class="card ([^"]*)"/.exec(tag[1]) : null;
  return names ? names[2] : "";
};

// Where the card starts, whatever its head turns out to be: a plain
// `<div class="card-head">`, a hero's `card-head center`, or a collapsible's
// `<button class="card-head">` with its disclosure triangle ahead of the title.
// Which of those a card uses is a disclosure decision, not a behavior, so a
// card that gains or loses one stays findable, and so does one that is reworded.
// -1 when the tab renders no card with that id.
/**
 * @param {string} out
 * @param {string} card
 */
export const cardHeadAt = (out, card) => {
  const tag = cardTag(out, card);
  return tag ? tag.index : -1;
};

// One card's fragment, from its opening tag to its close. Empty string when the
// tab renders no card with that id.
/**
 * @param {string} out
 * @param {string} card
 */
export const cardTitled = (out, card) => section(out, card);
