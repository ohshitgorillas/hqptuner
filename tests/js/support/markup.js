// Rendered-markup scanning shared by the suites that ask what a region of a
// card encloses. Lifted from tests/js/components/liveplayback.test.js, which
// settled the convention: the disabled state a control carries when the engine
// has taken it away is the `off` class token (`knob knob-lg off`, `dsp-body
// off`), and the region carrying it is the OUTERMOST element inside the
// fragment that carries the token.
//
// A tag-balancing scan rather than a structural selector, so an assertion can
// ask what a region does and does not enclose without naming any structure the
// component is free to change.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track"]);

// Every element in a fragment, with its own outer HTML.
//
// An element left open when its parent closes, or at the end of the fragment,
// raises rather than being dropped: a silently shorter list makes the questions
// below ("what is the OUTERMOST element carrying this?", "what is the SMALLEST
// element enclosing that?") quietly answer about the wrong element.
/**
 * One element of a scanned fragment: its tag name, its attribute run, where it
 * starts in the fragment, and its own outer HTML.
 *
 * @typedef {{ name: string, attrs: string, start: number, html: string }} MarkupElement
 */

/**
 * @param {string} out
 * @returns {MarkupElement[]}
 */
export function elements(out) {
  // The attribute run is greedy, not lazy, and the name is followed by a
  // lookahead: both alternatives inside the run start with a different
  // character class, so a greedy run has exactly one way to match and the
  // engine never re-splits it. A lazy run plus a trailing (\/?) gave it two.
  // The self-closing slash lands at the end of the run and is peeled off below.
  const tag = /<(\/?)([a-zA-Z][\w-]*)(?=[\s/>])((?:[^>"]|"[^"]*")*)>/g;
  /** @type {{ name: string, attrs: string, start: number }[]} */
  const stack = [];
  /** @type {MarkupElement[]} */
  const all = [];
  let m;
  while ((m = tag.exec(out)) !== null) {
    const [full, close, name, run] = m;
    const selfClose = run.endsWith("/");
    const attrs = selfClose ? run.slice(0, -1) : run;
    if (close) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at < 0) continue;
      const [open, ...unclosed] = stack.splice(at);
      if (unclosed.length > 0) throw new Error(`<${unclosed[0].name}> is never closed inside <${name}>`);
      all.push({ name, attrs: open.attrs, start: open.start, html: out.slice(open.start, tag.lastIndex) });
      continue;
    }
    if (selfClose || VOID.has(name)) all.push({ name, attrs, start: m.index, html: full });
    else stack.push({ name, attrs, start: m.index });
  }
  if (stack.length > 0) throw new Error(`<${stack[0].name}> is never closed in the fragment`);
  return all;
}

/**
 * @param {MarkupElement} el
 * @returns {string[]}
 */
export const classes = (el) => ((/class="([^"]*)"/.exec(el.attrs) || [])[1] || "").split(/\s+/);

/**
 * One attribute's value, or undefined when the element does not carry it. The
 * wire-valued attributes (`data-k`, `data-v`) are contract, unlike the words
 * beside them, so this is how a control and an option are identified.
 *
 * @param {MarkupElement} el
 * @param {string} name
 * @returns {string | undefined}
 */
export const attr = (el, name) => (new RegExp(`(^|\\s)${name}="([^"]*)"`).exec(el.attrs) || [])[2];

/**
 * What a reader sees inside an element: markup stripped, whitespace collapsed.
 *
 * @param {MarkupElement} el
 * @returns {string}
 */
export const text = (el) =>
  el.html
    .replace(/<[^<>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether an attribute is present on an element, with or without a value —
 * `checked` and `checked=""` both count, `data-checked` does not.
 *
 * @param {MarkupElement} el
 * @param {string} name
 * @returns {boolean}
 */
export const hasAttr = (el, name) => new RegExp(`(^|\\s)${name}(\\s|=|$)`).test(el.attrs);

// A control a card head may carry beside its title. Whole subtrees, so the
// label inside one never reaches the title.
const CONTROL_TAGS = new Set(["a", "button", "input", "select", "textarea"]);

// The disclosure triangle a collapsible head carries before its title, by the
// class it wears. Removed as a whole element, so a title that legitimately opens
// with a digit or a symbol keeps it.
const TRIANGLE = "tri";

/**
 * A card head's title: the head's own words, with the disclosure triangle a
 * collapsible head carries stripped and any control the head carries beside the
 * title removed. The title is the contract; the triangle and the controls are
 * the card's own business. Removal is by whole element, never by trimming the
 * title's own text, so a head titled "LIVE MODE PRO" still reads as "LIVE MODE
 * PRO" and a renamed head still reads as its new name.
 *
 * @param {MarkupElement} el
 * @returns {string}
 */
export const headTitle = (el) => {
  const bare = elements(el.html)
    .filter(
      (e) =>
        (CONTROL_TAGS.has(e.name) || classes(e).includes(TRIANGLE)) &&
        !(e.start === 0 && e.html.length === el.html.length),
    )
    .reduce((markup, e) => markup.replace(e.html, " "), el.html);
  return text({ ...el, html: bare });
};

/**
 * @param {MarkupElement} a
 * @param {MarkupElement} b
 */
const same = (a, b) => a.start === b.start && a.html.length === b.html.length;

// The smallest element of the fragment that encloses `el` and is not `el`
// itself: the row, region or card a control is wrapped in, named by what it
// contains rather than by the class the component happens to give it.
/**
 * @param {string} fragment
 * @param {MarkupElement} el
 * @returns {MarkupElement}
 */
export function enclosing(fragment, el) {
  const end = el.start + el.html.length;
  const around = elements(fragment).filter(
    (e) => e.start <= el.start && e.start + e.html.length >= end && !same(e, el),
  );
  if (around.length === 0) throw new Error(`nothing in the fragment encloses <${el.name}>`);
  return around.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

// Every element a schema key renders as. A field's wrapper carries
// `data-k="<key>"` (components/Field.js), and the key is the wire identifier the
// daemon's form is keyed by — contract, unlike the words announcing it — so a
// control is found by its key and never by its wording (docs/testing.md rule 9).
/**
 * @param {string} fragment
 * @param {string} name
 * @returns {MarkupElement[]}
 */
const labels = (fragment, name) => {
  const want = new RegExp(`(^|\\s)data-k="${name}"`);
  return elements(fragment).filter((el) => want.test(el.attrs));
};

/**
 * The control a schema key is rendered by. Matched on the key, so a `for=`, a
 * class, a reworded label or a trailing hint span changes nothing.
 *
 * @param {string} fragment
 * @param {string} name
 * @returns {MarkupElement}
 */
export function labeled(fragment, name) {
  const [hit] = labels(fragment, name);
  if (!hit) throw new Error(`no control keyed "${name}" in the fragment`);
  return hit;
}

/**
 * @param {string} fragment
 * @param {string} name
 * @returns {boolean}
 */
export const hasLabel = (fragment, name) => labels(fragment, name).length > 0;

/**
 * The field a schema key renders as.
 *
 * @param {string} fragment
 * @param {string} key
 * @returns {MarkupElement}
 */
export function keyed(fragment, key) {
  const [hit] = labels(fragment, key);
  if (!hit) throw new Error(`no field keyed "${key}" in the fragment`);
  return hit;
}

/**
 * The outermost element inside a fragment carrying the disabled marker.
 *
 * @param {string} fragment
 * @returns {string}
 */
export function disabledRegion(fragment) {
  const marked = elements(fragment).filter((el) => classes(el).includes("off"));
  if (marked.length === 0) throw new Error("nothing in the fragment carries the disabled state");
  return marked.reduce((a, b) => (a.start <= b.start ? a : b)).html;
}
