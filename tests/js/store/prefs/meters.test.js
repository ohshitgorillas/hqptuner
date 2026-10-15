// Behavioral suite for the Meters preference in store/ui/prefs.js: which meter the Source levels column shows in
// Compact and Normal, Levels or VU, a browser-held choice the Display popover sets, remembered on its own beside the
// VU reference and the Levels floor.
//
// On the way in, the pick the browser holds is the pick the page comes up with; none at all loads Levels, and a stored
// value outside the choices loads as if none had been picked. On the way out, the setter stores the pick and moves the
// signal, and the VU reference keeps its own pick through it; the Levels floor's setter leaves this pick standing.
//
// The module reads its keys once, when it is first imported, so the fake storage is installed at file scope, SEEDED,
// and only then is the module pulled in. The outside and unset cases load further instances under `.fresh-<tag>.js`
// specifiers (tests/js/support/vendor-resolve.js). The storage keys are named because they are the contract a
// persisted preference makes with the browser.
//
// The surface is read off the module namespace with optional access, so a module without it fails these cases on
// their assertions.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs/meters.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

const MODULE = "../../../../hqptuner/static/store/ui/prefs.js";
const KEY = "hqptuner.meters";
const VU_KEY = "hqptuner.vuReference";
const FLOOR_KEY = "hqptuner.meterFloor";

// The two meters on offer, and a stored value outside them that is plausible on purpose: another meter's name.
const LEVELS = "levels";
const VU = "vu";
const OUTSIDE = "ppm";

// A VU reference that is not the one a fresh browser starts on, and two Levels floors on offer.
const VU_REF = "-14";
const FLOOR_SEEDED = "-90";
const FLOOR_PICKED = "-48";

/**
 * The Meters surface on the prefs module, with the neighbours it must leave alone.
 *
 * @typedef {{
 *   meters?: { value: string },
 *   setMeters?(v: string): void,
 *   vuReference?: { value: string },
 *   setMeterFloor?(v: string): void,
 * }} MetersSurface
 */

const storage = useStorage();
storage.setItem(KEY, VU);
storage.setItem(VU_KEY, VU_REF);
storage.setItem(FLOOR_KEY, FLOOR_SEEDED);

/** @type {MetersSurface} */
const prefs = await import(MODULE);

storage.setItem(KEY, OUTSIDE);
/** @type {MetersSurface} */
const outsider = await import(`${MODULE.replace(/\.js$/, ".fresh-meters-outside.js")}`);

storage.removeItem(KEY);
/** @type {MetersSurface} */
const unset = await import(`${MODULE.replace(/\.js$/, ".fresh-meters-unset.js")}`);

// --- what the browser had stored is what the page comes up with -------------------------------------------------------

test("test_a_stored_vu_pick_is_the_meter_the_page_loads_with", () => {
  assert.equal(prefs.meters?.value, VU);
});

test("test_a_browser_that_never_picked_a_meter_loads_levels", () => {
  assert.equal(unset.meters?.value, LEVELS);
});

test("test_a_stored_meter_outside_the_choices_loads_levels_as_never_picked", () => {
  assert.equal(outsider.meters?.value, LEVELS);
});

// --- a pick is stored and takes effect -----------------------------------------------------------------------------

test("test_picking_levels_stores_the_levels_pick", () => {
  prefs.setMeters?.(VU);
  prefs.setMeters?.(LEVELS);
  assert.equal(storage.getItem(KEY), LEVELS);
});

test("test_picking_vu_stores_the_vu_pick", () => {
  prefs.setMeters?.(LEVELS);
  prefs.setMeters?.(VU);
  assert.equal(storage.getItem(KEY), VU);
});

test("test_picking_a_meter_makes_it_the_meter_in_force", () => {
  prefs.setMeters?.(VU);
  prefs.setMeters?.(LEVELS);
  assert.equal(prefs.meters?.value, LEVELS);
});

// --- each choice is remembered on its own -----------------------------------------------------------------------------

test("test_picking_a_meter_leaves_the_vu_reference_pick_standing", () => {
  prefs.setMeters?.(LEVELS);
  assert.equal(prefs.vuReference?.value, VU_REF);
});

test("test_picking_a_levels_floor_leaves_the_meter_pick_standing", () => {
  prefs.setMeters?.(VU);
  prefs.setMeterFloor?.(FLOOR_PICKED);
  assert.equal(prefs.meters?.value, VU);
});
