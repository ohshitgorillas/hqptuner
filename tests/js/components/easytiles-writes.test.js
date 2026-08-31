// Behavioral suite for what a press on an Easy Mode tile DOES NOT write: only
// those filter fields whose current value differs from what the preset would set
// them to reach the wire, so a press that would change nothing writes nothing at
// all — while the record of where that tile's knobs sit is updated either way.
//
// The companion file is tests/js/components/easytiles.test.js, which owns the
// grids, the active marking and where a press routes what the table names; this
// one is about the writes that press DOES NOT make. Both share
// tests/js/support/easytiles.js, imported dynamically after `useStorage()` so
// that `store/easyview.js` meets the fake localStorage at its load-time read.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals with the shapes
// /api/config, /api/state and /api/enumerations actually serve, and every write
// leaves over a faked `globalThis.fetch` on the real REST paths — the tabs lane
// through POST /api/config/stage, the LIVE lane through POST /api/config/live.
// No store function of HQPTuner's is stubbed.
//
// NAMES, NOT WORDS (rule 9). Schema keys, the daemon's own form-field names,
// preset ids and knob option ids are wire identifiers and are stated outright.
// Filter names are owner-curated data and are read back from `writeSet`, never
// typed. Nothing here asserts a title, a description or any other piece of
// owner copy.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-writes.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const {
  EMPTY,
  resetTab,
  resetLive,
  running,
  inForce,
  seedPcmPair,
  flush,
  seenTabs,
  seenLive,
  stagedNames,
  postedFields,
  pressTile,
  pressKnob,
  seedable,
  offeredAnySource,
} = await import("../support/easytiles.js");

const { knobsFor } = await import("../../../hqptuner/static/store/easyview.js");
const { presetsFor, knobsShown, writeSet } = await import("../../../hqptuner/static/store/easy.js");
const { combos } = await import("../support/easytable.js");

// The schema keys the fixture seeds the PCM chain by, and the daemon's own
// form-field names those keys are carried to: `pcm_filter_1x` is the 1x end of
// the PCM chain and the daemon calls it `filter1x`, `pcm_filter_nx` is the Nx
// end and the daemon calls it `filter` (store/live/derive.js). Wire identifiers
// all four.
const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const NX_FIELD = "filter";

/** @type {Record<string, string>} */
const PCM_FIELD = { [PCM_1X]: "filter1x", [PCM_NX]: NX_FIELD };

/** @typedef {ReturnType<typeof presetsFor>[number]} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

/**
 * Every knob of a preset at its `default`, keyed by knob id.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
const resting = (preset) => Object.fromEntries(preset.knobs.map((knob) => [String(knob.id), knob.default]));

/**
 * A knob position record spelled out for a test name: `knob_position` pairs
 * joined by underscores, so a failure names where every knob sat.
 *
 * @param {Record<string, string>} knobs
 */
const at = (knobs) =>
  Object.entries(knobs)
    .map(([knob, position]) => `${knob}_${position}`)
    .join("_");

// The tiles the record-and-stage cases press: every preset that OFFERS exactly
// one knob at its defaults, read through `knobsShown()` so a knob whose `when`
// hides it at rest is not counted, nor is a knob no tile offers
// (`offeredAnySource`: the card's own knob is a row on no tile). Which presets those are is owner data (rule
// 9), selected by the property rather than named, so a preset that gained or
// lost a knob is swept in or out without a hand edit. Beside each sits its knob,
// the position that knob rests at, and the first position other than the resting
// one: what the record case seeds the fields with and presses at, so that the
// positions it reads back differ from the ones a card recording its knobs'
// DEFAULTS would have written. A one-knob preset whose knob offers no other
// position has no moved case to generate.

const ONE_KNOB = PRESETS.map((preset) => ({
  preset,
  shown: knobsShown(preset, resting(preset)).filter(offeredAnySource),
}))
  .filter(({ shown }) => shown.length === 1)
  .map(({ preset, shown }) => ({
    id: String(preset.id),
    knob: String(shown[0].id),
    rest: String(shown[0].default),
    moved: shown[0].options.map(String).find((option) => option !== String(shown[0].default)),
  }));

// Every knob MOVE the table offers whose two write sets differ in exactly one
// PCM key: for every preset, every combination of its knob positions, every knob
// shown at that combination and every other position that knob offers, the
// write set at the combination against the write set with that one knob moved.
// A hit is one case; the table decides how many there are, and zero hits is
// zero cases.

const MOVES = PRESETS.flatMap((preset) =>
  combos(preset.knobs).flatMap((from) =>
    knobsShown(preset, from)
      .filter(offeredAnySource)
      .flatMap((knob) =>
        knob.options
          .map(String)
          .filter((option) => option !== from[String(knob.id)])
          .map((option) => {
            const to = { ...from, [String(knob.id)]: option };
            const before = writeSet(String(preset.id), "pcm", from);
            const after = writeSet(String(preset.id), "pcm", to);
            const changed = [PCM_1X, PCM_NX].filter((key) => before[key] !== after[key]);
            return { id: String(preset.id), knob: String(knob.id), option, from, before, after, changed };
          })
          .filter(({ changed }) => changed.length === 1),
      ),
  ),
);

// ============================================================================
// a press that would change nothing writes nothing
// ============================================================================
//
// The fields already carry exactly what the lit tile stands for, at the knob
// positions it is showing. A lane that re-stated all four fields anyway would
// leave the user an apply to make and an engine reload to pay for, for no change
// at all. Swept over every preset and every combination of its knob positions,
// so a lane that re-stated fields for a knobbed tile lit at a non-default
// combination is caught; a preset offering no knobs has one combination, the
// empty one.

const LIT = PRESETS.flatMap((preset) =>
  combos(preset.knobs)
    .filter((combo) => seedable(preset, combo))
    .map((combo) => ({
      id: String(preset.id),
      combo,
      where: Object.keys(combo).length === 0 ? "with_no_knobs" : `at_${at(combo)}`,
    })),
);

for (const { id, combo, where } of LIT) {
  test(`test_pressing_the_lit_${id}_tile_${where}_stages_nothing`, async () => {
    const w = await resetTab({ mode: "auto", names: inForce(id, combo) });
    pressTile(seenTabs(), id);
    await flush(w);
    assert.deepEqual(w.staged, EMPTY);
  });
}

// The same on the LIVE lane, where "what the fields carry" is the engine's own
// two filter indices joined to its enumerations rather than a form the daemon
// handed over. The lane is a different wire; the rule is the same one.

for (const { id, combo, where } of LIT) {
  test(`test_pressing_the_lit_${id}_tile_${where}_on_the_live_lane_posts_no_fields`, async () => {
    const w = await resetLive({ ...running(id, combo) });
    pressTile(seenLive(), id);
    await flush(w);
    assert.deepEqual(postedFields(w), {});
  });
}

// ============================================================================
// a press that would change one field writes that one
// ============================================================================
//
// Half the chain already carries the preset's filter and half does not, so the
// press has exactly one field to write. A lane that wrote both fails by naming
// the one it should have left alone. Swept over the one-knob presets at their
// resting position: the 1x end is seeded with what that position names for it,
// and the Nx end is what the press has left to write.

for (const { id, knob, rest } of ONE_KNOB) {
  test(`test_a_${id}_press_at_${knob}_${rest}_stages_only_the_field_whose_value_differs`, async () => {
    const set = writeSet(id, "pcm", { [knob]: rest });
    const w = await resetTab({ mode: "pcm", names: { [PCM_1X]: set[PCM_1X] } });
    pressTile(seenTabs(), id);
    await flush(w);
    assert.deepEqual(stagedNames(w), { [NX_FIELD]: set[PCM_NX] });
  });
}

// And a knob MOVE that lands on a pair the fields half carry already: the tile
// is lit at one combination of its knob positions, and the position pressed
// names a write set differing from that combination's in exactly one PCM key,
// so the move has one field to make. Every such move the table offers is one
// case here.

for (const { id, knob, option, from, before, after, changed } of MOVES) {
  test(`test_moving_${id}_${knob}_to_${option}_at_${at(from)}_stages_only_the_field_that_position_changes`, async () => {
    const w = await resetTab({ mode: "pcm", names: seedPcmPair(before[PCM_1X], before[PCM_NX]) });
    pressKnob(seenTabs(), id, option);
    await flush(w);
    assert.deepEqual(stagedNames(w), { [PCM_FIELD[changed[0]]]: after[changed[0]] });
  });
}

// ============================================================================
// the record is kept either way
// ============================================================================
//
// Where a tile's knobs sit is what a DARK tile shows afterwards
// (tests/js/components/easytiles-knobs.test.js), and it is a fact about the tile
// rather than about the wire: a press that found nothing to write still put the
// tile at those positions, and a card that recorded only when it wrote would
// lose them.

for (const { id, knob, moved } of ONE_KNOB.filter((one) => one.moved !== undefined)) {
  test(`test_a_${id}_press_that_writes_nothing_at_${knob}_${moved}_still_records_the_tiles_knob_positions`, async () => {
    const w = await resetTab({ mode: "auto", names: inForce(id, { [knob]: String(moved) }) });
    pressTile(seenTabs(), id);
    await flush(w);
    assert.deepEqual(knobsFor(id), { [knob]: moved });
  });
}
