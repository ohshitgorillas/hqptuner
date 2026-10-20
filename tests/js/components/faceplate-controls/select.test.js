// Rendered suite for hqptuner/static/components/faceplate/controls/Select.js, the select every surface draws: which
// option it shows picked, what a pick reaches and what the box shows when the owner does not take it, what an
// unavailable option and Off take away, and what the wheel does.
//
// Renders through preact-render-to-string. A gesture is delivered through the vnode seam
// (tests/js/support/vnodeseam.js) the way a browser delivers it to a native select: a pick moves the selection, then
// fires input and change; a wheel bubbles to every wheel listener of the select's own markup, then, unless canceled or
// the select lost focus, moves the selection one option down and fires input and change. The select element is a plain
// object handed to the select's ref and carried as the event target, so what the select writes back to it is what a
// user would see. `document` and `window` exist only for one gesture.
//
// Gap, for the playwright hand-back: a select that snaps back by re-rendering rather than by writing the element needs
// effects and a live DOM, which server rendering never has; this suite reads only the element it handed over.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-controls/select.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Select } from "../../../../hqptuner/static/components/faceplate/controls/Select.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../../../hqptuner/static/components/faceplate/controls/types.js").Opt} Opt */

/** The select's name, as the owner hands it in. */
const NAME = "fixture select";

/** @type {Opt[]} */
const THREE = [
  { value: "red", label: "Red" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
];

/** The value the owner holds unless a case says otherwise. */
const HELD = "green";

/** A value no option of THREE carries. */
const UNMATCHED = "violet";

/** @typedef {{ options: Opt[], value: string, aria: string, off?: boolean, onPick: (v: string) => void }} Props */

/**
 * The select's props, with the defaults every case below starts from.
 *
 * @param {Partial<Props>} [over]
 * @returns {Props}
 */
const props = (over = {}) => ({
  options: THREE,
  value: HELD,
  aria: NAME,
  off: false,
  onPick: () => {},
  ...over,
});

/**
 * Every element of one render of the select.
 *
 * @param {Partial<Props>} [over]
 * @returns {MarkupElement[]}
 */
const markup = (over) => elements(render(html`<${Select} ...${props(over)} />`));

/**
 * The select's option elements, in document order, keeping only those carrying a value the owner handed in.
 *
 * @param {Partial<Props>} [over]
 */
function optionsOf(over = {}) {
  const known = (over.options ?? THREE).map((o) => o.value);
  return markup(over).filter((e) => e.name === "option" && known.includes(attr(e, "value") ?? ""));
}

// --- gestures ----------------------------------------------------------------------------------------------------

/** @typedef {{ type: "focus" } | { type: "pick", value: string } | { type: "wheel" }} Gesture */

/** The select element as a browser holds it: its options and which one is selected. */
class FakeSelect {
  /**
   * @param {string[]} values
   * @param {string} value
   */
  constructor(values, value) {
    this.values = values;
    this.tagName = "SELECT";
    this.type = "select-one";
    this.disabled = false;
    this.selectedIndex = values.indexOf(value);
    /** @type {(() => void) | null} */
    this.onBlurred = null;
  }

  /** The selected option's value, or blank when none is selected. */
  get value() {
    return this.selectedIndex < 0 ? "" : this.values[this.selectedIndex];
  }

  /** Selects the option carrying `v`, or none when no option carries it. */
  set value(v) {
    this.selectedIndex = this.values.indexOf(String(v));
  }

  blur() {
    if (this.onBlurred) this.onBlurred();
  }

  focus() {}

  addEventListener() {}

  removeEventListener() {}
}

/**
 * A DOM event as a handler receives it.
 *
 * @param {string} type
 * @param {FakeSelect} el
 * @param {Record<string, unknown>} [extra]
 */
function event(type, el, extra = {}) {
  const ev = {
    type,
    target: el,
    currentTarget: el,
    defaultPrevented: false,
    cancelable: true,
    preventDefault() {
      ev.defaultPrevented = true;
    },
    stopPropagation() {},
    ...extra,
  };
  return ev;
}

/**
 * The vnodes from `node` out to the outermost element of the same render: the chain a wheel bubbles along.
 *
 * @param {VNode[]} seen
 * @param {VNode} node
 * @returns {VNode[]}
 */
function ancestry(seen, node) {
  /** @param {unknown} kids */
  const flat = (kids) => (Array.isArray(kids) ? kids.flat(Infinity) : [kids]);
  /** @type {VNode[]} */
  const chain = [node];
  let at = node;
  for (;;) {
    const here = at;
    const parent = seen.find((v) => flat(propsOf(v).children).includes(here));
    if (!parent) return chain;
    chain.push(parent);
    at = parent;
  }
}

/**
 * Calls one handler prop with an event, when the vnode carries it.
 *
 * @param {VNode} node
 * @param {string} name
 * @param {unknown} ev
 */
function fire(node, name, ev) {
  const fn = propsOf(node)[name];
  if (typeof fn === "function") fn(ev);
}

/**
 * Hands the select element to the select's ref, object or callback, as mounting would.
 *
 * @param {VNode} box
 * @param {FakeSelect} el
 */
function attach(box, el) {
  const ref = /** @type {{ ref?: unknown }} */ (/** @type {unknown} */ (box)).ref;
  if (typeof ref === "function") ref(el);
  else if (ref && typeof ref === "object") /** @type {{ current: unknown }} */ (ref).current = el;
}

/** One mounted select and the browser around it: the element, the document's focus, and the dispatch rules. */
class Browser {
  /**
   * @param {VNode[]} seen
   * @param {VNode} box
   * @param {string[]} values
   * @param {string} value
   */
  constructor(seen, box, values, value) {
    this.seen = seen;
    this.box = box;
    this.el = new FakeSelect(values, value);
    this.body = {};
    this.doc = { activeElement: /** @type {unknown} */ (this.body), body: this.body };
    this.el.onBlurred = () => {
      this.doc.activeElement = this.body;
      fire(box, "onBlur", event("blur", this.el));
    };
    attach(box, this.el);
  }

  /** The selection moved: input, then change. */
  moved() {
    fire(this.box, "onInput", event("input", this.el));
    fire(this.box, "onChange", event("change", this.el));
  }

  focus() {
    this.doc.activeElement = this.el;
    fire(this.box, "onFocus", event("focus", this.el));
  }

  /** @param {string} value */
  pick(value) {
    this.el.value = value;
    this.moved();
  }

  wheel() {
    const ev = event("wheel", this.el, { deltaY: 100, deltaX: 0, deltaMode: 0 });
    for (const node of ancestry(this.seen, this.box)) fire(node, "onWheel", ev);
    if (ev.defaultPrevented || this.doc.activeElement !== this.el) return;
    if (this.el.selectedIndex + 1 >= this.el.values.length) throw new Error("the wheel has no option to move to");
    this.el.selectedIndex += 1;
    this.moved();
  }

  /** @param {Gesture} g */
  perform(g) {
    if (g.type === "pick") this.pick(g.value);
    else this[g.type]();
  }

  /**
   * Runs the gestures with `document` and `window` present, restoring both afterwards.
   *
   * @param {Gesture[]} gestures
   */
  run(gestures) {
    const g = /** @type {Record<string, unknown>} */ (globalThis);
    const before = { document: g.document, window: g.window };
    g.document = this.doc;
    g.window = { scrollBy() {}, scroll() {} };
    try {
      for (const gesture of gestures) this.perform(gesture);
    } finally {
      g.document = before.document;
      g.window = before.window;
    }
  }
}

/**
 * What a user's gestures on the select reach: the values reported to the owner, and the value the select shows after
 * the last gesture. The owner never changes the value it holds. Undefined when the render draws no select.
 *
 * @param {Gesture[]} gestures
 * @param {Partial<Props>} [over]
 * @returns {{ picks: string[], shown: string } | undefined}
 */
function drive(gestures, over = {}) {
  /** @type {string[]} */
  const picks = [];
  const p = props({ ...over, onPick: (v) => picks.push(v) });
  const { seen } = renderTree(html`<${Select} ...${p} />`);
  const box = seen.find((v) => v.type === "select");
  if (!box) return undefined;
  const browser = new Browser(
    seen,
    box,
    p.options.map((o) => o.value),
    p.value,
  );
  browser.run(gestures);
  return { picks, shown: browser.el.value };
}

// --- the value the owner holds -----------------------------------------------------------------------------------

const SHOWN = [
  { name: "the_select_shows_the_owners_value_picked", value: "green", want: [false, true, false] },
  {
    name: "the_select_shows_another_value_picked_when_the_owner_holds_another",
    value: "blue",
    want: [false, false, true],
  },
];

for (const row of SHOWN) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(
      optionsOf({ value: row.value }).map((e) => hasAttr(e, "selected")),
      row.want,
    );
  });
}

test("test_a_value_matching_no_option_shows_no_option_picked", () => {
  assert.deepEqual(
    optionsOf({ value: UNMATCHED }).map((e) => hasAttr(e, "selected")),
    [false, false, false],
  );
});

// --- a pick ------------------------------------------------------------------------------------------------------

const PICKS = [
  { name: "a_pick_reports_the_picked_value_to_the_owner", value: "red" },
  { name: "a_pick_of_another_option_reports_that_value_to_the_owner", value: "blue" },
];

for (const row of PICKS) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(drive([{ type: "focus" }, { type: "pick", value: row.value }])?.picks, [row.value]);
  });
}

const SNAPS = [
  { name: "a_pick_the_owner_does_not_take_snaps_back_to_the_owners_value", held: "green", pick: "red" },
  { name: "a_refused_pick_snaps_back_to_another_value_when_the_owner_holds_another", held: "red", pick: "blue" },
];

for (const row of SNAPS) {
  test(`test_${row.name}`, () => {
    const out = drive([{ type: "focus" }, { type: "pick", value: row.pick }], { value: row.held });
    assert.equal(out?.shown, row.held);
  });
}

// --- an unavailable option ---------------------------------------------------------------------------------------

/** @type {Opt[]} */
const ONE_UNAVAILABLE = [
  { value: "red", label: "Red" },
  { value: "green", label: "Green", disabled: true },
  { value: "blue", label: "Blue" },
];

test("test_an_option_its_list_marks_unavailable_still_shows", () => {
  assert.deepEqual(
    optionsOf({ options: ONE_UNAVAILABLE, value: "red" }).map((e) => attr(e, "value")),
    ["red", "green", "blue"],
  );
});

test("test_only_the_option_its_list_marks_unavailable_cannot_be_picked", () => {
  assert.deepEqual(
    optionsOf({ options: ONE_UNAVAILABLE, value: "red" }).map((e) => hasAttr(e, "disabled")),
    [false, true, false],
  );
});

// --- the wheel ---------------------------------------------------------------------------------------------------

test("test_the_wheel_over_the_focused_select_reports_nothing", () => {
  assert.deepEqual(drive([{ type: "focus" }, { type: "wheel" }])?.picks, []);
});

// --- Off ---------------------------------------------------------------------------------------------------------

const OFF_GRAYS = [
  { name: "an_off_select_is_grayed_whole", off: true, want: true },
  { name: "an_on_select_is_not_grayed", off: false, want: false },
];

for (const row of OFF_GRAYS) {
  test(`test_${row.name}`, () => {
    const outer = markup({ off: row.off }).at(-1);
    assert.equal(outer ? classes(outer).includes("grayed") : undefined, row.want);
  });
}

const OFF_TAKES = [
  { name: "an_off_select_takes_no_pick", off: true, want: true },
  { name: "an_on_select_takes_a_pick", off: false, want: false },
];

for (const row of OFF_TAKES) {
  test(`test_${row.name}`, () => {
    const box = markup({ off: row.off }).find((e) => e.name === "select");
    assert.equal(box ? hasAttr(box, "disabled") : undefined, row.want);
  });
}
