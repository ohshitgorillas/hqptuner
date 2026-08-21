// The daemon's own form as the tab suites hand it to the store, the two readers
// that pull one disclosure out of a rendered tab, and the reader that finds a
// card by the title in its head.

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

// Where the head titled `title` starts, whatever element carries it: a plain
// `<div class="card-head">`, a hero's `card-head center`, or a collapsible's
// `<button class="card-head">` with its disclosure triangle ahead of the title.
// Which of those a card uses is a disclosure decision, not a behavior, so a
// card that gains or loses one stays findable. -1 when no such head is rendered.
// (Same shape as the `head(title)` regexes in the live-view suites.) The title
// must run to the head's own close, so "Backend" does not answer with the
// "ALSA Backend" disclosure.
/**
 * @param {string} out
 * @param {string} title
 */
export const cardHeadAt = (out, title) => {
  const at = out.search(new RegExp(`class="card-head[^"]*">(<span class="tri">[^<]*</span> )?${title}</(div|button)>`));
  return at < 0 ? -1 : out.lastIndexOf("<", at);
};

// One card's fragment, from its head to its close. Cards carry no nested
// <section>, so the first close after the head is the card's own. Empty string
// when no card carries that title.
/**
 * @param {string} out
 * @param {string} title
 */
export const cardTitled = (out, title) => {
  const at = cardHeadAt(out, title);
  return at < 0 ? "" : out.slice(at, out.indexOf("</section>", at));
};
