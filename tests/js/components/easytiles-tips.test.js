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
const { knobTip, knobTipText, knobDescribedBy, knobHasGroup, knobIsNamed, knobOptions, tippedOptions } =
  await import("../support/easyknobs.js");
const signals = await import("../../../hqptuner/static/store/signals.js");

// The knob the seed below GIVES a tip, and the knob it gives none. Preset ids
// and knob ids are wire identifiers, stated outright — but which shipped knobs
// carry a tip is not read here at all, because the copy every case renders is
// this file's own. That the SHIPPED data carries a tip on `concert-hall`'s
// `correction` knob and none on `purist`'s `emphasis` is pinned against
// /api/metadata, in tests/api/test_metadata_easy_lossy.py.
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
// a knob given a tip
// ============================================================================
//
// Named for the wiring, not for a shipped knob: what these two read is that a
// knob handed a tip renders it and points at it, and the tip they meet is the
// stand-in seeded above.

test("test_a_knob_given_a_tip_names_a_description_resolving_to_an_element_inside_that_knob", async () => {
  await seeded();
  assert.notEqual(knobTip(tabs(), TIPPED.preset, TIPPED.knob), undefined);
});

test("test_a_knob_given_a_tip_renders_it_with_something_in_it", async () => {
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

// ============================================================================
// a tip on every POSITION of a knob
// ============================================================================
//
// Beside the one sentence a knob as a whole may carry, each POSITION of a knob
// may carry its own: hover a position and you are told what that position
// selects. The words ride on /api/metadata beside the tile copy, under
// `easy.tips.<knobId>.<optionId>` — the shape tests/api/test_metadata_easy_tips.py
// pins against the shipped file.
//
// WHAT THESE CASES SEED IS THEIR OWN, as everywhere else in this file: the
// harness replaces the whole payload on every reset, so the tips a case meets
// are the ones it put there and never the owner's. What the SHIPPED file
// carries for each knob — which is the other half of the behavior, and the half
// no seeded case can see — is pinned in Python.
//
// THE POSITION LIST IS NEVER STATED. Each case reads the positions the knob
// offers, seeds a tip for each of them, and then asks which positions came back
// tipped; a knob that gains or loses a position needs no edit here, and the
// answer is compared against the offer rather than against a list.

// The three knobs the shipped file gives per-position copy to, each read on a
// tile that carries it, and the knob it gives none. Preset ids and knob ids are
// wire identifiers, stated outright.
const PER_POSITION = [
  { preset: "perfect-ten", knob: "source" },
  { preset: "purist", knob: "emphasis" },
  { preset: "concert-hall", knob: "version" },
];
const NO_POSITIONS = { preset: "concert-hall", knob: "correction" };

/**
 * The album grid rendered with a stand-in tip on every position of each knob in
 * `PER_POSITION`, and none anywhere else — the payload's `easy.tips` block, at
 * the shape /api/metadata serves it. The positions are read off a first render
 * so that no case here names one.
 *
 * @returns {Promise<string>}
 */
async function withPositionTips() {
  await resetTab({ grid: "album", mode: "pcm" });
  const first = tabs();
  const tips = Object.fromEntries(
    PER_POSITION.map(({ preset, knob }) => [
      knob,
      Object.fromEntries(knobOptions(first, preset, knob).map((v) => [v, "A stand-in tip, seeded by the suite."])),
    ]),
  );
  signals.metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
    easy: { album: {}, tips },
  };
  return tabs();
}

for (const { preset, knob } of PER_POSITION) {
  test(`test_every_position_the_${knob}_knob_offers_is_described_by_its_own_tip`, async () => {
    const out = await withPositionTips();
    assert.deepEqual(tippedOptions(out, preset, knob), knobOptions(out, preset, knob));
  });
}

// ============================================================================
// the knob given no per-position copy
// ============================================================================
//
// Read in the same render as the three above, so "no position here is tipped"
// is answered in a card where positions demonstrably are: a tile that had never
// learned this wiring passes this case on its own and fails the three above.

test("test_no_position_of_the_correction_knob_is_described_by_a_tip", async () => {
  assert.deepEqual(tippedOptions(await withPositionTips(), NO_POSITIONS.preset, NO_POSITIONS.knob), []);
});
