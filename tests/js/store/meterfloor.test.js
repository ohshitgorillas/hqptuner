// Behavioral suite for the meter floor in store/ui/prefs.js: the browser-held Levels floor the page's Source level bars
// and their dB scale read down to, a preference of its own beside the page's Range.
//
// On the way in, the floor the browser holds is the floor the page comes up with, and a stored value outside the
// offered set, or none at all, loads a floor inside it. On the way out, the setter moves the signal and stores the new
// value, and a value outside the set is turned away with the chosen floor standing.
//
// The module reads its keys once, when it is first imported, so the fake storage is installed at file scope, SEEDED,
// and only then is the module pulled in; the load-time value is captured the moment it arrives. The outside and unset
// cases load further instances under `.fresh-<tag>.js` specifiers (tests/js/support/vendor-resolve.js). The storage
// key is named because it is the contract a persisted preference makes with the browser. The values seeded and set
// are the floor's own identifiers, in dBFS.
//
// The floor's surface is read off the module namespace with optional access, so a module without it fails these cases
// on their assertions.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meterfloor.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const MODULE = "../../../hqptuner/static/store/ui/prefs.js";
const KEY = "hqptuner.meterFloor";

// Two floors the owner offers, neither of them the one a fresh browser starts on, and a stored value from outside the
// set that is plausible on purpose: it reads like a floor, at the depth of the page's narrowest Range.
const DEEP = "-90";
const SHALLOW = "-48";
const OUTSIDE = "-120";

/**
 * The floor's surface on the prefs module.
 *
 * @typedef {{ meterFloor?: { value: string }, setMeterFloor?(v: string): void, METER_FLOORS?: readonly string[] }} FloorSurface
 */

const storage = useStorage();
storage.setItem(KEY, DEEP);

/** @type {FloorSurface} */
const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");
const AT_LOAD = prefs.meterFloor?.value;

storage.setItem(KEY, OUTSIDE);
/** @type {FloorSurface} */
const outsider = await import(`${MODULE.replace(/\.js$/, ".fresh-floor-outside.js")}`);

storage.removeItem(KEY);
/** @type {FloorSurface} */
const unset = await import(`${MODULE.replace(/\.js$/, ".fresh-floor-unset.js")}`);

const OFFERED = prefs.METER_FLOORS ?? [];

// --- what the browser had stored is what the page comes up with -------------------------------------------------------

test("test_a_stored_meter_floor_is_the_floor_the_page_loads_with", () => {
  assert.equal(AT_LOAD, DEEP);
});

test("test_a_stored_meter_floor_outside_the_set_loads_a_floor_inside_it", () => {
  assert.equal(OFFERED.includes(outsider.meterFloor?.value ?? ""), true);
});

test("test_a_browser_with_no_stored_meter_floor_loads_a_floor_inside_the_set", () => {
  assert.equal(OFFERED.includes(unset.meterFloor?.value ?? ""), true);
});

// --- the setter moves the signal and stores the value -----------------------------------------------------------------

test("test_choosing_a_meter_floor_stores_it", () => {
  prefs.setMeterFloor?.(SHALLOW);
  prefs.setMeterFloor?.(DEEP);
  assert.equal(storage.getItem(KEY), DEEP);
});

test("test_a_meter_floor_outside_the_set_leaves_the_chosen_floor_standing", () => {
  prefs.setMeterFloor?.(SHALLOW);
  prefs.setMeterFloor?.(OUTSIDE);
  assert.equal(prefs.meterFloor?.value, SHALLOW);
});
