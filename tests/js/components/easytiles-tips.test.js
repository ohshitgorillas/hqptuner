// Behavioral suite for a knob's TIP: the one sentence of guidance some Easy Mode
// knobs carry, and the description wiring that ties it to the knob it belongs
// to. Only some knobs have one, so both halves are read — the knob that carries
// a tip and a knob that carries none.
//
// The companion files are tests/js/components/easytiles-positions.test.js (what a
// knob offers), tests/js/components/easytiles-knobs.test.js (which position it
// marks) and tests/js/components/easytiles.test.js (the grids and the presses).
// All share tests/js/support/easytiles.js, imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read.
//
// HOW A TIP IS FOUND, and the reading this file takes. A knob renders as a
// `role="group"`; the tip is the element that group names in `aria-describedby`,
// found by that id inside the knob. So "the knob has a tip" and "the tip
// describes the knob" are one wiring read two ways, which is the point: a
// sentence rendered beside a knob that nothing points at is not a description of
// it, and a description pointing at an id that is not there describes nothing.
// A knob with no tip is therefore read as a group naming no description at all.
//
// NOT A WORD OF THE TIP IS ASSERTED (docs/testing.md rule 9). The sentence is
// owner copy and may be reworded freely; what is read is that there is one, that
// it is not empty, and that the wiring reaches it. The same goes for the group's
// name: that it HAS one is the behavior, what it says is not.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-tips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs } = await import("../support/easytiles.js");
const { knobTip, knobTipText, knobDescribedBy, knobIsNamed } = await import("../support/easyknobs.js");

// The knob that carries a tip, and the knob that carries none. Preset ids and
// knob ids are wire identifiers, stated outright.
const TIPPED = { preset: "concert-hall", knob: "correction" };
const UNTIPPED = { preset: "purist", knob: "emphasis" };

// ============================================================================
// the knob that carries a tip
// ============================================================================

test("test_the_correction_knobs_description_resolves_to_an_element_inside_that_knob", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  assert.notEqual(knobTip(tabs(), TIPPED.preset, TIPPED.knob), undefined);
});

test("test_the_correction_knobs_tip_says_something", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  assert.notEqual(knobTipText(tabs(), TIPPED.preset, TIPPED.knob), "");
});

// ============================================================================
// the knob that carries none
// ============================================================================
//
// A knob with no guidance to give describes itself with nothing — rather than
// with an empty element, which a reader would announce as a description that is
// there and says nothing.

test("test_a_knob_with_no_tip_names_no_description", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  assert.equal(knobDescribedBy(tabs(), UNTIPPED.preset, UNTIPPED.knob), undefined);
});

// ============================================================================
// every knob is named, tip or no tip
// ============================================================================
//
// The name is unconditional and only the description is conditional, so the knob
// WITHOUT a tip is the one this is read on: a group that got its name from its
// tip would fail here while passing on the tipped knob above.

test("test_a_knob_group_is_named_whether_or_not_it_carries_a_tip", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  assert.equal(knobIsNamed(tabs(), UNTIPPED.preset, UNTIPPED.knob), true);
});
