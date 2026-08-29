// Behavioral suite for a knob's TIP: the one sentence of guidance some Easy Mode
// knobs carry, and the description wiring that ties it to the knob it belongs
// to. Only some knobs have one, so both halves are read — the knob that carries
// a tip and a knob that carries none.
//
// The companion files are tests/js/components/easytiles-positions.test.js (what a
// knob offers), tests/js/components/easytiles-knobs.test.js (which position it
// marks) and tests/js/components/easytiles.test.js (the tiles and the presses).
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
// NOT A WORD THE OWNER OWNS IS ASSERTED (docs/testing.md rule 9). The copy these
// cases render is this file's own stand-in text, seeded through /api/metadata's
// `easy.<presetId>` shape the way tests/js/components/easytiles-desc.test.js
// seeds its descriptions — the shipped sentence never reaches a case here, and
// the owner may reword it freely. What a case DOES compare word for word is the
// stand-in it seeded, which is its own input: a card rendering a knob's LABEL
// into its description is not empty either, so "there are some words" is a
// reading the wrong card passes. The group's NAME stays unread, though — that it
// has one is the behavior, what it says is not.
//
// ONE SEED FOR ALL FOUR CASES, tipped knob and untipped knob together. A tile
// whose copy is absent altogether renders no tip either, so a tipless knob read
// against an empty payload would pass whether the wiring exists or not. Seeded
// side by side, "this knob has no tip" is read on a card where a tip
// demonstrably does render.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-tips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs } = await import("../support/easytiles.js");
const { knobTip, knobTipText, knobDescribedBy, knobHasGroup, knobIsNamed, knobOptions, optionTips } =
  await import("../support/easyknobs.js");
const signals = await import("../../../hqptuner/static/store/signals.js");

// The knob the seed below GIVES a tip, and the knob it gives none. Preset ids
// and knob ids are wire identifiers, stated outright — but which shipped knobs
// carry a tip is not read here at all, because the copy every case renders is
// this file's own. That the SHIPPED data carries a tip on `concert-hall`'s
// `correction` knob and none on `purist`'s `emphasis` is pinned against
// /api/metadata, in tests/api/test_metadata_easy_copy.py.
const TIPPED = { preset: "concert-hall", knob: "correction" };
const UNTIPPED = { preset: "purist", knob: "emphasis" };

// Stand-in copy, never compared against what ships: one knob given a label and a
// tip, one given a label and no tip. The label and the tip are DIFFERENT
// sentences on purpose, and the tip is compared against this constant rather
// than read for being non-empty — a card rendering the knob's label into its
// description says something, and saying something is not the behavior.
const KNOB_TIP = "A stand-in tip, seeded by the suite.";
const COPY = {
  [TIPPED.preset]: {
    knobs: { [TIPPED.knob]: { label: "A stand-in label.", tip: KNOB_TIP } },
  },
  [UNTIPPED.preset]: { knobs: { [UNTIPPED.knob]: { label: "A stand-in label." } } },
};

/** The card seeded with that copy — what every case here renders. */
const seeded = () => resetTab({ mode: "pcm", copy: COPY });

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

test("test_a_knob_given_a_tip_renders_the_words_it_was_given", async () => {
  await seeded();
  assert.equal(knobTipText(tabs(), TIPPED.preset, TIPPED.knob), KNOB_TIP);
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
// offers, seeds a tip for each of them, and then reads back what each position
// is described by; a knob that gains or loses a position needs no edit here, and
// the answer is compared against the offer rather than against a list. That the
// offer is not EMPTY rides in the same assertion, since a knob rendering no
// positions at all would otherwise answer every question here with agreement.
//
// EACH POSITION'S TIP NAMES THAT POSITION, and the comparison is against those
// exact sentences rather than against "something": a card rendering a position's
// LABEL into its description, or one sentence over every position of a knob,
// says something at every position and is a different card from this one.

// The knobs the shipped file gives per-position copy to, each read on a tile
// that carries it, and the knob it gives none. Preset ids and knob ids are wire
// identifiers, stated outright. `material` is not among them: its copy is not
// written yet, and a stand-in seeded for it here would be read as a knob that
// has copy.
const PER_POSITION = [
  { preset: "purist", knob: "emphasis" },
  { preset: "concert-hall", knob: "version" },
];
const NO_POSITIONS = { preset: "concert-hall", knob: "correction" };

/**
 * The stand-in sentence one position is seeded with — its own, so that a tip
 * arriving at the wrong position is a different answer from the right one.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
const positionTip = (value) => `A stand-in tip for the ${value} position, seeded by the suite.`;

/**
 * The card rendered with a stand-in tip on every position of each knob in
 * `PER_POSITION`, and none anywhere else — the payload's `easy.tips` block, at
 * the shape /api/metadata serves it. The positions are read off a first render
 * so that no case here names one.
 *
 * @returns {Promise<string>}
 */
async function withPositionTips() {
  await resetTab({ mode: "pcm" });
  const first = tabs();
  const tips = Object.fromEntries(
    PER_POSITION.map(({ preset, knob }) => [
      knob,
      Object.fromEntries(knobOptions(first, preset, knob).map((v) => [v, positionTip(v)])),
    ]),
  );
  signals.metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
    easy: { tips },
  };
  return tabs();
}

for (const { preset, knob } of PER_POSITION) {
  test(`test_every_position_the_${knob}_knob_offers_is_described_by_its_own_tip`, async () => {
    const out = await withPositionTips();
    const offered = knobOptions(out, preset, knob);
    assert.deepEqual(
      [optionTips(out, preset, knob), offered.length > 0],
      [Object.fromEntries(offered.map((v) => [v, positionTip(v)])), true],
    );
  });
}

// ============================================================================
// the knob given no per-position copy
// ============================================================================
//
// This is the case that kills a card describing every position whatever the
// payload says. It is read in the same render as the three above, so "no
// position here is described" is answered in a card where positions demonstrably
// are — and the knob it is read on is one the seed above hands nothing, never a
// fact about which knobs ship copy.
//
// The positions come from the offer, so this names none of them either, and the
// offer's non-emptiness rides along for the same reason it does above.

test("test_a_knob_given_no_per_position_copy_describes_none_of_its_positions", async () => {
  const out = await withPositionTips();
  const offered = knobOptions(out, NO_POSITIONS.preset, NO_POSITIONS.knob);
  assert.deepEqual(
    [optionTips(out, NO_POSITIONS.preset, NO_POSITIONS.knob), offered.length > 0],
    [Object.fromEntries(offered.map((v) => [v, ""])), true],
  );
});
