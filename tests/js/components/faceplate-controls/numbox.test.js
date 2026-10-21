// Rendered suite for hqptuner/static/components/faceplate/controls/NumBox.js, the number box every surface draws:
// when a typed value commits and as what, what the box shows after a commit or a refused one, what the wheel does,
// what Off takes away, and what the box carries for a screen reader and for its caller.
//
// Renders through preact-render-to-string. A gesture is delivered through the vnode seam
// (tests/js/support/vnodeseam.js) the way a browser delivers it to a focused number input: typing fires keydown and
// input per character; Enter fires keydown, then change when the text moved; leaving fires change when the text moved,
// then blur; a wheel bubbles to every wheel listener of the box's own markup, then, unless canceled or the box lost
// focus, steps the value and fires input and change. The input element is a plain object handed to the box's ref, so
// what the box writes back to it is what a user would see. `document` and `window` exist only for one gesture.
//
// Gap, for the playwright hand-back: a poll arriving while the box is being edited, and the box taking its owner's
// value again once it is not, need effects to run, which server rendering never does. Closed by a browser case that
// types, changes the owner's value, and reads the box before and after blur.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-controls/numbox.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { NumBox } from "../../../../hqptuner/static/components/faceplate/controls/NumBox.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attach, domEvent as event, fire, wheelAt } from "../../support/wheel.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */

/** The box's name, as the owner hands it in. */
const NAME = "fixture number";

/** The value the owner holds unless a case says otherwise. */
const HELD = "20";

/** The box's bounds and step. */
const MIN = 0;
const MAX = 50;
const STEP = 1;

/**
 * @typedef {{ value: string, aria: string, unit?: string, hint?: string, min?: number, max?: number, step?: number,
 *   off?: boolean, k?: string, testid?: string, onCommit: (v: number) => number | void }} Props
 */

/**
 * The box's props, with the defaults every case below starts from.
 *
 * @param {Partial<Props>} [over]
 * @returns {Props}
 */
const props = (over = {}) => ({
  value: HELD,
  aria: NAME,
  min: MIN,
  max: MAX,
  step: STEP,
  off: false,
  onCommit: () => {},
  ...over,
});

/**
 * Every element of one render of the box.
 *
 * @param {Partial<Props>} [over]
 * @returns {MarkupElement[]}
 */
const markup = (over) => elements(render(html`<${NumBox} ...${props(over)} />`));

/**
 * The box's input element in one render.
 *
 * @param {Partial<Props>} [over]
 */
const input = (over) => markup(over).find((e) => e.name === "input");

// --- gestures ----------------------------------------------------------------------------------------------------

/**
 * One gesture a user makes on the box.
 *
 * @typedef {{ type: "focus" } | { type: "type", chars: string } | { type: "clear" } | { type: "enter" }
 *   | { type: "leave" } | { type: "wheel" }} Gesture
 */

/** The input element as a browser holds it: its text, and whether it has focus. */
class FakeInput {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
    this.type = "number";
    this.tagName = "INPUT";
    this.disabled = false;
    /** @type {(() => void) | null} */
    this.onBlurred = null;
  }

  /** The browser's numeric reading of the text: NaN for blank or non-numeric text. */
  get valueAsNumber() {
    return this.value.trim() === "" ? NaN : Number(this.value);
  }

  set valueAsNumber(n) {
    this.value = String(n);
  }

  blur() {
    if (this.onBlurred) this.onBlurred();
  }

  focus() {}

  addEventListener() {}

  removeEventListener() {}
}

/** One mounted box and the browser around it: the element, the document's focus, and the dispatch rules. */
class Browser {
  /**
   * @param {VNode[]} seen
   * @param {VNode} box
   * @param {string} value
   */
  constructor(seen, box, value) {
    this.seen = seen;
    this.box = box;
    this.el = new FakeInput(value);
    this.body = {};
    this.doc = { activeElement: /** @type {unknown} */ (this.body), body: this.body };
    this.atFocus = value;
    this.el.onBlurred = () => {
      this.doc.activeElement = this.body;
      fire(box, "onBlur", event("blur", this.el));
    };
    attach(box, this.el);
  }

  /** A change event, fired only when the text moved since the last one. */
  changed() {
    if (this.el.value === this.atFocus) return;
    this.atFocus = this.el.value;
    fire(this.box, "onChange", event("change", this.el));
  }

  focus() {
    this.doc.activeElement = this.el;
    this.atFocus = this.el.value;
    fire(this.box, "onFocus", event("focus", this.el));
  }

  /** @param {string} chars */
  type(chars) {
    for (const ch of chars) {
      fire(this.box, "onKeyDown", event("keydown", this.el, { key: ch }));
      this.el.value += ch;
      fire(this.box, "onInput", event("input", this.el));
    }
  }

  clear() {
    this.el.value = "";
    fire(this.box, "onInput", event("input", this.el));
  }

  enter() {
    fire(this.box, "onKeyDown", event("keydown", this.el, { key: "Enter" }));
    this.changed();
  }

  leave() {
    this.changed();
    if (this.doc.activeElement === this.el) this.el.blur();
  }

  wheel() {
    wheelAt({ seen: this.seen, node: this.box, el: this.el, doc: this.doc }, -100, () => {
      this.el.value = String(Number(this.el.value) + STEP);
      fire(this.box, "onInput", event("input", this.el));
      this.changed();
    });
  }

  /** @param {Gesture} g */
  perform(g) {
    if (g.type === "type") this.type(g.chars);
    else this[g.type]();
  }

  /** @param {Gesture[]} gestures */
  run(gestures) {
    for (const gesture of gestures) this.perform(gesture);
  }
}

/**
 * What a user's gestures on the box reach: the values committed to the owner, and the text the box shows after the
 * last gesture. Undefined when the render draws no input.
 *
 * @param {Gesture[]} gestures
 * @param {Partial<Props> & { landed?: (v: number) => number | void }} [over]
 * @returns {{ commits: number[], shown: string } | undefined}
 */
function drive(gestures, over = {}) {
  /** @type {number[]} */
  const commits = [];
  const { landed, ...rest } = over;
  const onCommit = (/** @type {number} */ v) => {
    commits.push(v);
    return landed ? landed(v) : undefined;
  };
  const p = props({ ...rest, onCommit });
  const { seen } = renderTree(html`<${NumBox} ...${p} />`);
  const box = seen.find((v) => v.type === "input");
  if (!box) return undefined;
  const browser = new Browser(seen, box, p.value);
  browser.run(gestures);
  return { commits, shown: browser.el.value };
}

/** Focus, clear the box, type `chars`. */
const typed = (/** @type {string} */ chars) =>
  /** @type {Gesture[]} */ ([{ type: "focus" }, { type: "clear" }, { type: "type", chars }]);

// --- when a value commits ----------------------------------------------------------------------------------------

test("test_typing_then_leaving_the_box_commits_the_whole_number_once", () => {
  assert.deepEqual(drive([...typed("12"), { type: "leave" }])?.commits, [12]);
});

test("test_typing_then_enter_commits_the_whole_number_once", () => {
  assert.deepEqual(drive([...typed("34"), { type: "enter" }])?.commits, [34]);
});

// --- blank or non-numeric ----------------------------------------------------------------------------------------

const UNCOMMITTABLE = [
  { name: "a_blank_box_commits_nothing", chars: "" },
  { name: "a_non_numeric_box_commits_nothing", chars: "abc" },
];

for (const row of UNCOMMITTABLE) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(drive([...typed(row.chars), { type: "leave" }])?.commits, []);
  });
}

const RESTORED = [
  { name: "a_blank_box_shows_the_owners_value_again", chars: "", value: "20" },
  { name: "a_non_numeric_box_shows_the_owners_value_again", chars: "abc", value: "35" },
];

for (const row of RESTORED) {
  test(`test_${row.name}`, () => {
    assert.equal(drive([...typed(row.chars), { type: "leave" }], { value: row.value })?.shown, row.value);
  });
}

// --- bounds ------------------------------------------------------------------------------------------------------

const CLAMPED = [
  { name: "a_number_above_the_maximum_commits_as_the_maximum", chars: "80", want: MAX },
  { name: "a_number_below_the_minimum_commits_as_the_minimum", chars: "-5", want: MIN },
];

for (const row of CLAMPED) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(drive([...typed(row.chars), { type: "leave" }])?.commits, [row.want]);
  });
}

// --- the value that landed ---------------------------------------------------------------------------------------

const LANDED = [
  { name: "after_a_commit_the_box_shows_the_value_that_landed", chars: "7", lands: 6 },
  { name: "after_a_commit_the_box_shows_another_landed_value_when_the_owner_lands_another", chars: "3", lands: 4 },
];

for (const row of LANDED) {
  test(`test_${row.name}`, () => {
    const out = drive([...typed(row.chars), { type: "leave" }], { landed: () => row.lands });
    assert.equal(out?.shown, String(row.lands));
  });
}

// --- the wheel ---------------------------------------------------------------------------------------------------

test("test_the_wheel_over_the_focused_box_commits_nothing", () => {
  assert.deepEqual(drive([{ type: "focus" }, { type: "wheel" }, { type: "leave" }])?.commits, []);
});

// --- Off ---------------------------------------------------------------------------------------------------------

const OFF_GRAYS = [
  { name: "an_off_box_is_grayed_whole", off: true, want: true },
  { name: "an_on_box_is_not_grayed", off: false, want: false },
];

for (const row of OFF_GRAYS) {
  test(`test_${row.name}`, () => {
    const outer = markup({ off: row.off }).at(-1);
    assert.equal(outer ? classes(outer).includes("grayed") : undefined, row.want);
  });
}

const OFF_TAKES = [
  { name: "an_off_box_takes_no_typing", off: true, want: true },
  { name: "an_on_box_takes_typing", off: false, want: false },
];

for (const row of OFF_TAKES) {
  test(`test_${row.name}`, () => {
    const box = input({ off: row.off });
    assert.equal(box ? hasAttr(box, "disabled") : undefined, row.want);
  });
}

// --- what the box carries ----------------------------------------------------------------------------------------

const NAMES = [
  { name: "the_box_is_named_by_its_caller", aria: "fixture number" },
  { name: "the_box_takes_another_name_from_another_caller", aria: "second fixture number" },
];

for (const row of NAMES) {
  test(`test_${row.name}`, () => {
    const box = input({ aria: row.aria });
    assert.equal(box ? attr(box, "aria-label") : undefined, row.aria);
  });
}

/**
 * Whether some element of the render reads exactly `want`.
 *
 * @param {Partial<Props>} over
 * @param {string} want
 */
const reads = (over, want) => markup(over).some((e) => text(e) === want);

const UNITS = [
  { name: "the_box_shows_the_unit_its_caller_gives", unit: "fixture-unit-a" },
  { name: "the_box_shows_another_unit_from_another_caller", unit: "fixture-unit-b" },
];

for (const row of UNITS) {
  test(`test_${row.name}`, () => {
    assert.equal(reads({ unit: row.unit }, row.unit), true);
  });
}

const HINTS = [
  { name: "the_box_shows_the_hint_its_caller_gives", hint: "fixture hint a" },
  { name: "the_box_shows_another_hint_from_another_caller", hint: "fixture hint b" },
];

for (const row of HINTS) {
  test(`test_${row.name}`, () => {
    assert.equal(reads({ hint: row.hint }, row.hint), true);
  });
}

const KEYS = [
  { name: "the_box_emits_the_setting_key_its_caller_gives", k: "fixture_key_a" },
  { name: "the_box_emits_another_setting_key_from_another_caller", k: "fixture_key_b" },
];

for (const row of KEYS) {
  test(`test_${row.name}`, () => {
    const carriers = markup({ k: row.k }).filter((e) => attr(e, "data-k") !== undefined);
    assert.deepEqual(
      carriers.map((e) => attr(e, "data-k")),
      [row.k],
    );
  });
}

const TESTIDS = [
  { name: "the_box_emits_the_test_id_its_caller_gives", testid: "fixture-testid-a" },
  { name: "the_box_emits_another_test_id_from_another_caller", testid: "fixture-testid-b" },
];

for (const row of TESTIDS) {
  test(`test_${row.name}`, () => {
    const carriers = markup({ testid: row.testid }).filter((e) => attr(e, "data-testid") !== undefined);
    assert.deepEqual(
      carriers.map((e) => attr(e, "data-testid")),
      [row.testid],
    );
  });
}
