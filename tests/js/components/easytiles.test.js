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
  TILE,
  SECOND_TILE,
  PICK,
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
  seedPcm,
  seedPcmPair,
  stagedPcm,
  stagedPcmPair,
  activeMap,
  knobPositions,
  stagedNames,
  postedFields,
  pressTile,
  pressKnob,
  pressables,
} = await import("../support/easytiles.js");

// The preset table's public reader, imported the same way the harness is so
// the fake storage is in place before any store module loads. Every filter
// name this file seeds or expects is read out of it, never typed (rule 9).
const { writeSet } = await import("../../../hqptuner/static/store/easy.js");

/** @type {(presetId: string, knobs: Record<string, string>) => Record<string, string>} */
const pcmSet = (presetId, knobs) => writeSet(presetId, "pcm", knobs);

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

test("test_the_tile_whose_write_set_the_fields_carry_is_the_one_marked_active", async () => {
  await resetTab({ mode: "auto", names: inForce(TILE) });
  assert.deepEqual(activeMap(tabs()), oneLit(TILE));
});

test("test_every_tile_is_marked_inactive_while_the_fields_carry_no_presets_write_set", async () => {
  await resetTab({ mode: "auto" });
  assert.deepEqual(activeMap(tabs()), oneLit(null));
});

// The filter the retired `lossy` tile used to write, in the fields: it lights
// `damage-control` now, that name being what its `material` knob writes at its
// `lossy` position, which is where it is read from. A card still matching it to
// a tile of its own would light nothing here, and a card matching it nowhere
// would light nothing either, so the whole map is read, and names which tile
// came up.

test("test_the_lossy_filter_in_the_fields_marks_the_damage_control_tile_active", async () => {
  const lossy = pcmSet("damage-control", { material: "lossy" }).pcm_filter_1x;
  await resetTab({ mode: "pcm", names: seedPcm(lossy) });
  assert.deepEqual(activeMap(tabs()), oneLit("damage-control"));
});

// The same contract on the OTHER lane, where the values are not a form the
// daemon handed over but the engine's own State joined to its enumerations: the
// two filter indices State reports are looked up in the filters list, and the
// names they land on are what a preset is matched against. Nothing else in this
// file makes a tile light from `engineState`.

test("test_the_live_lane_marks_the_tile_whose_write_set_the_engines_own_filters_match", async () => {
  await resetLive({ ...running(TILE) });
  assert.deepEqual(activeMap(liveCard()), oneLit(TILE));
});

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
  test(`test_a_tile_press_in_the_${mode}_output_mode_writes_only_that_modes_filter_fields`, async () => {
    const w = await resetTab({ mode });
    pressTile(seenTabs(), TILE);
    await flush(w);
    assert.deepEqual(Object.keys(w.staged.http).sort(), fields);
  });
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
  test(`test_a_live_tile_press_while_the_engine_reports_${label}_writes_only_that_modes_live_fields`, async () => {
    const w = await resetLive({ mode: engineMode, output: label, chain });
    pressTile(seenLive(), TILE);
    await flush(w);
    assert.deepEqual(Object.keys(postedFields(w)).sort(), fields);
  });
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

test("test_a_tile_press_routes_its_write_set_by_enum_id_onto_the_pcm_fields", async () => {
  const w = await resetTab({ mode: "pcm" });
  pressTile(seenTabs(), TILE);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames(TILE, "pcm"));
});

for (const presetId of ["old-school", "damage-control"]) {
  test(`test_pressing_${presetId}_routes_its_per_chain_names_onto_the_field_enumerating_each`, async () => {
    const w = await resetTab({ mode: "auto" });
    pressTile(seenTabs(), presetId);
    await flush(w);
    assert.deepEqual(stagedNames(w), expectedNames(presetId, "auto"));
  });
}

// ============================================================================
// the knobs
// ============================================================================
//
// What a tile's knob writes when it is moved, and which position it shows.
// `knobPositions` throws when the knob it is asked for is absent, so each of
// these also reads as "the tile carries that knob".

test("test_moving_a_tiles_knob_writes_that_preset_at_the_new_position", async () => {
  const w = await resetTab({ mode: "pcm" });
  pressKnob(seenTabs(), PICK.preset, PICK.option);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames(PICK.preset, "pcm", { [PICK.knob]: PICK.option }));
});

test("test_an_active_tiles_knob_shows_the_position_the_fields_match", async () => {
  await resetTab({ mode: "auto", names: inForce(PICK.preset, { [PICK.knob]: PICK.option }) });
  assert.deepEqual(knobPositions(tabs(), PICK.preset, PICK.knob), [PICK.option]);
});

test("test_an_inactive_tiles_knob_shows_its_default_position", async () => {
  await resetTab({ mode: "auto" });
  assert.deepEqual(knobPositions(tabs(), PICK.preset, PICK.knob), [PICK.fallback]);
});

// ============================================================================
// the two-knob presets, position by position
// ============================================================================
//
// The owner's table for the two presets that carry both knobs, read through a
// press: what lands in the daemon's two PCM filter fields at each of the four
// `emphasis`/`material` combinations. The names come out of `writeSet` at the
// lossless position of each emphasis (rule 9); what these cases pin is the
// SHAPE of each write and which end of the chain it lands on.
//
// WHAT THE TWO MATERIAL POSITIONS DIFFER IN is the shape of the write, not only
// the names: `lossless` writes a PAIR, the standard filter at 1x and the hi-res
// one at Nx, while `lossy` writes the hi-res filter to both ends. So a press
// that moves the material from a seeded lossless pair leaves exactly ONE field
// to write — the Nx end already carries the hi-res name — and that is what makes
// these cases sharper than a pair compared against a pair.
//
// The daemon's own name for the 1x end of the PCM chain — the Nx end it calls
// `filter` and the 1x end `filter1x` (store/live/derive.js). A wire identifier,
// stated the way tests/js/components/easytiles-writes.test.js states it, and
// read by the two cases below whose press leaves exactly one end to write.
const ONE_X_FIELD = "filter1x";

// A knob press writes the preset at the pressed position, and each case here
// names the positions it exercises rather than inheriting either knob's resting
// position — a resting position is the owner's to revisit, and moving it must
// not break a case about what a POSITION writes. Every case away from the
// resting pair is therefore reached from seeded fields: the tile is seeded
// already carrying the pair for the combination under test, which is what puts
// its knobs there, and the knob under test is moved from there.
//
// Where the two knobs REST is one case, immediately below, and only one.

/** @type {(presetId: string) => Record<string, string>} */
const family = (presetId) => {
  const space = pcmSet(presetId, { emphasis: "space", material: "lossless" });
  const transients = pcmSet(presetId, { emphasis: "transients", material: "lossless" });
  return {
    spaceOneX: space.pcm_filter_1x,
    spaceNx: space.pcm_filter_nx,
    transientsOneX: transients.pcm_filter_1x,
    transientsNx: transients.pcm_filter_nx,
  };
};

/** @type {[string, Record<string, string>][]} */
const FAMILIES = [
  ["perfect-ten", family("perfect-ten")],
  ["lifelike", family("lifelike")],
];

// Where the two knobs rest, pressed through the tile body: a press writes the
// preset at whatever positions its knobs are showing, so an untouched tile is
// the one reading of this file that IS about the resting positions. One family
// carries it, because the resting positions belong to the knobs rather than to a
// preset — what the OTHER family writes at each named position is the loop
// below.

const RESTING = FAMILIES[0];

test("test_a_tile_pressed_at_its_resting_knob_positions_writes_the_pair_those_positions_name", async () => {
  const w = await resetTab({ mode: "pcm" });
  pressTile(seenTabs(), RESTING[0]);
  await flush(w);
  assert.deepEqual(stagedNames(w), stagedPcmPair(RESTING[1].spaceOneX, RESTING[1].spaceNx));
});

for (const [presetId, name] of FAMILIES) {
  test(`test_moving_a_lossless_${presetId}_to_transients_writes_its_transients_pair`, async () => {
    const w = await resetTab({ mode: "pcm", names: seedPcmPair(name.spaceOneX, name.spaceNx) });
    pressKnob(seenTabs(), presetId, "transients");
    await flush(w);
    assert.deepEqual(stagedNames(w), stagedPcmPair(name.transientsOneX, name.transientsNx));
  });

  // Material to `lossy` from the lossless pair: the hi-res name goes to both
  // ends, and the Nx end already carries it, so the 1x end is the only field
  // with anything to write. A card wiring the `lossy` position to nothing stages
  // nothing; one that wrote the standard name to both ends stages two fields.

  test(`test_moving_a_lossless_${presetId}_to_lossy_material_writes_its_hires_name_at_1x`, async () => {
    const w = await resetTab({ mode: "pcm", names: seedPcmPair(name.spaceOneX, name.spaceNx) });
    pressKnob(seenTabs(), presetId, "lossy");
    await flush(w);
    assert.deepEqual(stagedNames(w), { [ONE_X_FIELD]: name.spaceNx });
  });

  // And back again, so `lossless` is a position the knob WRITES from rather than
  // only the state a fresh tile is found in. The seeded fields carry the hi-res
  // name at both ends, which is where the material stands; moving back to
  // `lossless` splits the chain, so the 1x end moves to the standard name while
  // the Nx end is left alone.

  test(`test_moving_a_lossy_${presetId}_back_to_lossless_material_writes_its_standard_name_at_1x`, async () => {
    const w = await resetTab({ mode: "pcm", names: seedPcm(name.spaceNx) });
    pressKnob(seenTabs(), presetId, "lossless");
    await flush(w);
    assert.deepEqual(stagedNames(w), { [ONE_X_FIELD]: name.spaceOneX });
  });

  test(`test_moving_a_lossy_${presetId}_to_transients_writes_its_transients_name_to_both_ends`, async () => {
    const w = await resetTab({ mode: "pcm", names: seedPcm(name.spaceNx) });
    pressKnob(seenTabs(), presetId, "transients");
    await flush(w);
    assert.deepEqual(stagedNames(w), stagedPcm(name.transientsNx));
  });

  // The seed the two cases above rest on, asserted in its own right: the hi-res
  // name on both ends of the chain is that family's tile, at `material=lossy`.

  test(`test_a_hires_name_on_both_ends_marks_the_${presetId}_tile_active`, async () => {
    await resetTab({ mode: "pcm", names: seedPcm(name.spaceNx) });
    assert.deepEqual(activeMap(tabs()), oneLit(presetId));
  });

  test(`test_a_hires_name_on_both_ends_shows_the_${presetId}_material_knob_on_lossy`, async () => {
    await resetTab({ mode: "pcm", names: seedPcm(name.spaceNx) });
    assert.deepEqual(knobPositions(tabs(), presetId, "material"), ["lossy"]);
  });
}

// ============================================================================
// a knob on the LIVE lane
// ============================================================================
//
// The same knob on the other wire, where the pair is not a form the daemon
// handed over but the engine's own two filter indices joined to its
// enumerations. One preset carries these: what differs between the lanes is the
// wire, not the table, and the tabs cases above cover both families.

const LIVE_KNOB = { preset: SECOND_TILE, position: "transients" };

test("test_a_knob_press_on_the_live_lane_writes_that_positions_pair_by_enum_id", async () => {
  const w = await resetLive();
  pressKnob(seenLive(), LIVE_KNOB.preset, LIVE_KNOB.position);
  await flush(w);
  assert.deepEqual(postedFields(w), liveExpected(LIVE_KNOB.preset, { emphasis: LIVE_KNOB.position }));
});

test("test_the_live_lane_marks_the_tile_whose_pair_the_engines_own_filters_carry", async () => {
  await resetLive({ ...running(LIVE_KNOB.preset, { emphasis: LIVE_KNOB.position }) });
  assert.deepEqual(activeMap(liveCard()), oneLit(LIVE_KNOB.preset));
});

test("test_the_live_lane_shows_a_tiles_knob_at_the_position_the_engines_filters_carry", async () => {
  await resetLive({ ...running(LIVE_KNOB.preset, { emphasis: LIVE_KNOB.position }) });
  assert.deepEqual(knobPositions(liveCard(), LIVE_KNOB.preset, "emphasis"), [LIVE_KNOB.position]);
});

// The filters that left Easy Mode with the revision are pinned in
// tests/js/store/easy.test.js, where the table they left is the subject: that
// case renders nothing and presses nothing.

// ============================================================================
// the two lanes are two wires
// ============================================================================

test("test_a_tile_press_on_the_live_lane_writes_the_live_fields_by_enum_id", async () => {
  const w = await resetLive();
  pressTile(seenLive(), TILE);
  await flush(w);
  assert.deepEqual(postedFields(w), liveExpected(TILE));
});

test("test_a_tile_press_on_the_live_lane_stages_nothing", async () => {
  const w = await resetLive();
  pressTile(seenLive(), TILE);
  await flush(w);
  assert.deepEqual(w.staged, EMPTY);
});

test("test_a_tile_press_on_the_tabs_lane_never_reaches_the_live_path", async () => {
  const w = await resetTab({ mode: "pcm" });
  pressTile(seenTabs(), TILE);
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
