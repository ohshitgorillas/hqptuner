// The stale mark as the rendered suites read it, and the daemon they read it against: a form that keeps showing its
// last reading marks the values it shows with the `stale` class token while it waits on its readback after a write,
// or while its last read failed. A value is marked when the element showing it, an element inside it, or an element
// enclosing it carries the token.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { classes, elements } from "../markup.js";
import { stagingWire } from "../wire/wire.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../wire/wire.js").FakeResponse} FakeResponse */

//: The class token that dims a value shown from a reading that is not current.
const STALE = "stale";

/** One turn of the event loop. */
export const turn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Yield turns of the event loop until `done()` reads true or the turns run out.
 *
 * @param {() => boolean} done
 * @param {number} [turns]
 */
export async function until(done, turns = 100) {
  for (let i = 0; i < turns && !done(); i += 1) await turn();
}

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const inside = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/**
 * Whether each element `shows` picks out of a render carries the stale mark, in document order.
 *
 * @param {string} out  the rendered markup
 * @param {(e: MarkupElement) => boolean} shows  whether an element is one that shows a value
 * @returns {boolean[]}
 */
export function marksOn(out, shows) {
  const drawn = elements(out);
  const marks = drawn.filter((e) => classes(e).includes(STALE));
  return drawn
    .filter(shows)
    .sort((a, b) => a.start - b.start)
    .map((shown) => marks.some((m) => inside(m, shown) || inside(shown, m)));
}

/**
 * A daemon on one form route that answers its reads with `before` until a write, answers the write with `written`,
 * and holds the read after it until `release()` is called, then answers it with `after`; `asked()` reads whether that
 * read has been requested.
 *
 * @param {{ path: string, before: FakeResponse, written: FakeResponse, after: FakeResponse }} d
 */
export function heldReadbackWire({ path, before, written, after }) {
  let wrote = false;
  let requested = false;
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const wire = stagingWire({
    routes: (at, opts) => {
      if (at !== path) return undefined;
      if (opts.method === "POST") {
        wrote = true;
        return written;
      }
      if (!wrote) return before;
      requested = true;
      return held.then(() => after);
    },
  });
  return { wire, release, asked: () => requested };
}
