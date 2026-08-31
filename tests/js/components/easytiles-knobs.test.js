// Behavioral suite for what a DARK Easy Mode tile shows on its knobs: the
// positions last recorded for that preset, rather than the knob's
// hardcoded default. Recording happens where the positions are written — a knob
// moved, or the tile pressed — and the record is read back through
// `store/easyview.js`'s `knobsFor`.
//
// The companion file is tests/js/components/easytiles.test.js, which owns the
// tiles, the active marking and where a press routes what the table names. Only
// the knob-memory half lives here, and it reuses that file's harness whole:
// tests/js/support/easytiles.js, imported dynamically after `useStorage()` so
// that `store/easyview.js` meets the fake localStorage at its load-time read.
// The store's OWN behavior — reading back, per-preset separation,
// surviving a reload — is tests/js/store/easyview.test.js's.
//
// WHAT IS RESET. The record is a module-level signal and outlives a case, so
// `resetTab` and `resetLive` clear it along with every other signal either lane
// reads — a press made by one case is otherwise still recorded when the next one
// renders. Every case here therefore records AFTER its reset, never before. The
// two cross-lane cases at the foot of the file are the exception and ask for
// `keepKnobs`: there the reset is standing in for a user changing lanes, which
// the record is meant to cross.
//
// WHAT IS NOT PINNED. The shape of the record is not read. How a
// preset is spelt into a key, and how a knob map is nested under it, is the
// writer's business — the record is only ever reached through `rememberKnobs`
// and `knobsFor`, exactly as a caller reaches it.
//
// NAMES, NOT WORDS (rule 9). Preset ids, knob ids and knob option ids are wire
// identifiers and are stated outright. Filter names are owner data and are read
// off `store/easy.js`'s `writeSet` for the position they stand for, never typed;
// nothing here asserts a title, a description or any other piece of owner copy.
//
// PROPERTIES, NOT EXEMPLARS. No preset is named here to stand for a kind of
// tile. The cases about a tile with two or more knobs sweep every preset that
// offers two or more knobs at its defaults, the cases about a one-knob tile
// sweep every preset that offers exactly one, and "another tile" is every other
// preset on the roster. Positions come off the table too: a knob rests at its
// `default`, and a MOVED position is the first option that knob offers other
// than its default. A knob with no such option has nothing to move to and
// generates no case; a roster with no preset of a kind generates none either.
// The names of the generated cases carry the preset id and the knob ids they
// were generated for, so a failure names the tile and the knob.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-knobs.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const {
  resetTab,
  resetLive,
  seedPcmPair,
  flush,
  tabs,
  liveCard,
  seenTabs,
  seenLive,
  knobPositions,
  pressTile,
  pressKnob,
  offeredAnySource,
} = await import("../support/easytiles.js");

const { rememberKnobs, knobsFor } = await import("../../../hqptuner/static/store/easyview.js");
const { writeSet, presetsFor, knobsShown } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string>, whenHires?: boolean }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

/**
 * The PCM pair a preset writes at a knob combination, read off the table so
 * that no filter name is typed here.
 *
 * @param {string} preset
 * @param {Record<string, string>} knobs
 * @returns {{ oneX: string, nX: string }}
 */
const pairFor = (preset, knobs) => {
  const set = writeSet(preset, "pcm", knobs);
  return { oneX: set.pcm_filter_1x, nX: set.pcm_filter_nx };
};

// --- the roster, by property ------------------------------------------------------

/** @type {Preset[]} */
const PRESETS = presetsFor();

/** Every preset id the card has. */
const ROSTER = PRESETS.map((preset) => String(preset.id));

/**
 * Every knob of a preset at its `default`: where the tile rests until something
 * moves it.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
const restingOf = (preset) => Object.fromEntries(preset.knobs.map((knob) => [String(knob.id), knob.default]));

/**
 * The knobs a preset offers at its defaults, read through `knobsShown()` so a
 * knob whose `when` hides it at rest is not counted, and a knob the source
 * gates out of the rendering (`offeredAnySource`) is not counted either.
 *
 * @param {Preset} preset
 * @returns {Knob[]}
 */
const shownAtRest = (preset) => knobsShown(preset, restingOf(preset)).filter(offeredAnySource);

/**
 * The first position a knob offers other than its default, or `undefined` for a
 * knob that offers nothing else.
 *
 * @param {Knob} knob
 * @returns {string | undefined}
 */
const movedOf = (knob) => knob.options.map(String).find((option) => option !== String(knob.default));

/**
 * The knobs a preset offers at rest that have a position to move to, each paired
 * with that position.
 *
 * @param {Preset} preset
 * @returns {{ knob: Knob, moved: string }[]}
 */
const movable = (preset) =>
  shownAtRest(preset).flatMap((knob) => {
    const moved = movedOf(knob);
    return moved === undefined ? [] : [{ knob, moved }];
  });

/**
 * One knob moved off its default with every neighbour left at rest.
 *
 * @param {Preset} preset
 * @param {Knob} knob
 * @param {string} moved
 * @returns {Record<string, string>}
 */
const oneMoved = (preset, knob, moved) => ({ ...restingOf(preset), [String(knob.id)]: moved });

/**
 * Every knob a preset offers at rest moved off its default, where it has
 * somewhere to move to.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
const allMoved = (preset) =>
  Object.fromEntries(shownAtRest(preset).map((knob) => [String(knob.id), movedOf(knob) ?? String(knob.default)]));

/**
 * The knobs a preset still offers once one knob is moved off its default, the
 * moved knob itself excluded.
 *
 * @param {Preset} preset
 * @param {Knob} knob
 * @param {string} moved
 * @returns {Knob[]}
 */
const neighboursShown = (preset, knob, moved) =>
  knobsShown(preset, oneMoved(preset, knob, moved))
    .filter(offeredAnySource)
    .filter((other) => String(other.id) !== String(knob.id));

/**
 * The positions one tile marks on every knob it offers at rest, in the order the
 * preset offers them.
 *
 * @param {string} out
 * @param {Preset} preset
 * @returns {(string | undefined)[][]}
 */
const restingRow = (out, preset) =>
  shownAtRest(preset).map((knob) => knobPositions(out, String(preset.id), String(knob.id)));

/**
 * What that row reads when every knob stands at its default.
 *
 * @param {Preset} preset
 * @returns {string[][]}
 */
const defaultsRow = (preset) => shownAtRest(preset).map((knob) => [String(knob.default)]);

/** The knob ids a preset offers at rest, joined for a case name. */
const knobIdsOf = (/** @type {Preset} */ preset) =>
  shownAtRest(preset)
    .map((knob) => String(knob.id))
    .join("_and_");

/** Every preset on the roster other than this one. */
const othersOf = (/** @type {Preset} */ preset) => ROSTER.filter((id) => id !== String(preset.id));

/** The presets offering two or more knobs at their defaults. */
const MULTI_KNOB = PRESETS.filter((preset) => shownAtRest(preset).length >= 2);

/** The presets offering exactly one knob at its defaults. */
const ONE_KNOB = PRESETS.filter((preset) => shownAtRest(preset).length === 1);

// ============================================================================
// the fields carrying a moved position light the tile with the knob on it
// ============================================================================
//
// For every tile and every knob it offers at rest that has somewhere to move
// to: the pair the table writes with that one knob moved, seeded into the
// fields, lights the tile with that knob marked at the moved position. What the
// tile shows is the state the engine is in, read back off the four filter fields.

for (const preset of PRESETS) {
  for (const { knob, moved } of movable(preset)) {
    const presetId = String(preset.id);
    const knobId = String(knob.id);
    test(`test_the_fields_carrying_${presetId}_with_${knobId}_moved_show_that_knob_on_the_moved_position`, async () => {
      const pair = pairFor(presetId, oneMoved(preset, knob, moved));
      await resetTab({ mode: "pcm", names: seedPcmPair(pair.oneX, pair.nX) });
      assert.deepEqual(knobPositions(tabs(), presetId, knobId), [moved]);
    });
  }
}

// ============================================================================
// a tile that is not lit shows what was recorded for it
// ============================================================================

for (const preset of MULTI_KNOB) {
  const presetId = String(preset.id);

  for (const { knob, moved } of movable(preset)) {
    const knobId = String(knob.id);

    test(`test_a_dark_${presetId}_tile_shows_the_${knobId}_position_last_recorded_for_it`, async () => {
      await resetTab({ mode: "pcm" });
      rememberKnobs(presetId, oneMoved(preset, knob, moved));
      assert.deepEqual(knobPositions(tabs(), presetId, knobId), [moved]);
    });

    // One knob recorded, a neighbour not. Both are read in the one assertion,
    // because "the recorded one moved" and "the unrecorded one did not" are
    // halves of a single claim about a partial record: a tile that dragged its
    // whole knob row along with the one recorded position fails here in place.
    // The neighbours are the knobs the tile offers AT THE RECORDED STATE: a knob
    // whose `when` hides it once this one moves is not on the tile to be read.

    for (const neighbour of neighboursShown(preset, knob, moved)) {
      const neighbourId = String(neighbour.id);
      test(`test_a_dark_${presetId}_tiles_unrecorded_${neighbourId}_knob_stays_at_its_default_while_its_${knobId}_neighbour_shows_its_record`, async () => {
        await resetTab({ mode: "pcm" });
        rememberKnobs(presetId, { [knobId]: moved });
        const out = tabs();
        assert.deepEqual(
          [knobPositions(out, presetId, neighbourId), knobPositions(out, presetId, knobId)],
          [[String(neighbour.default)], [moved]],
        );
      });
    }
  }

  // A record belongs to the tile it was made for. Nothing is recorded for this
  // tile, so every knob it offers reads its default while another tile carries
  // a full record: the state Easy Mode was already in before tiles remembered
  // anything, and a guard rather than a new claim.

  for (const otherId of othersOf(preset)) {
    const other = /** @type {Preset} */ (PRESETS.find((candidate) => String(candidate.id) === otherId));
    test(`test_a_dark_${presetId}_tile_shows_${knobIdsOf(preset)}_at_their_defaults_while_only_${otherId}_has_positions_recorded`, async () => {
      await resetTab({ mode: "pcm" });
      rememberKnobs(otherId, allMoved(other));
      assert.deepEqual(restingRow(tabs(), preset), defaultsRow(preset));
    });
  }
}

// ============================================================================
// a tile that IS lit reads the fields, not the record
// ============================================================================
//
// The fields carry the tile at its resting pair while the record says every
// knob is moved somewhere else. What the tile is showing is the state the
// engine is actually in, so the record loses: a card that let the record win
// would put a lit tile out of step with the four filter fields underneath it.

for (const preset of MULTI_KNOB) {
  const presetId = String(preset.id);
  test(`test_a_lit_${presetId}_tiles_${knobIdsOf(preset)}_knobs_show_the_positions_its_filters_carry_whatever_was_recorded`, async () => {
    const pair = pairFor(presetId, restingOf(preset));
    await resetTab({ mode: "pcm", names: seedPcmPair(pair.oneX, pair.nX) });
    rememberKnobs(presetId, allMoved(preset));
    assert.deepEqual(restingRow(tabs(), preset), defaultsRow(preset));
  });
}

// ============================================================================
// what writing a preset records
// ============================================================================
//
// Read through `knobsFor`, the store's own reader, because what a press records
// is a claim about the record and not about a rendering. The positions a press
// records are the positions it WROTE, which for a knob move is the moved knob
// plus its neighbours where they stood, and for a plain tile press is the whole
// row the press wrote. The knob-move cases seed the fields with every neighbour
// MOVED and the pressed knob at rest, so that the neighbour they read back
// stands at a position they stated rather than one inherited from wherever it
// happens to rest: a resting position is the owner's to revisit, and moving it
// must not break a case about what a press RECORDS. The tile-press cases read
// the ONE-KNOB presets: what a press records is the subject, and a preset
// carrying one knob has no neighbour to disturb that reading.
//
// The neighbours "where they stood" are the knobs the tile OFFERED as it stood
// before the press, read through `knobsShown()` at the seeded combination: a
// knob whose `when` is not met there is not on the tile and is not a position
// the user set, and a knob the move brings onto the tile was standing nowhere.

/**
 * The positions a tile standing at a combination offers: that combination, on
 * the knobs shown there.
 *
 * @param {Preset} preset
 * @param {Record<string, string>} combo
 * @returns {Record<string, string>}
 */
const writtenAt = (preset, combo) =>
  Object.fromEntries(knobsShown(preset, combo).map((knob) => [String(knob.id), combo[String(knob.id)]]));

/**
 * The fields a knob-move case starts from: every neighbour moved, the pressed
 * knob at its default. A neighbour whose move would take the pressed knob OFF
 * the tile (its `when` no longer met) is left at rest, since a knob the tile
 * does not offer cannot be pressed.
 *
 * @param {Preset} preset
 * @param {Knob} knob
 * @returns {Record<string, string>}
 */
const neighboursMoved = (preset, knob) => {
  const knobId = String(knob.id);
  const offers = (/** @type {Record<string, string>} */ combo) =>
    knobsShown(preset, combo).some((shown) => String(shown.id) === knobId);
  return shownAtRest(preset).reduce((combo, other) => {
    const moved = movedOf(other);
    if (String(other.id) === knobId || moved === undefined) return combo;
    const next = { ...combo, [String(other.id)]: moved };
    return offers(next) ? next : combo;
  }, restingOf(preset));
};

for (const preset of MULTI_KNOB) {
  const presetId = String(preset.id);
  for (const { knob, moved } of movable(preset)) {
    const knobId = String(knob.id);
    const start = neighboursMoved(preset, knob);
    const written = { ...writtenAt(preset, start), [knobId]: moved };

    test(`test_moving_the_${presetId}_${knobId}_knob_records_the_positions_that_press_wrote`, async () => {
      const pair = pairFor(presetId, start);
      const w = await resetTab({ mode: "pcm", names: seedPcmPair(pair.oneX, pair.nX) });
      pressKnob(seenTabs(), presetId, moved);
      await flush(w);
      assert.deepEqual(knobsFor(presetId), written);
    });

    test(`test_a_press_on_the_${presetId}_${knobId}_knob_on_the_live_lane_records_the_positions_it_wrote`, async () => {
      const pair = pairFor(presetId, start);
      const w = await resetLive({ oneX: pair.oneX, nX: pair.nX });
      pressKnob(seenLive(), presetId, moved);
      await flush(w);
      assert.deepEqual(knobsFor(presetId), written);
    });
  }
}

for (const preset of ONE_KNOB) {
  const presetId = String(preset.id);
  test(`test_pressing_the_${presetId}_tile_records_the_${knobIdsOf(preset)}_position_that_press_wrote`, async () => {
    const w = await resetTab({ mode: "pcm" });
    pressTile(seenTabs(), presetId);
    await flush(w);
    assert.deepEqual(knobsFor(presetId), writtenAt(preset, restingOf(preset)));
  });
}

// ============================================================================
// the whole round trip, as a user meets it
// ============================================================================
//
// The defect this behavior was added for: a knob set on one tile, then another
// tile pressed, and the first tile's knob back at its default. The light moves
// away from the tile that was written and the position it was written at is
// still on it. Every other tile on the roster takes the light in turn.

for (const preset of MULTI_KNOB) {
  const presetId = String(preset.id);
  for (const { knob, moved } of movable(preset)) {
    const knobId = String(knob.id);
    for (const otherId of othersOf(preset)) {
      test(`test_the_${presetId}_${knobId}_knob_moved_is_still_showing_after_the_${otherId}_tile_is_pressed`, async () => {
        const w = await resetTab({ mode: "pcm" });
        pressKnob(seenTabs(), presetId, moved);
        await flush(w);
        pressTile(seenTabs(), otherId);
        await flush(w);
        assert.deepEqual(knobPositions(tabs(), presetId, knobId), [moved]);
      });
    }
  }
}

// ============================================================================
// both lanes, one record
// ============================================================================
//
// The lane switch is the reset itself, asked to keep the record: `resetLive` and
// `resetTab` rebuild every signal either lane reads, which is what a user
// changing lanes meets, and `keepKnobs` is the record crossing with them. A
// record kept per lane fails both of these.

for (const preset of MULTI_KNOB) {
  const presetId = String(preset.id);
  for (const { knob, moved } of movable(preset)) {
    const knobId = String(knob.id);

    test(`test_the_${presetId}_${knobId}_knob_moved_on_the_live_lane_is_showing_on_the_tabs_lane`, async () => {
      const w = await resetLive();
      pressKnob(seenLive(), presetId, moved);
      await flush(w);
      await resetTab({ mode: "pcm", keepKnobs: true });
      assert.deepEqual(knobPositions(tabs(), presetId, knobId), [moved]);
    });

    test(`test_the_${presetId}_${knobId}_knob_moved_on_the_tabs_lane_is_showing_on_the_live_lane`, async () => {
      const w = await resetTab({ mode: "pcm" });
      pressKnob(seenTabs(), presetId, moved);
      await flush(w);
      await resetLive({ keepKnobs: true });
      assert.deepEqual(knobPositions(liveCard(), presetId, knobId), [moved]);
    });
  }
}
