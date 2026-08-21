// Behavioral suite for the license a knob dial needs before an arrow key may
// move it.
//
// Safari 26.5 on macOS turns a scroll gesture over an element carrying
// `role="slider"` into trusted `ArrowLeft`/`ArrowRight` keydowns aimed at that
// element, without focusing it — so scrolling the page past a knob silently
// changes its value. The product rule being restored: the wheel moves the page,
// and only deliberate user input changes a control's value. The dial therefore
// honors arrow keys only while it genuinely holds focus, and it learns that
// from its own focus/blur events.
//
// `document.activeElement` is NOT the signal and is never asserted on here: on
// the engine with the bug it reports BODY for a keydown the dial is the target
// of, so the harness offers it in exactly that state (tests/js/support/
// pointer.js) rather than in one that would let a knob deciding on it look
// right.
//
// Policy (docs/testing.md): public API only, one assertion per case. Every case
// renders the exported `Knob` with props it owns and reads the callback the
// component was handed for a settled value — `onCommit` (release / key / double
// click / box edit). Nothing of the knob's is stubbed:
// the handlers fired are its own real ones, reached through preact's own
// `options.vnode` creation hook, with events shaped the way a browser shapes
// them.
//
// GAP, unreachable branch: the `onLive` half of the unfocused case is not
// asserted here, and cannot be. The dial's key path never calls `onLive` at all
// — a keystroke is a commit — so a case pinning "an unfocused keystroke reports
// nothing live" would be asserting that a route nobody takes was not taken, and
// would stay green against an implementation with no focus gate whatsoever.
// `onLive` is pinned by the drag suite, where it is reachable.
//
// NOT ASSERTED, and reported as a gap rather than faked: "no value is staged" by
// a refused keystroke. Staging is internal state that shows up only in the NEXT
// render, and preact-render-to-string renders once with no reconciliation, so a
// server-side case cannot read it back. What the refusal is pinned by here is
// the whole of its observable surface — neither callback runs.
//
// HARNESS LIMIT, stated rather than glossed: keys, focus and the double click
// reach the dial's own ancestor chain and any window/document listener its
// handlers install. A knob routing them somewhere else entirely makes a case
// throw "nothing received the ...", which is a limit of the dispatch, not a
// verdict on the behavior.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/knob-focus-keys.test.js

import test from "node:test";
import assert from "node:assert/strict";

// First, and for its side effect as much as its exports: it installs the
// document lib/dom.js registers its capture listeners on, which has to exist
// before the imports below pull dom.js in.
import { knobSliderEdit, knobBoxEdit } from "../support/knobedit.js";
import { html } from "../../../hqptuner/static/lib/dom.js";
import { Knob } from "../../../hqptuner/static/components/Knob.js";
import { knobDrag, knobKeys } from "../support/pointer.js";

// A knob with room to move a long way either side of where it starts, and a
// step coarse enough that ten of them, and a fifth of one, all land on values
// nothing else in the table lands on.
const MIN = -90;
const MAX = 90;
const STEP = 5;
const START = 0;
const DEFAULT = -20;

/**
 * @param {number[]} live
 * @param {number[]} commits
 */
function knob(live, commits) {
  return html`<${Knob}
    min=${MIN}
    max=${MAX}
    step=${STEP}
    value=${START}
    def=${DEFAULT}
    unit="dB"
    onLive=${(/** @type {number} */ v) => live.push(v)}
    onCommit=${(/** @type {number} */ v) => commits.push(v)}
  />`;
}

// Where each key takes a knob sitting at START: one step for the arrows, ten for
// the Page keys, the ends of the range for Home and End.
const LANDINGS = {
  ArrowUp: START + STEP,
  ArrowRight: START + STEP,
  ArrowDown: START - STEP,
  ArrowLeft: START - STEP,
  PageUp: START + 10 * STEP,
  PageDown: START - 10 * STEP,
  Home: MIN,
  End: MAX,
};

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

// --- a focused dial keeps the whole keyboard contract ---------------------------

for (const [key, landing] of Object.entries(LANDINGS)) {
  test(`test_a_focused_dial_commits_${landing}_on_${key}`, () => {
    /** @type {number[]} */
    const commits = [];
    const keys = knobKeys(knob([], commits));
    keys.focus();
    keys.key(key);
    assert.deepEqual(commits, [landing]);
  });
}

// Shift-fine applies to the arrows as a class, Left/Right included — those are
// the pair Safari synthesizes from a scroll gesture, so they are the pair most
// likely to arrive with a modifier held.
/** @type {[string, number][]} */
const SHIFT_ARROWS = [
  ["ArrowUp", 1],
  ["ArrowDown", -1],
  ["ArrowRight", 1],
  ["ArrowLeft", -1],
];

for (const [key, sign] of SHIFT_ARROWS) {
  test(`test_a_focused_dial_takes_a_fifth_of_a_step_on_shift_${key}`, () => {
    /** @type {number[]} */
    const commits = [];
    const keys = knobKeys(knob([], commits));
    keys.focus();
    keys.key(key, { shiftKey: true });
    assert.deepEqual(commits, [START + (sign * STEP) / 5]);
  });
}

// --- an unfocused dial is the scroll-gesture case, and refuses ------------------

for (const key of ARROWS) {
  test(`test_an_unfocused_dial_commits_nothing_on_${key}`, () => {
    /** @type {number[]} */
    const commits = [];
    const keys = knobKeys(knob([], commits));
    keys.key(key);
    assert.deepEqual(commits, []);
  });
}

// --- the license does not outlive the focus -------------------------------------

for (const key of ARROWS) {
  test(`test_a_blurred_dial_commits_nothing_on_${key}`, () => {
    /** @type {number[]} */
    const commits = [];
    const keys = knobKeys(knob([], commits));
    keys.focus();
    keys.blur();
    keys.key(key);
    assert.deepEqual(commits, []);
  });
}

// --- every other way of editing a knob is untouched by focus --------------------
// None of these delivers a focus event to the dial at any point.

test("test_a_pointer_drag_commits_with_the_dial_never_focused", () => {
  /** @type {number[]} */
  const commits = [];
  const drag = knobDrag(knob([], commits));
  drag.down(200);
  drag.move(170, 1);
  drag.up(170);
  assert.equal(commits.length, 1);
});

test("test_a_double_click_commits_with_the_dial_never_focused", () => {
  /** @type {number[]} */
  const commits = [];
  knobKeys(knob([], commits)).dblClick();
  assert.equal(commits.length, 1);
});

test("test_the_horizontal_slider_commits_with_the_dial_never_focused", () => {
  /** @type {number[]} */
  const commits = [];
  knobSliderEdit(knob([], commits), 10);
  assert.equal(commits[commits.length - 1], 10);
});

test("test_the_number_box_commits_with_the_dial_never_focused", () => {
  /** @type {number[]} */
  const commits = [];
  knobBoxEdit(knob([], commits), 10);
  assert.equal(commits[commits.length - 1], 10);
});
