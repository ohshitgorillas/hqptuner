// Behavioral suite for Easy Mode's preset tiles: what the card lays out
// (components/easy/EasyCard.js), which tile reads as the one the engine is
// currently set to, and what a press on a tile or on a tile's knob writes on
// each of the two lanes (store/easylane.js).
//
// The harness — the daemon form and engine enumeration the lanes are driven
// with, the wire both are watched over, the readers and the click seam — is
// tests/js/support/easytiles.js, imported dynamically below so that the fake
// localStorage is installed before `store/easyview.js` reads it. What each
// preset MEANS is tests/js/store/easy.test.js's; this file is about the lane in
// between the table and the daemon.
//
// THERE IS NO GRID SWITCHER. The card lays out one set of tiles, one per preset
// the store enumerates, so nothing here names a grid and no reading is scoped to one.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals with the shapes
// /api/config, /api/state and /api/enumerations actually serve, and every write
// leaves over a faked `globalThis.fetch` on the real REST paths — the tabs lane
// through POST /api/config/stage, the LIVE lane through POST /api/config/live.
// No store function of HQPTuner's is stubbed.
//
// NAMES, NOT WORDS (rule 9). A tile is found by its `data-preset`, a knob by
// its `data-knob` and a knob position by the `data-v` its option button
// carries. Every title, description, note and label in the preset table is
// owner copy, asserted nowhere, and nothing here is selected on a sentence.
// Filter names are the owner's table too, so they are read out of `writeSet`
// rather than typed.
//
// THE RENDERED CONTRACT these cases rest on:
//   * `data-preset="<presetId>"` and `data-active="0"|"1"` on each tile BOX,
//     which carries no handler of its own
//   * one working `button` inside that box, which is what sets the preset
//   * `data-knob="<knobId>"` on the element wrapping a tile's knob, a sibling of
//     that button, whose option buttons are the shared Segment's `.seg[data-v]`,
//     the selected one `.active`
// The `data-knob` element is read as a wrapper only; nothing here asserts what
// classes it carries. The first two are asserted outright rather than assumed,
// at the foot of this file.
//
// The tile is two nodes, not one, and it has to be: the knob options are
// buttons, and a button inside a button is not markup a browser keeps.
//
// NOT REACHABLE FROM SSR, and left untested rather than reached for: anything a
// tile syncs through `useEffect` or holds in a module-private signal written
// only from an event handler. No private signal is exported to reach one.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const {
  ROSTER,
  PCM_FIELDS,
  SDM_FIELDS,
  ALL_FIELDS,
  EMPTY,
  resetTab,
  resetLive,
  running,
  inForce,
  expectedNames,
  liveExpected,
  oneLit,
  flush,
  tabs,
  liveCard,
  seenTabs,
  seenLive,
  tiles,
  presetIds,
  namedPresets,
  activeMap,
  knobPositions,
  stagedNames,
  postedFields,
  pressTile,
  pressKnob,
  pressables,
  seedable,
  offeredAnySource,
} = await import("../support/easytiles.js");

// The preset table's public readers, imported the same way the harness is so
// the fake storage is in place before any store module loads. Every filter
// name this file seeds or expects is read out of `writeSet`, never typed (rule
// 9); which presets carry which knobs, and which positions each knob offers,
// are read out of `presetsFor` and `knobsShown` for the same reason.
const { writeSet, presetsFor, knobsShown } = await import("../../../hqptuner/static/store/easy.js");
const { combos } = await import("../support/easytable.js");

/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string>, whenHires?: boolean }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

// A knob id is a wire identifier, stated outright. Which presets carry it is
// the owner's, so a sweep asks the table rather than naming one.
const MATERIAL = "material";

/**
 * Every knob of a preset at its `default`, keyed by knob id: where the tile's
 * knobs rest, read from the table rather than typed.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
const resting = (preset) => Object.fromEntries(preset.knobs.map((knob) => [String(knob.id), knob.default]));

/**
 * A combination as `knob=option` pairs joined with `_`, for a test name.
 *
 * @param {Record<string, string>} knobs
 */
const positionsOf = (knobs) =>
  Object.entries(knobs)
    .map(([knobId, option]) => `${knobId}=${option}`)
    .join("_");

/**
 * The fields a write MOVES: those of `to` whose name differs from what `from`
 * carries there, with the name `to` carries. A press stages a field only when
 * its value would change (tests/js/components/easytiles-writes.test.js), so the
 * write for a knob move is this difference and nothing more.
 *
 * @param {Record<string, string>} from
 * @param {Record<string, string>} to
 * @returns {Record<string, string>}
 */
const moved = (from, to) => Object.fromEntries(Object.entries(to).filter(([field, name]) => from[field] !== name));

// The presets carrying at least one knob, and every combination of positions
// each defines that the fields can carry. Selected by property from the table:
// zero presets with a knob means zero knob cases here.

const KNOBBED = PRESETS.filter((preset) => preset.knobs.length > 0);

/** @type {[Preset, Record<string, string>][]} */
const SEEDS = KNOBBED.flatMap((preset) =>
  combos(preset.knobs)
    .filter((knobs) => seedable(preset, knobs))
    .map((knobs) => /** @type {[Preset, Record<string, string>]} */ ([preset, knobs])),
);

// ============================================================================
// what the card lays out
// ============================================================================
//
// How many tiles, then which. The count is the store's, never a literal: how
// many presets exist is owner-curated data (rule 9), so the card is asked to
// lay out one tile per preset `presetsFor` enumerates, however many that is.
// The count fails on a card that gained or lost a tile of any kind; the roster
// below names which preset went missing, or which tile the store stands behind
// no preset for.

test("test_the_card_lays_out_exactly_one_tile_per_preset_the_store_enumerates", async () => {
  await resetTab();
  assert.equal(tiles(tabs()), namedPresets().length);
});

// The roster itself: the grid and the public store name the same presets. Both
// sides sorted, because WHICH presets have tiles is the contract while the
// order they are laid out in is the owner's, rearranged at will (rule 9) — a
// case pinning the sequence goes red on a rearrangement that broke nothing.
//
// Derived from `presetsFor` rather than typed out, so the two surfaces are
// asked to agree with each other instead of with a literal that drifts the
// first time the table is curated. It still bites both ways: a card that
// dropped a tile is missing an id the store names, and a card laying out a tile
// no preset stands behind carries an id the store does not.

test("test_the_card_lays_out_one_tile_for_every_preset_the_store_names", async () => {
  await resetTab();
  assert.deepEqual([...presetIds(tabs())].sort(), namedPresets());
});

// ============================================================================
// which tile reads as the one in force
// ============================================================================

for (const presetId of ROSTER) {
  test(`test_the_${presetId}_write_set_in_the_fields_marks_the_${presetId}_tile_active`, async () => {
    await resetTab({ mode: "auto", names: inForce(presetId) });
    assert.deepEqual(activeMap(tabs()), oneLit(presetId));
  });
}

test("test_every_tile_is_marked_inactive_while_the_fields_carry_no_presets_write_set", async () => {
  await resetTab({ mode: "auto" });
  assert.deepEqual(activeMap(tabs()), oneLit(null));
});

// What a `material` knob writes, in the fields, at every position of every knob
// its tile carries: the tile it belongs to lights, and its material knob shows
// the position that write was made at. Swept over the presets carrying the
// knob rather than naming one, and over the positions each knob defines rather
// than typing them: the filter the retired `lossy` tile used to write is one of
// these, and a card still matching it to a tile of its own would light nothing
// here. The whole map is read so a failure names which tile came up.

/** @type {[Preset, Record<string, string>][]} */
const MATERIAL_SEEDS = SEEDS.filter(([preset]) => preset.knobs.some((knob) => String(knob.id) === MATERIAL));

for (const [preset, knobs] of MATERIAL_SEEDS) {
  test(`test_${preset.id}_at_${positionsOf(knobs)}_in_the_fields_marks_that_tile_active`, async () => {
    await resetTab({ mode: "pcm", names: writeSet(preset.id, "pcm", knobs) });
    assert.deepEqual(activeMap(tabs()), oneLit(preset.id));
  });

  test(`test_${preset.id}_at_${positionsOf(knobs)}_in_the_fields_shows_its_material_knob_at_${knobs[MATERIAL]}`, async () => {
    await resetTab({ mode: "pcm", names: writeSet(preset.id, "pcm", knobs) });
    assert.deepEqual(knobPositions(tabs(), preset.id, MATERIAL), [knobs[MATERIAL]]);
  });
}

// The same contract on the OTHER lane, where the values are not a form the
// daemon handed over but the engine's own State joined to its enumerations: the
// two filter indices State reports are looked up in the filters list, and the
// names they land on are what a preset is matched against. Nothing else in this
// file makes a tile light from `engineState`.

for (const presetId of ROSTER) {
  test(`test_the_live_lane_marks_${presetId}_active_while_the_engines_own_filters_match_its_write_set`, async () => {
    await resetLive({ ...running(presetId) });
    assert.deepEqual(activeMap(liveCard()), oneLit(presetId));
  });
}

test("test_the_live_lane_marks_every_tile_inactive_while_the_engine_runs_no_presets_filters", async () => {
  await resetLive();
  assert.deepEqual(activeMap(liveCard()), oneLit(null));
});

// ============================================================================
// which fields a press writes, by output mode
// ============================================================================
//
// Field NAMES only here — which filter lands in them is the next section's. A
// mode that reached across to the other chain fails by naming the field it
// should not have touched.

/** @type {[string, string[]][]} */
const MODE_FIELDS = [
  ["pcm", PCM_FIELDS],
  ["sdm", SDM_FIELDS],
  ["auto", ALL_FIELDS],
];

for (const [mode, fields] of MODE_FIELDS) {
  for (const presetId of ROSTER) {
    test(`test_a_${presetId}_press_in_the_${mode}_output_mode_writes_only_that_modes_filter_fields`, async () => {
      const w = await resetTab({ mode });
      pressTile(seenTabs(), presetId);
      await flush(w);
      assert.deepEqual(Object.keys(w.staged.http).sort(), fields);
    });
  }
}

// The output mode again on the LIVE lane, where it is not a form field but the
// engine's own reported mode name. Same three answers reached by a different
// derivation, so a lane that only ever asked the config form which mode it was
// in writes the PCM pair for all three and fails on two.
//
// The `chain` each case names is the one the engine reports LOADED, and the
// auto case is the only one in this file that writes to the DORMANT chain — the
// one whose option list comes from /api/config rather than from the
// enumerations (see `resetLive`). That path has no other coverage here.

/** @type {[string, string, string, string[]][]} */
const LIVE_MODES = [
  ["pcm", "PCM", "pcm", PCM_FIELDS],
  ["sdm", "SDM (DSD)", "sdm", SDM_FIELDS],
  ["auto", "[SOURCE]", "pcm", ALL_FIELDS],
];

for (const [label, engineMode, chain, fields] of LIVE_MODES) {
  for (const presetId of ROSTER) {
    test(`test_a_live_${presetId}_press_while_the_engine_reports_${label}_writes_only_that_modes_live_fields`, async () => {
      const w = await resetLive({ mode: engineMode, output: label, chain });
      pressTile(seenLive(), presetId);
      await flush(w);
      assert.deepEqual(Object.keys(postedFields(w)).sort(), fields);
    });
  }
}

// ============================================================================
// where a press ROUTES what the table names
// ============================================================================
//
// What each preset stands for is tests/js/store/easy.test.js's — these read the
// table through `writeSet` rather than restating it. What they are for is the
// lane in between: that a press carries each schema key to the daemon's own
// field for it, and that the lane resolves the preset's filter NAME against the
// option list THAT field is showing, staging the enum id rather than the name.
// The chain-split presets are the sharpest, because the fixture's PCM
// enumeration carries no `-2s` entry at all: a lane routing an SDM value to a
// PCM field has nothing there to resolve it against.

for (const presetId of ROSTER) {
  test(`test_a_${presetId}_press_routes_its_write_set_by_enum_id_onto_the_pcm_fields`, async () => {
    const w = await resetTab({ mode: "pcm" });
    pressTile(seenTabs(), presetId);
    await flush(w);
    assert.deepEqual(stagedNames(w), expectedNames(presetId, "pcm"));
  });
}

// The chain-split cells, selected by property rather than by naming a preset:
// every (preset, combination) the table defines whose SDM write differs from
// its PCM write on either end of the chain. Zero such cells generate zero cases.
//
// A cell off the tile's resting positions is reached the way a user reaches it:
// the tile is pressed, then each knob the cell parks off its default is moved
// there, one press per knob on a fresh render. The staging buffer merges field
// by field, so what it holds at the end is the write for the cell itself.

/** @type {[Preset, Record<string, string>][]} */
const CELLS = PRESETS.flatMap((preset) =>
  combos(preset.knobs)
    .filter((c) => seedable(preset, c))
    .map((c) => /** @type {[Preset, Record<string, string>]} */ ([preset, c])),
);

/** @type {[Preset, Record<string, string>][]} */
const CHAIN_SPLIT = CELLS.filter(([preset, c]) => {
  const sdm = writeSet(preset.id, "sdm", c);
  const pcm = writeSet(preset.id, "pcm", c);
  return sdm.sdm_filter_1x !== pcm.pcm_filter_1x || sdm.sdm_filter_nx !== pcm.pcm_filter_nx;
});

for (const [preset, c] of CHAIN_SPLIT) {
  const moves = knobsShown(preset, c).filter((knob) => c[String(knob.id)] !== knob.default);

  test(`test_pressing_${preset.id}_at_${positionsOf(c)}_routes_its_per_chain_names_onto_the_field_enumerating_each`, async () => {
    const w = await resetTab({ mode: "auto" });
    pressTile(seenTabs(), preset.id);
    await flush(w);
    for (const knob of moves) {
      pressKnob(seenTabs(), preset.id, c[String(knob.id)]);
      await flush(w);
    }
    assert.deepEqual(stagedNames(w), expectedNames(preset.id, "auto", c));
  });
}

// ============================================================================
// the knobs
// ============================================================================
//
// What a tile's knob writes when it is moved, and which position it shows.
// `knobPositions` throws when the knob it is asked for is absent, so each of
// these also reads as "the tile carries that knob".

// ============================================================================
// every knob of every preset, position by position
// ============================================================================
//
// The owner's table read through a press: what lands in the daemon's two PCM
// filter fields when one knob is moved from one combination of positions to
// another. Every preset carrying a knob, every combination the fields can
// carry, every knob the tile offers there, every OTHER position that knob
// defines; the moved knob and its target come out of the table, never typed.
//
// A knob press writes the preset at the pressed position, and each case names
// the positions it exercises rather than inheriting any knob's resting position:
// a resting position is the owner's to revisit, and moving it must not break a
// case about what a POSITION writes. Every case is therefore reached from
// seeded fields: the tile is seeded already carrying the write for the
// combination under test, which is what puts its knobs there, and the knob
// under test is moved from there. What that press stages is the DIFFERENCE
// between the two write sets: a field already carrying the name the new
// position writes has nothing to write, so a material move that changes one
// end of the chain stages one field, and a card wiring a position to nothing
// stages nothing.
//
// Where the knobs REST is the per-preset routing sweep above, which presses each
// tile untouched, and only that one.

/** @type {[Preset, Record<string, string>, string, string][]} */
const KNOB_MOVES = SEEDS.flatMap(([preset, from]) =>
  knobsShown(preset, from)
    .filter(offeredAnySource)
    .flatMap((knob) =>
      knob.options
        .filter((option) => option !== from[String(knob.id)])
        .map(
          (option) =>
            /** @type {[Preset, Record<string, string>, string, string]} */ ([preset, from, String(knob.id), option]),
        ),
    ),
);

for (const [preset, from, knobId, option] of KNOB_MOVES) {
  const to = { ...from, [knobId]: option };

  test(`test_moving_${preset.id}_${knobId}_from_${positionsOf(from)}_to_${option}_stages_the_fields_that_move`, async () => {
    const w = await resetTab({ mode: "pcm", names: writeSet(preset.id, "pcm", from) });
    pressKnob(seenTabs(), preset.id, option);
    await flush(w);
    assert.deepEqual(stagedNames(w), moved(expectedNames(preset.id, "pcm", from), expectedNames(preset.id, "pcm", to)));
  });
}

// ============================================================================
// a knob on the LIVE lane
// ============================================================================
//
// The knobs on the other wire, where the pair is not a form the daemon handed
// over but the engine's own two filter indices joined to its enumerations. One
// move per knob per preset, from rest to each other position the knob defines:
// what differs between the lanes is the wire, not the table, and the tabs sweep
// above walks every combination.

/** @type {[Preset, string, string][]} */
const LIVE_MOVES = KNOBBED.flatMap((preset) =>
  knobsShown(preset, resting(preset))
    .filter(offeredAnySource)
    .flatMap((knob) =>
      knob.options
        .filter((option) => option !== knob.default)
        .map((option) => /** @type {[Preset, string, string]} */ ([preset, String(knob.id), option])),
    ),
);

for (const [preset, knobId, option] of LIVE_MOVES) {
  const at = { ...resting(preset), [knobId]: option };

  test(`test_a_${preset.id}_${knobId}_press_to_${option}_on_the_live_lane_writes_that_positions_pair_by_enum_id`, async () => {
    const w = await resetLive();
    pressKnob(seenLive(), preset.id, option);
    await flush(w);
    assert.deepEqual(postedFields(w), liveExpected(preset.id, at));
  });

  test(`test_the_live_lane_marks_${preset.id}_active_while_the_engine_carries_its_${knobId}_${option}_pair`, async () => {
    await resetLive({ ...running(preset.id, at) });
    assert.deepEqual(activeMap(liveCard()), oneLit(preset.id));
  });

  test(`test_the_live_lane_shows_${preset.id}_${knobId}_at_${option}_while_the_engine_carries_that_pair`, async () => {
    await resetLive({ ...running(preset.id, at) });
    assert.deepEqual(knobPositions(liveCard(), preset.id, knobId), [option]);
  });
}

// The filters that left Easy Mode with the revision are pinned in
// tests/js/store/easy.test.js, where the table they left is the subject: that
// case renders nothing and presses nothing.

// ============================================================================
// the two lanes are two wires
// ============================================================================

test("test_a_tile_press_on_the_live_lane_writes_the_live_fields_by_enum_id", async () => {
  const w = await resetLive();
  pressTile(seenLive(), ROSTER[0]);
  await flush(w);
  assert.deepEqual(postedFields(w), liveExpected(ROSTER[0]));
});

test("test_a_tile_press_on_the_live_lane_stages_nothing", async () => {
  const w = await resetLive();
  pressTile(seenLive(), ROSTER[0]);
  await flush(w);
  assert.deepEqual(w.staged, EMPTY);
});

test("test_a_tile_press_on_the_tabs_lane_never_reaches_the_live_path", async () => {
  const w = await resetTab({ mode: "pcm" });
  pressTile(seenTabs(), ROSTER[0]);
  await flush(w);
  assert.deepEqual(w.posts, []);
});

// ============================================================================
// the tile box
// ============================================================================
//
// What every press case above rests on, asserted rather than assumed: a tile
// offers a pointer exactly one thing to press. Two of them and "pressing the
// tile" names nothing in particular; none and the tile cannot be set at all.
// The count going wrong is what broke ten cases in this file once already.

test("test_each_tile_offers_exactly_one_pressable_button", async () => {
  await resetTab();
  assert.deepEqual(pressables(tabs()), Object.fromEntries(namedPresets().map((id) => [id, 1])));
});
