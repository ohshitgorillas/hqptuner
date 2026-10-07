// The document seam for the suites that watch the page's visibility: a document
// with a writable `hidden` flag that keeps its `visibilitychange` listeners, so a
// suite can hide and show the page the way the browser does. Plain node has no
// document, so a suite that wants one installs this before the code under test
// reads it.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

/**
 * The global the fake is installed on, viewed as an optional member: under
 * `node --test` there is none, and the DOM lib declares it as always present and
 * fully shaped.
 *
 * @type {{ document?: unknown }}
 */
const env = globalThis;

/** @type {Set<() => unknown>} */
const onVisibility = new Set();

const page = {
  hidden: false,
  addEventListener(/** @type {string} */ type, /** @type {() => unknown} */ fn) {
    if (type === "visibilitychange") onVisibility.add(fn);
  },
  removeEventListener(/** @type {string} */ type, /** @type {() => unknown} */ fn) {
    if (type === "visibilitychange") onVisibility.delete(fn);
  },
};

/**
 * Install the document, its page starting hidden or shown.
 *
 * @param {boolean} [hidden]
 */
export function usePage(hidden = false) {
  page.hidden = hidden;
  env.document = page;
}

/**
 * Hide or show the page as the browser does: flip `hidden`, then dispatch
 * `visibilitychange` to every listener.
 *
 * @param {boolean} hidden
 */
export function setHidden(hidden) {
  page.hidden = hidden;
  for (const fn of onVisibility) fn();
}
