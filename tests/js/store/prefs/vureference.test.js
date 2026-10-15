// Behavioral suite for the VU reference preference in store/ui/prefs.js: the level in dBFS the Source VU meters put
// 0 VU at, −14, −18 or −20, a browser-held choice the Display popover sets, remembered on its own beside the Meters
// pick and the Levels floor.
//
// On the way in, the reference the browser holds is the reference the page comes up with; none at all loads −18, and
// a stored value outside the choices loads as if none had been picked. On the way out, the setter stores the pick and
// moves the signal, and the Meters pick keeps its own choice through it; the Levels floor's setter leaves this pick
// standing.
//
// The module reads its keys once, when it is first imported, so the fake storage is installed at file scope, SEEDED,
// and only then is the module pulled in. The second stored reference, the outside and the unset cases load further
// instances under `.fresh-<tag>.js` specifiers (tests/js/support/vendor-resolve.js). The storage keys are named because
// they are the contract a persisted preference makes with the browser. The values are the references' own
// identifiers, in dBFS, as the Levels floor stores its own.
//
// The surface is read off the module namespace with optional access, so a module without it fails these cases on
// their assertions.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs/vureference.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

const MODULE = "../../../../hqptuner/static/store/ui/prefs.js";
const KEY = "hqptuner.vuReference";
const METERS_KEY = "hqptuner.meters";
const FLOOR_KEY = "hqptuner.meterFloor";

// The three references on offer, and a stored value outside them that is plausible on purpose: a reference some
// broadcast standards use, one step above the highest offered.
const HOT = "-14";
const MIDDLE = "-18";
const LOW = "-20";
const OUTSIDE = "-12";

// A Meters pick that is not the one a fresh browser starts on, and two Levels floors on offer.
const METERS_PICK = "vu";
const FLOOR_SEEDED = "-90";
const FLOOR_PICKED = "-48";

/**
 * The VU reference surface on the prefs module, with the neighbours it must leave alone.
 *
 * @typedef {{
 *   vuReference?: { value: string },
 *   setVuReference?(v: string): void,
 *   meters?: { value: string },
 *   setMeterFloor?(v: string): void,
 * }} VuReferenceSurface
 */

const storage = useStorage();
storage.setItem(KEY, HOT);
storage.setItem(METERS_KEY, METERS_PICK);
storage.setItem(FLOOR_KEY, FLOOR_SEEDED);

/** @type {VuReferenceSurface} */
const prefs = await import(MODULE);

storage.setItem(KEY, LOW);
/** @type {VuReferenceSurface} */
const low = await import(`${MODULE.replace(/\.js$/, ".fresh-vuref-low.js")}`);

storage.setItem(KEY, OUTSIDE);
/** @type {VuReferenceSurface} */
const outsider = await import(`${MODULE.replace(/\.js$/, ".fresh-vuref-outside.js")}`);

storage.removeItem(KEY);
/** @type {VuReferenceSurface} */
const unset = await import(`${MODULE.replace(/\.js$/, ".fresh-vuref-unset.js")}`);

// --- what the browser had stored is what the page comes up with -------------------------------------------------------

test("test_a_stored_minus_14_reference_is_the_reference_the_page_loads_with", () => {
  assert.equal(prefs.vuReference?.value, HOT);
});

test("test_a_stored_minus_20_reference_is_the_reference_the_page_loads_with", () => {
  assert.equal(low.vuReference?.value, LOW);
});

test("test_a_browser_that_never_picked_a_vu_reference_loads_minus_18", () => {
  assert.equal(unset.vuReference?.value, MIDDLE);
});

test("test_a_stored_vu_reference_outside_the_choices_loads_minus_18_as_never_picked", () => {
  assert.equal(outsider.vuReference?.value, MIDDLE);
});

// --- a pick is stored and takes effect -----------------------------------------------------------------------------

test("test_picking_the_minus_20_reference_stores_it", () => {
  prefs.setVuReference?.(HOT);
  prefs.setVuReference?.(LOW);
  assert.equal(storage.getItem(KEY), LOW);
});

test("test_picking_the_minus_14_reference_stores_it", () => {
  prefs.setVuReference?.(LOW);
  prefs.setVuReference?.(HOT);
  assert.equal(storage.getItem(KEY), HOT);
});

test("test_picking_a_vu_reference_makes_it_the_reference_in_force", () => {
  prefs.setVuReference?.(HOT);
  prefs.setVuReference?.(LOW);
  assert.equal(prefs.vuReference?.value, LOW);
});

// --- each choice is remembered on its own -----------------------------------------------------------------------------

test("test_picking_a_vu_reference_leaves_the_meters_pick_standing", () => {
  prefs.setVuReference?.(LOW);
  assert.equal(prefs.meters?.value, METERS_PICK);
});

test("test_picking_a_levels_floor_leaves_the_vu_reference_pick_standing", () => {
  prefs.setVuReference?.(LOW);
  prefs.setMeterFloor?.(FLOOR_PICKED);
  assert.equal(prefs.vuReference?.value, LOW);
});
