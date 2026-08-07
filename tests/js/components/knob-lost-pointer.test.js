// Behavioral suite for one knob-drag case the parent suites do not reach: a drag
// that loses its pointer.
//
// A drag on the dial starts on pointerdown and is adjusted by pointermove. The
// release normally arrives as a pointerup — but a context menu opening mid-drag
// swallows it, and the page never sees the button go up. The next pointermove
// still arrives, and it carries `buttons: 0`: the primary button is no longer
// held, so the drag is OVER. The knob must finish it the way any other release
// finishes it — commit once, at the last value it reported live — instead of
// leaving a drag running that follows the pointer around the screen.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `Knob` with props it owns and reads the two callbacks the
// component was handed, `onLive` (continuous, during the drag) and `onCommit`
// (on release). Nothing of the knob's is stubbed: the handlers fired are its own
// real ones, reached through preact's own `options.vnode` creation hook, and the
// gesture bubbles the dial's ancestor chain with events shaped the way a browser
// shapes them (tests/js/support/pointer.js).
//
// Not asserted anywhere here: WHICH value a given pixel of travel maps to. That
// is the knob's own scale, and pinning it would pin arithmetic rather than
// behaviour; what these cases pin is that the committed value is the one the
// knob itself last reported live, whatever that value was.
//
// Two things stop a case passing vacuously, both throws rather than silent
// skips: a drag whose held moves reported fewer than two DISTINCT live values
// (with only one, "the last value" and "any value ever" are the same claim), and
// a coordinate a still-running drag would not move at (where "reported nothing
// live" is what a running drag does too).
//
// HARNESS LIMIT, stated rather than glossed: the gesture reaches the dial's own
// ancestor chain and any window/document listener the handlers install during
// it. A knob routing its moves somewhere else entirely makes these cases throw
// "nothing received the pointermove" — read that as a limit of the dispatch, not
// as a verdict on the behaviour. tests/js/components/knob.test.js owns the
// render-visible contracts and documents the rest of the interaction surface
// (keys, wheel, double-click) as playwright's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/knob-lost-pointer.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Knob } from "../../../hqptuner/static/components/Knob.js";
import { knobDrag } from "../support/pointer.js";

// Where the press lands, and the two places the pointer travels to while the
// button is still held. Two moves, not one: a drag that reported a single live
// value cannot tell "commits the LAST value" from "commits SOME value".
const START_Y = 200;
const FIRST_Y = 170;
const SECOND_Y = 140;

// Coordinates for the button-less move, one either side of the press and well
// clear of it. Each is witnessed before use, so a knob whose scale does not
// reach them fails loudly instead of proving nothing.
const FAR = { above_the_press: 110, below_the_press: 290 };

// A knob with room to move a long way in both directions from where it starts,
// and the two callbacks a parent hands it.
/**
 * @param {number[]} live
 * @param {number[]} commits
 */
function knob(live, commits) {
  return html`<${Knob}
    min=${-90}
    max=${0}
    step=${1}
    value=${-45}
    unit="dB"
    onLive=${(/** @type {number} */ v) => live.push(v)}
    onCommit=${(/** @type {number} */ v) => commits.push(v)}
  />`;
}

// A drag already under way: pressed on the dial, then moved twice with the
// primary button still held, to two different values.
function draggingKnob() {
  /** @type {number[]} */
  const live = [];
  /** @type {number[]} */
  const commits = [];
  const drag = knobDrag(knob(live, commits));
  drag.down(START_Y);
  drag.move(FIRST_Y, 1);
  drag.move(SECOND_Y, 1);
  if (new Set(live).size < 2) {
    throw new Error(
      `the drag reported ${JSON.stringify(live)} live: two distinct values are needed to name a last one`,
    );
  }
  return { live, commits, drag };
}

// Proof that a coordinate is one a STILL-RUNNING drag would report a new live
// value at. Without it, "reported nothing live" says nothing: a pointer that has
// not travelled far enough to change the value is silent on a running drag too.
// Witnessed on a knob of its own, so the case under test starts clean.
/** @param {number} clientY */
function witnessTravel(clientY) {
  /** @type {number[]} */
  const live = [];
  const drag = knobDrag(knob(live, []));
  drag.down(START_Y);
  drag.move(SECOND_Y, 1);
  const before = live.length;
  drag.move(clientY, 1);
  if (live.length === before) {
    throw new Error(`a held drag reports no new value at clientY ${clientY}, so a released one proves nothing there`);
  }
}

// --- the button is still held: an ordinary drag ------------------------------

test("test_a_move_with_the_button_held_reports_the_value_live", () => {
  /** @type {number[]} */
  const live = [];
  const drag = knobDrag(knob(live, []));
  drag.down(START_Y);
  drag.move(SECOND_Y, 1);
  assert.equal(live.length, 1);
});

test("test_a_move_with_the_button_held_commits_nothing", () => {
  /** @type {number[]} */
  const commits = [];
  const drag = knobDrag(knob([], commits));
  drag.down(START_Y);
  drag.move(SECOND_Y, 1);
  assert.deepEqual(commits, []);
});

// --- the button is gone: the drag is over ------------------------------------

test("test_a_move_with_no_button_held_commits_the_last_live_value_once", () => {
  const { live, commits, drag } = draggingKnob();
  // snapshotted BEFORE the release, so the case states what it expects rather
  // than reading it back out of whatever the release itself appended
  const expected = live[live.length - 1];
  drag.move(SECOND_Y, 0);
  assert.deepEqual(commits, [expected]);
});

for (const [where, clientY] of Object.entries(FAR)) {
  test(`test_a_move_with_no_button_held_${where}_reports_nothing_live`, () => {
    witnessTravel(clientY);
    const { live, drag } = draggingKnob();
    const before = live.length;
    drag.move(clientY, 0);
    assert.equal(live.length, before);
  });
}

test("test_a_second_move_with_no_button_held_commits_nothing_further", () => {
  const { commits, drag } = draggingKnob();
  drag.move(SECOND_Y, 0);
  drag.move(FAR.below_the_press, 0);
  assert.equal(commits.length, 1);
});
