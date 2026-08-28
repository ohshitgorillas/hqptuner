// Behavioral suite for Easy Mode's preset tiles: what the two grids lay out
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
// Filter names are the other thing entirely — wire identifiers, stated outright.
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
// Every cell of a grid is a preset tile: the grid holds no placeholder and no
// save-your-own affordance, so a cell count and a tile count are one number.
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
  ALBUM_TILE,
  PLAYLIST_TILE,
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
  cells,
  presetIds,
  knobIds,
  namesWritten,
  seedPcm,
  stagedPcm,
  activeMap,
  knobPositions,
  stagedNames,
  postedFields,
  pressTile,
  pressKnob,
  clickableBoxes,
} = await import("../support/easytiles.js");

// ============================================================================
// what each grid lays out
// ============================================================================
//
// How many cells, then which. The count fails on a grid that gained or lost a
// cell of any kind; the roster below names which preset went missing.

test("test_the_album_grid_lays_out_six_cells", async () => {
  await resetTab({ grid: "album" });
  assert.equal(cells(tabs()), 6);
});

// The roster itself: what each cell of the grid stands for, in order. Stated by
// hand rather than read off `presetsFor`, because a preset id is a wire
// identifier and this is the one case that would catch the table growing a tile
// back — `oneLit` and the active-marking cases below derive their roster FROM
// `presetsFor`, so they agree with whatever it says. A cell standing for no
// preset reads as `undefined` and fails here in place.

test("test_the_album_grids_six_cells_are_the_curated_presets_in_order", async () => {
  await resetTab({ grid: "album" });
  assert.deepEqual(presetIds(tabs()), [
    "perfect-ten",
    "lifelike",
    "concert-hall",
    "purist",
    "old-school",
    "damage-control",
  ]);
});

test("test_the_playlist_grid_lays_out_two_cells", async () => {
  await resetTab({ grid: "playlist" });
  assert.equal(cells(tabs()), 2);
});

test("test_the_playlist_grids_two_cells_are_both_preset_tiles", async () => {
  await resetTab({ grid: "playlist" });
  assert.deepEqual(presetIds(tabs()), ["perfect-ten", "lifelike"]);
});

// ============================================================================
// which tile reads as the one in force
// ============================================================================

test("test_the_tile_whose_write_set_the_fields_carry_is_the_one_marked_active", async () => {
  await resetTab({ mode: "auto", names: inForce(ALBUM_TILE) });
  assert.deepEqual(activeMap(tabs()), oneLit(ALBUM_TILE));
});

test("test_every_tile_is_marked_inactive_while_the_fields_carry_no_presets_write_set", async () => {
  await resetTab({ mode: "auto" });
  assert.deepEqual(activeMap(tabs()), oneLit(null));
});

// The same contract on the OTHER lane, where the values are not a form the
// daemon handed over but the engine's own State joined to its enumerations: the
// two filter indices State reports are looked up in the filters list, and the
// names they land on are what a preset is matched against. Nothing else in this
// file makes a tile light from `engineState`.

test("test_the_live_lane_marks_the_tile_whose_write_set_the_engines_own_filters_match", async () => {
  await resetLive({ grid: "album", ...running(ALBUM_TILE) });
  assert.deepEqual(activeMap(liveCard()), oneLit(ALBUM_TILE));
});

test("test_the_live_lane_marks_every_tile_inactive_while_the_engine_runs_no_presets_filters", async () => {
  await resetLive({ grid: "album" });
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
    pressTile(seenTabs(), ALBUM_TILE);
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
    const w = await resetLive({ grid: "album", mode: engineMode, output: label, chain });
    pressTile(seenLive(), ALBUM_TILE);
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
// The chain-split pair is the sharpest of the four, because the fixture's PCM
// enumeration carries no `-2s` entry at all: a lane routing an SDM value to a
// PCM field has nothing there to resolve it against.

test("test_an_album_tile_press_routes_its_write_set_by_enum_id_onto_the_pcm_fields", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressTile(seenTabs(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames("album", ALBUM_TILE, "pcm"));
});

test("test_a_playlist_tile_press_routes_its_two_filters_onto_the_two_pcm_fields", async () => {
  const w = await resetTab({ grid: "playlist", mode: "pcm" });
  pressTile(seenTabs(), PLAYLIST_TILE);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames("playlist", PLAYLIST_TILE, "pcm"));
});

for (const presetId of ["old-school", "damage-control"]) {
  test(`test_pressing_${presetId}_routes_its_per_chain_names_onto_the_field_enumerating_each`, async () => {
    const w = await resetTab({ grid: "album", mode: "auto" });
    pressTile(seenTabs(), presetId);
    await flush(w);
    assert.deepEqual(stagedNames(w), expectedNames("album", presetId, "auto"));
  });
}

// ============================================================================
// the knobs
// ============================================================================

// The two knobs the combined presets carry, in the order the tile lays them
// out. A knob id is a wire identifier, and so is the order here: `source` picks
// which pair of filters is in play and `emphasis` picks between them, so a tile
// showing them the other way round reads backwards.

for (const presetId of ["perfect-ten", "lifelike"]) {
  test(`test_the_${presetId}_tile_carries_a_source_knob_and_then_an_emphasis_knob`, async () => {
    await resetTab({ grid: "album", mode: "pcm" });
    assert.deepEqual(knobIds(tabs(), presetId), ["source", "emphasis"]);
  });
}

test("test_moving_a_tiles_knob_writes_that_preset_at_the_new_position", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressKnob(seenTabs(), PICK.preset, PICK.option);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames("album", PICK.preset, "pcm", { [PICK.knob]: PICK.option }));
});

test("test_an_active_tiles_knob_shows_the_position_the_fields_match", async () => {
  await resetTab({ grid: "album", mode: "auto", names: inForce(PICK.preset, { [PICK.knob]: PICK.option }) });
  assert.deepEqual(knobPositions(tabs(), PICK.preset, PICK.knob), [PICK.option]);
});

test("test_an_inactive_tiles_knob_shows_its_default_position", async () => {
  await resetTab({ grid: "album", mode: "auto" });
  assert.deepEqual(knobPositions(tabs(), PICK.preset, PICK.knob), [PICK.fallback]);
});

// ============================================================================
// the two-knob presets, position by position
// ============================================================================
//
// The owner's album table for the two presets that carry both knobs, read
// through a press: what lands in the daemon's two PCM filter fields at each of
// the four `source`/`emphasis` combinations. Filter NAMES stated outright here,
// not read back out of `writeSet` the way the routing cases above do — the
// names ARE the behavior under revision, and deriving them would only ask the
// table to agree with itself. Every one of the eight is confirmed present in
// the running engine's filter enumeration.
//
// A knob press writes the preset at the pressed position; the untouched case is
// therefore the defaults, `source=standard` and `emphasis=space`, reached by
// pressing the tile itself. The fourth combination is the only one needing a
// seeded field: `hires`/`transients` is two positions away from the defaults,
// so the tile is seeded already carrying its family's hi-res filter — which is
// what puts its `source` knob on `hires` — and the `emphasis` knob is moved
// from there.

/** @type {[string, Record<string, string>][]} */
const FAMILIES = [
  [
    "perfect-ten",
    {
      standardSpace: "poly-sinc-gauss-long",
      standardTransients: "poly-sinc-gauss-medium",
      hiresSpace: "poly-sinc-gauss-hires-lp",
      hiresTransients: "poly-sinc-gauss-hires-mp",
    },
  ],
  [
    "lifelike",
    {
      standardSpace: "poly-sinc-ext2-long",
      standardTransients: "poly-sinc-ext2-medium",
      hiresSpace: "poly-sinc-ext2-hires-lp",
      hiresTransients: "poly-sinc-ext2-hires-mp",
    },
  ],
];

for (const [presetId, name] of FAMILIES) {
  test(`test_an_untouched_${presetId}_tile_writes_its_standard_source_filter_for_space`, async () => {
    const w = await resetTab({ grid: "album", mode: "pcm" });
    pressTile(seenTabs(), presetId);
    await flush(w);
    assert.deepEqual(stagedNames(w), stagedPcm(name.standardSpace));
  });

  test(`test_moving_${presetId}_to_transients_writes_its_standard_source_filter_for_transients`, async () => {
    const w = await resetTab({ grid: "album", mode: "pcm" });
    pressKnob(seenTabs(), presetId, "transients");
    await flush(w);
    assert.deepEqual(stagedNames(w), stagedPcm(name.standardTransients));
  });

  test(`test_moving_${presetId}_to_the_hires_source_writes_its_hires_filter_for_space`, async () => {
    const w = await resetTab({ grid: "album", mode: "pcm" });
    pressKnob(seenTabs(), presetId, "hires");
    await flush(w);
    assert.deepEqual(stagedNames(w), stagedPcm(name.hiresSpace));
  });

  test(`test_moving_a_hires_${presetId}_to_transients_writes_its_hires_filter_for_transients`, async () => {
    const w = await resetTab({ grid: "album", mode: "pcm", names: seedPcm(name.hiresSpace) });
    pressKnob(seenTabs(), presetId, "transients");
    await flush(w);
    assert.deepEqual(stagedNames(w), stagedPcm(name.hiresTransients));
  });

  // The seed the case above rests on, asserted in its own right: a hi-res
  // filter in the fields is that family's tile, at `source=hires`.

  test(`test_a_hires_filter_in_the_fields_marks_the_${presetId}_tile_active`, async () => {
    await resetTab({ grid: "album", mode: "pcm", names: seedPcm(name.hiresSpace) });
    assert.deepEqual(activeMap(tabs()), oneLit(presetId));
  });

  test(`test_a_hires_filter_in_the_fields_shows_the_${presetId}_source_knob_on_hires`, async () => {
    await resetTab({ grid: "album", mode: "pcm", names: seedPcm(name.hiresSpace) });
    assert.deepEqual(knobPositions(tabs(), presetId, "source"), ["hires"]);
  });

  test(`test_an_inactive_${presetId}_tile_shows_its_source_knob_on_standard`, async () => {
    await resetTab({ grid: "album", mode: "pcm" });
    assert.deepEqual(knobPositions(tabs(), presetId, "source"), ["standard"]);
  });
}

// The filters that left Easy Mode with the revision. Not "no tile says the word
// short" — a filter name is a wire identifier, and this asks the whole album
// table, every preset at every knob combination, whether either name is still
// reachable.

const RETIRED = ["poly-sinc-gauss-short", "poly-sinc-ext2-short"];

test("test_no_album_preset_writes_a_retired_short_filter_at_any_knob_combination", () => {
  assert.deepEqual(
    namesWritten("album").filter((name) => RETIRED.includes(name)),
    [],
  );
});

// ============================================================================
// the two lanes are two wires
// ============================================================================

test("test_a_tile_press_on_the_live_lane_writes_the_live_fields_by_enum_id", async () => {
  const w = await resetLive({ grid: "album" });
  pressTile(seenLive(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(postedFields(w), liveExpected(ALBUM_TILE));
});

test("test_a_tile_press_on_the_live_lane_stages_nothing", async () => {
  const w = await resetLive({ grid: "album" });
  pressTile(seenLive(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(w.staged, EMPTY);
});

test("test_a_tile_press_on_the_tabs_lane_never_reaches_the_live_path", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressTile(seenTabs(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(w.posts, []);
});

// ============================================================================
// the tile box
// ============================================================================
//
// The structural fact the press cases rest on, asserted rather than assumed: a
// handler on the box is what broke this suite once already.

test("test_no_tile_box_carries_a_click_handler_of_its_own", async () => {
  await resetTab({ grid: "album" });
  assert.deepEqual(clickableBoxes(seenTabs()), []);
});
