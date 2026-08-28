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
// name: that it HAS one is the behavior, what it says is not. The copy these
// cases render is this file's own stand-in text, seeded through /api/metadata's
// `easy.<grid>.<presetId>` shape the way tests/js/components/easytiles-desc.test.js
// seeds its descriptions — the owner's own words never reach a case here.
//
// ONE SEED FOR ALL FOUR CASES, tipped knob and untipped knob together. A tile
// whose copy is absent altogether renders no tip either, so a tipless knob read
// against an empty payload would pass whether the wiring exists or not. Seeded
// side by side, "this knob has no tip" is read in a grid where a tip
// demonstrably does render.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-tips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs } = await import("../support/easytiles.js");
const { knobTip, knobTipText, knobDescribedBy, knobHasGroup, knobIsNamed } = await import("../support/easyknobs.js");

// The knob that carries a tip, and the knob that carries none. Preset ids and
// knob ids are wire identifiers, stated outright.
const TIPPED = { preset: "concert-hall", knob: "correction" };
const UNTIPPED = { preset: "purist", knob: "emphasis" };

// Stand-in copy, never compared against what ships: one knob given a label and a
// tip, one given a label and no tip.
const COPY = {
  [TIPPED.preset]: {
    knobs: { [TIPPED.knob]: { label: "A stand-in label.", tip: "A stand-in tip, seeded by the suite." } },
  },
  [UNTIPPED.preset]: { knobs: { [UNTIPPED.knob]: { label: "A stand-in label." } } },
};

/** The album grid seeded with that copy — what every case here renders. */
const seeded = () => resetTab({ grid: "album", mode: "pcm", copy: COPY });

// ============================================================================
// the knob that carries a tip
// ============================================================================

test("test_the_correction_knobs_description_resolves_to_an_element_inside_that_knob", async () => {
  await seeded();
  assert.notEqual(knobTip(tabs(), TIPPED.preset, TIPPED.knob), undefined);
});

test("test_the_correction_knobs_tip_says_something", async () => {
  await seeded();
  assert.notEqual(knobTipText(tabs(), TIPPED.preset, TIPPED.knob), "");
});

// ============================================================================
// the knob that carries none
// ============================================================================
//
// A knob with no guidance to give describes itself with nothing — rather than
// with an empty element, which a reader would announce as a description that is
// there and says nothing.
//
// The group is read BESIDE the description, in the one assertion, because
// "names no description" is only a behavior where there is a group to name one:
// a knob rendering no group at all names no description either, and a card that
// had never learned this wiring would pass a bare `aria-describedby` reading
// while failing this one.

test("test_a_knob_with_no_tip_names_no_description", async () => {
  await seeded();
  assert.deepEqual(
    [knobHasGroup(tabs(), UNTIPPED.preset, UNTIPPED.knob), knobDescribedBy(tabs(), UNTIPPED.preset, UNTIPPED.knob)],
    [true, undefined],
  );
});

// ============================================================================
// every knob is named, tip or no tip
// ============================================================================
//
// The name is unconditional and only the description is conditional, so the knob
// WITHOUT a tip is the one this is read on: a group that got its name from its
// tip would fail here while passing on the tipped knob above.

test("test_a_knob_group_is_named_whether_or_not_it_carries_a_tip", async () => {
  await seeded();
  assert.equal(knobIsNamed(tabs(), UNTIPPED.preset, UNTIPPED.knob), true);
});
