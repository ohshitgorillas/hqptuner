// Behavioral suite for a knob's TIP: the one sentence of guidance an Easy Mode
// knob may carry, and the description wiring that ties it to the knob it belongs
// to. Every case here is read on EVERY knob the card offers at rest, both ways:
// the knob handed a tip and the same knob handed none.
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
// seeds its descriptions. The shipped sentence never reaches a case here, and
// the owner may reword it freely. What a case DOES compare word for word is the
// stand-in it seeded, which is its own input: a card rendering a knob's LABEL
// into its description is not empty either, so "there are some words" is a
// reading the wrong card passes. The group's NAME stays unread, though: that it
// has one is the behavior, what it says is not.
//
// NO KNOB STANDS FOR A PROPERTY. Which shipped knobs carry a tip, and which
// carry per-position copy, is the owner's and is asserted nowhere; a case never
// names a preset to mean "the tipped one" or "the untipped one". Instead every
// (preset, knob) pair the card offers at rest is read from `presetsFor()` and
// `knobsShown()`, the card's own enumeration, and each case SEEDS the property
// it reads: a tip for "a knob given a tip", none for "a knob given none". A
// preset that gains or loses a knob is swept in or out without a hand edit, and
// a roster offering no knobs at all generates no cases.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-tips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, offeredAnySource } = await import("../support/easytiles.js");
const { knobTip, knobTipText, knobDescribedBy, knobHasGroup, knobIsNamed, knobOptions, optionTips } =
  await import("../support/easyknobs.js");
const { presetsFor, knobsShown } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string>, whenHires?: boolean }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[], hires?: boolean, costText?: boolean }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

// Every knob every tile offers at rest: each preset's knobs sitting at their
// `default`, read through `knobsShown()` so a knob whose `when` hides it at rest
// is not expected of the tile, and filtered by `offeredAnySource` so a knob the
// source gates out of the rendering is not expected of it either. Preset ids and knob ids are wire identifiers.

/** @type {{ preset: string, knob: Knob }[]} */
const RESTING = PRESETS.flatMap((preset) => {
  const resting = Object.fromEntries(preset.knobs.map((knob) => [String(knob.id), knob.default]));
  return knobsShown(preset, resting)
    .filter(offeredAnySource)
    .map((knob) => ({ preset: String(preset.id), knob }));
});

// Stand-in copy, never compared against what ships. The label and the tip are
// DIFFERENT sentences on purpose, and the tip is compared against this constant
// rather than read for being non-empty: a card rendering the knob's label into
// its description says something, and saying something is not the behavior.
const KNOB_LABEL = "A stand-in label.";
const KNOB_TIP = "A stand-in tip, seeded by the suite.";

/**
 * The payload giving one knob a label and a tip, at the `easy.<presetId>` shape.
 *
 * @param {string} preset
 * @param {string} knob
 * @returns {Record<string, object>}
 */
const tipped = (preset, knob) => ({ [preset]: { knobs: { [knob]: { label: KNOB_LABEL, tip: KNOB_TIP } } } });

/**
 * The payload giving one knob a label and no tip.
 *
 * @param {string} preset
 * @param {string} knob
 * @returns {Record<string, object>}
 */
const untipped = (preset, knob) => ({ [preset]: { knobs: { [knob]: { label: KNOB_LABEL } } } });

// ============================================================================
// a knob given a tip
// ============================================================================
//
// Named for the wiring, not for a shipped knob: what these read is that a knob
// handed a tip renders it and points at it, and the tip they meet is the
// stand-in seeded above.

for (const { preset, knob } of RESTING) {
  const knobId = String(knob.id);

  test(`test_the_${preset}_${knobId}_knob_given_a_tip_names_a_description_resolving_to_an_element_inside_that_knob`, async () => {
    await resetTab({ mode: "pcm", copy: tipped(preset, knobId) });
    assert.notEqual(knobTip(tabs(), preset, knobId), undefined);
  });

  test(`test_the_${preset}_${knobId}_knob_given_a_tip_renders_the_words_it_was_given`, async () => {
    await resetTab({ mode: "pcm", copy: tipped(preset, knobId) });
    assert.equal(knobTipText(tabs(), preset, knobId), KNOB_TIP);
  });
}

// ============================================================================
// a knob given none
// ============================================================================
//
// A knob with no guidance to give describes itself with nothing, rather than
// with an empty element, which a reader would announce as a description that is
// there and says nothing.
//
// The group is read BESIDE the description, in the one assertion, because
// "names no description" is only a behavior where there is a group to name one:
// a knob rendering no group at all names no description either, and a card that
// had never learned this wiring would pass a bare `aria-describedby` reading
// while failing this one.

for (const { preset, knob } of RESTING) {
  const knobId = String(knob.id);

  test(`test_the_${preset}_${knobId}_knob_given_no_tip_names_no_description`, async () => {
    await resetTab({ mode: "pcm", copy: untipped(preset, knobId) });
    assert.deepEqual(
      [knobHasGroup(tabs(), preset, knobId), knobDescribedBy(tabs(), preset, knobId)],
      [true, undefined],
    );
  });

  // ==========================================================================
  // every knob is named, tip or no tip
  // ==========================================================================
  //
  // The name is unconditional and only the description is conditional, so it is
  // read on the knob WITHOUT a tip: a group that got its name from its tip would
  // fail here while passing on the tipped seed above.

  test(`test_the_${preset}_${knobId}_knob_group_is_named_when_it_carries_no_tip`, async () => {
    await resetTab({ mode: "pcm", copy: untipped(preset, knobId) });
    assert.equal(knobIsNamed(tabs(), preset, knobId), true);
  });
}

// ============================================================================
// a tip on every POSITION of a knob
// ============================================================================
//
// Beside the one sentence a knob as a whole may carry, each POSITION of a knob
// may carry its own: hover a position and you are told what that position
// selects. The words ride on /api/metadata beside the tile copy, under
// `easy.tips.<knobId>.<optionId>`, the shape tests/api/test_metadata_easy_tips.py
// pins against the shipped file.
//
// WHAT THESE CASES SEED IS THEIR OWN, as everywhere else in this file: the
// harness replaces the whole payload on every reset, so the tips a case meets
// are the ones it put there and never the owner's.
//
// THE POSITION LIST IS NEVER STATED. Each case seeds a tip for every position
// the knob's `options` declare, then reads back what each position the tile
// OFFERS is described by; a knob that gains or loses a position needs no edit
// here, and the answer is compared against the offer rather than against a
// list. That the offer is not EMPTY rides in the same assertion, since a knob
// rendering no positions at all would otherwise answer every question here with
// agreement.
//
// EACH POSITION'S TIP NAMES THAT POSITION, and the comparison is against those
// exact sentences rather than against "something": a card rendering a position's
// LABEL into its description, or one sentence over every position of a knob,
// says something at every position and is a different card from this one.

/**
 * The stand-in sentence one position is seeded with, its own, so that a tip
 * arriving at the wrong position is a different answer from the right one.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
const positionTip = (value) => `A stand-in tip for the ${value} position, seeded by the suite.`;

/**
 * The payload giving every position a knob declares its own tip, at the
 * `easy.tips` shape, and nothing else.
 *
 * @param {Knob} knob
 * @returns {Record<string, object>}
 */
const positionTips = (knob) => ({
  tips: { [String(knob.id)]: Object.fromEntries(knob.options.map((v) => [String(v), positionTip(String(v))])) },
});

for (const { preset, knob } of RESTING) {
  const knobId = String(knob.id);

  test(`test_every_position_the_${preset}_${knobId}_knob_offers_is_described_by_its_own_tip`, async () => {
    await resetTab({ mode: "pcm", copy: positionTips(knob) });
    const out = tabs();
    const offered = knobOptions(out, preset, knobId);
    assert.deepEqual(
      [optionTips(out, preset, knobId), offered.length > 0],
      [Object.fromEntries(offered.map((v) => [v, positionTip(v)])), true],
    );
  });
}

// ============================================================================
// a knob given no per-position copy
// ============================================================================
//
// This is the case that kills a card describing every position whatever the
// payload says. The knob is seeded its GROUP tip and nothing per position, so
// "no position here is described" is read on a card that demonstrably carries
// copy for the knob, and a card spreading the group's sentence over each
// position fails by naming the positions it described.
//
// The positions come from the offer, so this names none of them either, and the
// offer's non-emptiness rides along for the same reason it does above.

for (const { preset, knob } of RESTING) {
  const knobId = String(knob.id);

  test(`test_the_${preset}_${knobId}_knob_given_no_per_position_copy_describes_none_of_its_positions`, async () => {
    await resetTab({ mode: "pcm", copy: tipped(preset, knobId) });
    const out = tabs();
    const offered = knobOptions(out, preset, knobId);
    assert.deepEqual(
      [optionTips(out, preset, knobId), offered.length > 0],
      [Object.fromEntries(offered.map((v) => [v, ""])), true],
    );
  });
}
