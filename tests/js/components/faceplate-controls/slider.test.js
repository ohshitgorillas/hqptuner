// Rendered suite for hqptuner/static/components/faceplate/controls/Slider.js, the slider every surface draws: a track
// and a number box over one value, what each shows, what the box commits and as what, what the wheel and an edit
// nobody made take away, and what Off takes away.
//
// Renders through preact-render-to-string. A gesture is delivered through the vnode seam
// (tests/js/support/vnodeseam.js) the way a browser delivers it: the box's text is typed and left, a wheel bubbles to
// every wheel listener of the slider's own markup (tests/js/support/wheel.js) and, unless canceled, moves the focused
// range and fires input and change. The elements are plain objects carried as the event target, so what the slider
// writes back to them is what a user would see.
//
// Not reachable here: the track moving under a held pointer or a pressed key, and the move and release it reports. The
// provenance of an edit is kept by document listeners that lib/dom.js installs when it loads, and no suite installs a
// document before that import. A browser run closes these.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-controls/slider.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Slider } from "../../../../hqptuner/static/components/faceplate/controls/Slider.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attach, domEvent as event, fire, wheelAt } from "../../support/wheel.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */

/** The slider's name, as the owner hands it in. */
const NAME = "fixture slider";

/** The value the owner holds unless a case says otherwise. */
const HELD = "20";

/** The slider's bounds and step. */
const MIN = 0;
const MAX = 50;
const STEP = 1;

/**
 * @typedef {{ value: string, aria: string, min: number, max: number, step: number, dp?: number, unit?: string,
 *   off?: boolean, cls?: string, k?: string, testid?: string, onMove: (v: number) => void,
 *   onCommit: (v: number) => number | void }} Props
 */

/**
 * The slider's props, with the defaults every case below starts from.
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
  onMove: () => {},
  onCommit: () => {},
  ...over,
});

/**
 * Every element of one render of the slider.
 *
 * @param {Partial<Props>} [over]
 * @returns {MarkupElement[]}
 */
const markup = (over) => elements(render(html`<${Slider} ...${props(over)} />`));

/**
 * The slider's input elements in one render: the track and the box.
 *
 * @param {Partial<Props>} [over]
 */
const inputs = (over) => {
  const all = markup(over).filter((e) => e.name === "input");
  return { track: all.find((e) => attr(e, "type") === "range"), box: all.find((e) => attr(e, "type") === "number") };
};

// --- gestures ----------------------------------------------------------------------------------------------------

/** An input element as a browser holds it: its text, and whether it has focus. */
class FakeInput {
  /**
   * @param {string} type
   * @param {string} value
   */
  constructor(type, value) {
    this.type = type;
    this.value = value;
    this.tagName = "INPUT";
    this.disabled = false;
  }

  /** The browser's numeric reading of the text: NaN for blank or non-numeric text. */
  get valueAsNumber() {
    return this.value.trim() === "" ? NaN : Number(this.value);
  }

  set valueAsNumber(n) {
    this.value = String(n);
  }

  blur() {}

  focus() {}

  addEventListener() {}

  removeEventListener() {}
}

/**
 * One mounted slider: what it reported, and the two elements it handed to the browser.
 *
 * @param {Partial<Props>} [over]
 */
function mount(over = {}) {
  /** @type {number[]} */
  const moves = [];
  /** @type {number[]} */
  const commits = [];
  const p = props({
    ...over,
    onMove: (v) => moves.push(v),
    onCommit: (v) => {
      commits.push(v);
      return over.onCommit ? over.onCommit(v) : undefined;
    },
  });
  const { seen } = renderTree(html`<${Slider} ...${p} />`);
  const trackNode = seen.find((v) => v.type === "input" && v.props.type === "range");
  const boxNode = seen.find((v) => v.type === "input" && v.props.type === "number");
  if (!trackNode || !boxNode) throw new Error("the slider draws no track and number box");
  const track = new FakeInput("range", p.value);
  const box = new FakeInput("number", p.value);
  attach(trackNode, track);
  attach(boxNode, box);
  const body = {};
  const doc = { activeElement: /** @type {unknown} */ (body), body };
  return { seen, trackNode, boxNode, track, box, doc, moves, commits };
}

/**
 * An edit the track receives: its text moved to `to`, then input and change.
 *
 * @param {ReturnType<typeof mount>} m
 * @param {string} to
 */
function nudge(m, to) {
  m.track.value = to;
  fire(m.trackNode, "onInput", event("input", m.track));
  fire(m.trackNode, "onChange", event("change", m.track));
}

/**
 * The box's text typed to `chars` and left.
 *
 * @param {ReturnType<typeof mount>} m
 * @param {string} chars
 */
function typeIn(m, chars) {
  m.box.value = chars;
  fire(m.boxNode, "onInput", event("input", m.box));
  fire(m.boxNode, "onChange", event("change", m.box));
}

// --- what it shows -----------------------------------------------------------------------------------------------

const SPAN = [
  { name: "the_track_starts_at_the_given_minimum", attr: "min", want: "2" },
  { name: "the_track_ends_at_the_given_maximum", attr: "max", want: "9" },
  { name: "the_track_moves_by_the_given_step", attr: "step", want: "0.5" },
];

for (const row of SPAN) {
  test(`test_${row.name}`, () => {
    const { track } = inputs({ min: 2, max: 9, step: 0.5 });
    assert.equal(track ? attr(track, row.attr) : undefined, row.want);
  });
}

const THUMB = [
  { name: "the_track_sits_at_the_owners_value", value: "20" },
  { name: "the_track_sits_at_another_value_when_the_owner_holds_another", value: "35" },
];

for (const row of THUMB) {
  test(`test_${row.name}`, () => {
    const { track } = inputs({ value: row.value });
    assert.equal(track ? attr(track, "value") : undefined, row.value);
  });
}

const PLACES = [
  { name: "the_box_shows_the_value_to_two_places", value: "0.5", dp: 2, want: "0.50" },
  { name: "the_box_shows_the_value_to_no_places", value: "7.4", dp: 0, want: "7" },
];

for (const row of PLACES) {
  test(`test_${row.name}`, () => {
    const { box } = inputs({ value: row.value, dp: row.dp });
    assert.equal(box ? attr(box, "value") : undefined, row.want);
  });
}

const UNITS = [
  { name: "the_slider_shows_its_unit", unit: "dB" },
  { name: "the_slider_shows_another_unit_when_given_another", unit: "ms" },
];

for (const row of UNITS) {
  test(`test_${row.name}`, () => {
    assert.ok(markup({ unit: row.unit }).some((e) => text(e) === row.unit));
  });
}

// --- the box commits ---------------------------------------------------------------------------------------------

test("test_typing_a_number_in_the_box_then_leaving_commits_it", () => {
  const m = mount();
  typeIn(m, "12");
  assert.deepEqual(m.commits, [12]);
});

const CLAMPED = [
  { name: "a_number_above_the_maximum_commits_as_the_maximum", chars: "80", want: MAX },
  { name: "a_number_below_the_minimum_commits_as_the_minimum", chars: "-5", want: MIN },
];

for (const row of CLAMPED) {
  test(`test_${row.name}`, () => {
    const m = mount();
    typeIn(m, row.chars);
    assert.deepEqual(m.commits, [row.want]);
  });
}

test("test_a_blank_box_commits_nothing", () => {
  const m = mount();
  typeIn(m, "");
  assert.deepEqual(m.commits, []);
});

// --- an edit nobody made, and the wheel --------------------------------------------------------------------------

const NOBODY_REPORTS = [
  { name: "an_edit_of_the_track_with_no_pointer_held_and_no_key_pressed_reports_no_move", of: "moves" },
  { name: "an_edit_of_the_track_with_no_pointer_held_and_no_key_pressed_reports_no_commit", of: "commits" },
];

for (const row of NOBODY_REPORTS) {
  test(`test_${row.name}`, () => {
    const m = mount();
    nudge(m, "35");
    assert.deepEqual(m[row.of === "moves" ? "moves" : "commits"], []);
  });
}

test("test_an_edit_of_the_track_with_no_pointer_held_and_no_key_pressed_snaps_back_to_the_owners_value", () => {
  const m = mount();
  nudge(m, "35");
  assert.equal(m.track.value, HELD);
});

/**
 * One wheel over the focused track, whose default action nudges it a step.
 *
 * @param {ReturnType<typeof mount>} m
 */
function wheelOverTrack(m) {
  m.doc.activeElement = m.track;
  wheelAt({ seen: m.seen, node: m.trackNode, el: m.track, doc: m.doc }, -100, () =>
    nudge(m, String(Number(m.track.value) + STEP)),
  );
}

const WHEEL_REPORTS = [
  { name: "the_wheel_over_the_focused_track_reports_no_move", of: "moves" },
  { name: "the_wheel_over_the_focused_track_reports_no_commit", of: "commits" },
];

for (const row of WHEEL_REPORTS) {
  test(`test_${row.name}`, () => {
    const m = mount();
    wheelOverTrack(m);
    assert.deepEqual(m[row.of === "moves" ? "moves" : "commits"], []);
  });
}

test("test_the_wheel_over_the_focused_track_leaves_the_track_at_the_owners_value", () => {
  const m = mount();
  wheelOverTrack(m);
  assert.equal(m.track.value, HELD);
});

test("test_the_wheel_over_the_focused_box_commits_nothing", () => {
  const m = mount();
  m.doc.activeElement = m.box;
  wheelAt({ seen: m.seen, node: m.boxNode, el: m.box, doc: m.doc }, -100, () =>
    typeIn(m, String(Number(m.box.value) + STEP)),
  );
  assert.deepEqual(m.commits, []);
});

// --- Off ---------------------------------------------------------------------------------------------------------

const OFF_GRAYS = [
  { name: "an_off_slider_is_grayed_whole", off: true, want: true },
  { name: "an_on_slider_is_not_grayed", off: false, want: false },
];

for (const row of OFF_GRAYS) {
  test(`test_${row.name}`, () => {
    const outer = markup({ off: row.off }).at(-1);
    assert.equal(outer ? classes(outer).includes("grayed") : undefined, row.want);
  });
}

const OFF_TAKES = [
  { name: "an_off_slider_takes_no_drag", control: "track", off: true, want: true },
  { name: "an_on_slider_takes_a_drag", control: "track", off: false, want: false },
  { name: "an_off_slider_takes_no_typing", control: "box", off: true, want: true },
  { name: "an_on_slider_takes_typing", control: "box", off: false, want: false },
];

for (const row of OFF_TAKES) {
  test(`test_${row.name}`, () => {
    const control = inputs({ off: row.off })[row.control === "track" ? "track" : "box"];
    assert.equal(control ? hasAttr(control, "disabled") : undefined, row.want);
  });
}

// --- what the slider carries -------------------------------------------------------------------------------------

const NAMES = [
  { name: "the_track_is_named_by_its_caller", aria: "fixture slider" },
  { name: "the_track_takes_another_name_from_another_caller", aria: "second fixture slider" },
];

for (const row of NAMES) {
  test(`test_${row.name}`, () => {
    const { track } = inputs({ aria: row.aria });
    assert.equal(track ? attr(track, "aria-label") : undefined, row.aria);
  });
}

const KEYS = [
  { name: "the_slider_carries_the_setting_key_it_is_given", k: "xfeed" },
  { name: "the_slider_carries_another_setting_key_when_given_another", k: "other" },
];

for (const row of KEYS) {
  test(`test_${row.name}`, () => {
    const outer = markup({ k: row.k }).at(-1);
    assert.equal(outer ? attr(outer, "data-k") : undefined, row.k);
  });
}

const TESTIDS = [
  { name: "the_slider_carries_the_test_id_it_is_given", testid: "fixture-id" },
  { name: "the_slider_carries_another_test_id_when_given_another", testid: "second-id" },
];

for (const row of TESTIDS) {
  test(`test_${row.name}`, () => {
    const outer = markup({ testid: row.testid }).at(-1);
    assert.equal(outer ? attr(outer, "data-testid") : undefined, row.testid);
  });
}

test("test_the_slider_carries_the_context_class_it_is_given", () => {
  const outer = markup({ cls: "view" }).at(-1);
  assert.equal(outer ? classes(outer).includes("view") : undefined, true);
});
