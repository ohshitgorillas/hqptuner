// Behavioral suite for the page seam of lib/dom.js: each helper reaches the page its control lives in, never a global
// one, and keeps what it learns about a page for that page (docs/superpowers/specs/rebuild-integrate-design.md,
// Modules, `lib/dom.js`; Homes, "Gesture provenance" and "Page access from production code").
//
// Two fake pages from tests/js/support/page.js stand side by side, and no page is installed on `globalThis`: under
// `node --test` there is no `document` or `window`, so a helper that reached for one would fail here. Gestures are
// dispatched on the fake page's own elements, reaching the document's capture listeners as a browser's would.
//
// preact's client `render` compares its host with the global `document` before it mounts, so for the length of each
// `render` call alone the global holds a stand-in that throws on any member read: preact's comparison passes, and a
// hook that reads the global document while mounting still fails here.
//
// The slider policy itself (which gestures lend provenance) is owned by tests/js/lib/useredit.test.js and
// tests/js/lib/useredit-focus.test.js; this file pins only whose page a gesture, a scroll or a focus belongs to.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/dom-perpage.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { h, options, render } from "preact";

import { useSyncWhenIdle, userEdit, watchGestures, wheelGuard } from "../../../hqptuner/static/lib/dom.js";
import { fakeClock } from "../support/clock.js";
import { fakePage } from "../support/page.js";

/** The value the slider is rendering, which a refused edit snaps back to. */
const CANONICAL = "50";
/** Where the browser has already moved the thumb when the edit's event fires. */
const MOVED = "63";
const PRIMARY_BUTTON = 0;
const PRIMARY_HELD = 1;
const NO_BUTTONS = 0;
const WHEEL_DELTA = 120;

/** @typedef {ReturnType<typeof fakePage>} Page */

/** @returns {Page} */
const newPage = () => fakePage({ clock: fakeClock().clock });

/**
 * Two pages, each watched once, `b` last.
 *
 * @returns {{ a: Page, b: Page }}
 */
function watchedPair() {
  const a = newPage();
  const b = newPage();
  watchGestures(a.doc);
  watchGestures(b.doc);
  return { a, b };
}

/**
 * A range slider in `page`'s body, its thumb already moved off the canonical value.
 *
 * @param {Page} page
 */
function slider(page) {
  const el = page.doc.createElement("input");
  Object.assign(el, { type: "range", value: MOVED });
  page.doc.body.appendChild(el);
  return el;
}

/**
 * The edit a slider's own handler makes: `fn` run through userEdit, counted when it runs.
 *
 * @param {any} el
 * @returns {{ edit: () => void, runs: () => number }}
 */
function editor(el) {
  let n = 0;
  return {
    edit: () => userEdit(el, CANONICAL, () => void (n += 1)),
    runs: () => n,
  };
}

/** @param {any} el @param {string} type @param {Record<string, unknown>} [extra] */
const dispatch = (el, type, extra = {}) => el.dispatchEvent({ type, bubbles: true, cancelable: true, ...extra });

/** @param {any} el */
const press = (el) => dispatch(el, "pointerdown", { button: PRIMARY_BUTTON, buttons: PRIMARY_HELD });
/** @param {any} el */
const release = (el) => dispatch(el, "pointerup", { button: PRIMARY_BUTTON, buttons: NO_BUTTONS });
/** @param {any} el */
const glideUnheld = (el) => dispatch(el, "pointermove", { buttons: NO_BUTTONS });
/**
 * Focuses `el` on its own page; the fake page fires `focus` and `focusin` as a browser does.
 *
 * @param {any} el
 */
const focus = (el) => el.focus();

// --- watchGestures: one call per document, state kept for that document ----------------------------------------------

// Breaks when a second document's watch replaces the first one's, or the first call's listeners are dropped.
test("test_a_page_watched_before_another_still_gives_its_held_pointer_provenance", () => {
  const { a } = watchedPair();
  const el = slider(a);
  const { edit, runs } = editor(el);
  press(el);
  edit();
  assert.equal(runs(), 1);
});

test("test_each_watched_page_gives_provenance_to_a_pointer_held_on_it", () => {
  const { b } = watchedPair();
  const el = slider(b);
  const { edit, runs } = editor(el);
  press(el);
  edit();
  assert.equal(runs(), 1);
});

// A buttonless pointer move ends a drag on the page it happens on. Breaks when gesture state is shared across
// documents, so a pointer passing over one page cuts a drag held on another.
test("test_a_buttonless_pointermove_on_another_page_leaves_this_page_s_drag_alive", () => {
  const { a, b } = watchedPair();
  const el = slider(a);
  const { edit, runs } = editor(el);
  press(el);
  glideUnheld(b.doc.body);
  // An ended drag lets one edit through and no more, so this edit, the second, runs only while the drag lives.
  editor(el).edit();
  edit();
  assert.equal(runs(), 1);
});

// Each document has its own focused element. Breaks when the focus that gates a slider key is tracked once for all
// documents, so focusing a control on another page takes this page's slider out of focus.
test("test_focus_moving_on_another_page_leaves_this_page_s_slider_key_its_provenance", () => {
  const { a, b } = watchedPair();
  const el = slider(a);
  const other = slider(b);
  const { edit, runs } = editor(el);
  focus(el);
  focus(other);
  dispatch(el, "keydown", { key: "ArrowUp" });
  edit();
  assert.equal(runs(), 1);
});

// --- userEdit: reads the gesture state of el.ownerDocument -----------------------------------------------------------

// The release arm lets exactly the committing change through. Breaks when userEdit reads the gestures of the last
// watched document, or of any document but the control's own.
test("test_a_drag_released_on_the_control_s_own_page_lets_exactly_one_edit_through", () => {
  const { a } = watchedPair();
  const el = slider(a);
  const { edit, runs } = editor(el);
  press(el);
  release(el);
  edit();
  edit();
  assert.equal(runs(), 1);
});

// Breaks when a pointer held on another document lends provenance to this one's control.
test("test_a_pointer_held_on_another_page_lends_no_provenance", () => {
  const { a, b } = watchedPair();
  const el = slider(a);
  const { edit, runs } = editor(el);
  press(slider(b));
  edit();
  assert.equal(runs(), 0);
});

// Breaks when a refused edit leaves the thumb where the browser moved it instead of snapping it back.
test("test_an_edit_refused_on_its_own_page_snaps_the_control_back_to_canonical", () => {
  const { a, b } = watchedPair();
  const el = slider(a);
  press(slider(b));
  editor(el).edit();
  assert.equal(el.value, CANONICAL);
});

// --- wheelGuard: scrolls the event target's window -------------------------------------------------------------------

/**
 * A wheel over a control of `page`, its guard on the control, as the browser dispatches one.
 *
 * @param {Page} page
 * @returns {boolean} false when the wheel's default action was canceled
 */
function wheelOver(page) {
  const el = slider(page);
  el.addEventListener("wheel", wheelGuard);
  return dispatch(el, "wheel", { deltaX: 0, deltaY: WHEEL_DELTA, deltaMode: 0 });
}

// Breaks when the guard scrolls a global window, which this process does not have.
test("test_a_wheel_over_a_control_scrolls_the_control_s_window_by_its_delta", () => {
  const a = newPage();
  wheelOver(a);
  assert.deepEqual([a.win.scrollX, a.win.scrollY], [0, WHEEL_DELTA]);
});

// Breaks when the guard scrolls one fixed window, such as the first one it scrolled, whichever page the wheel came
// over. Page a is wheeled first, so the guard has seen its window, then scrolled back before the wheel over page b.
test("test_a_wheel_over_one_page_leaves_another_page_s_window_where_it_was", () => {
  const a = newPage();
  const b = newPage();
  wheelOver(a);
  a.win.scrollTo(0, 0);
  wheelOver(b);
  assert.deepEqual([a.win.scrollX, a.win.scrollY], [0, 0]);
});

// Breaks when the guard throws before canceling, as one reaching for a global window would.
test("test_a_wheel_over_a_control_of_a_page_is_canceled", () => {
  assert.equal(wheelOver(newPage()), false);
});

// --- useSyncWhenIdle: compares against its input's own document's active element -------------------------------------

/**
 * The global preact's `render` compares its host with, viewed as an optional member: under `node --test` there is
 * none, and the DOM lib declares it as always present and fully shaped.
 *
 * @type {{ document?: unknown }}
 */
const env = globalThis;

/** A global document no code may read: every member read throws, naming the member. */
const UNREADABLE = new Proxy(
  {},
  {
    get(_target, key) {
      throw new Error(`the global document was read: ${String(key)}`);
    },
  },
);

/**
 * Run preact's `render` with the unreadable stand-in on the global, then take it away again.
 *
 * @param {() => void} run
 */
function withRenderGlobal(run) {
  env.document = UNREADABLE;
  try {
    run();
  } finally {
    delete env.document;
  }
}

/**
 * The hook's host: binds the returned ref to `box`, as preact binds an element's `ref`.
 *
 * @param {{ value: string | number | null, box: unknown }} props
 */
function Synced({ value, box }) {
  /** @type {{ current: unknown }} */ (/** @type {unknown} */ (useSyncWhenIdle(value))).current = box;
  return null;
}

/**
 * A number box on `page` and a painter that renders the hook over it, then runs the effects the browser runs after
 * the paint, through preact's `options.requestAnimationFrame` seam. `paint` returns what the box shows once the
 * effects have run, or, when the render or an effect threw, `threw <name>: <message>`, so a case reads one sequence.
 *
 * @param {Page} page
 */
function boxOn(page) {
  const box = page.doc.createElement("input");
  Object.assign(box, { type: "text", value: "" });
  page.doc.body.appendChild(box);
  const host = page.doc.createElement("div");
  /**
   * @param {string | number | null} value
   * @returns {string}
   */
  const paint = (value) => {
    /** @type {Array<() => void>} */
    const effects = [];
    const raf = options.requestAnimationFrame;
    options.requestAnimationFrame = (/** @type {() => void} */ run) => effects.push(run);
    try {
      try {
        withRenderGlobal(() => render(h(Synced, { value, box }), host));
      } finally {
        options.requestAnimationFrame = raf;
      }
      for (const run of effects) run();
    } catch (err) {
      const e = /** @type {Error} */ (err);
      return `threw ${e.name}: ${e.message}`;
    }
    return box.value;
  };
  return { box, paint };
}

// Breaks when the hook reads a global document's active element, which this process does not have, or another page's.
test("test_a_box_focused_on_its_own_page_keeps_its_typed_text_across_a_new_value", () => {
  const a = newPage();
  const b = newPage();
  const { box, paint } = boxOn(a);
  const shown = [paint(5)];
  box.focus();
  slider(b).focus();
  box.value = "-1";
  shown.push(paint(7));
  assert.deepEqual(shown, ["5", "-1"]);
});

// Breaks when the hook treats a box as focused because some other page has an element focused.
test("test_a_box_not_focused_on_its_own_page_shows_the_new_value", () => {
  const a = newPage();
  const b = newPage();
  const { paint } = boxOn(a);
  slider(b).focus();
  assert.deepEqual([paint(5), paint(7)], ["5", "7"]);
});
