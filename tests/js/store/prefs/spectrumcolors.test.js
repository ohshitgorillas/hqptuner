// Behavioral suite for the page spectrum's Colors preference in store/ui/prefs.js: the colour suite the page spectrum
// draws in, a browser-held preference saved the way the Spectrum style is.
//
// On the way in, the suite the browser holds is the suite the page comes up with, and a stored value the app does not
// recognize loads Classic. On the way out, the setter stores the suite it is given.
//
// The module reads its keys once, when it is first imported, so the fake storage is installed at file scope, SEEDED,
// and only then is the module pulled in. The unrecognized case loads a further instance under a `.fresh-<tag>.js`
// specifier (tests/js/support/vendor-resolve.js). The storage key is named because it is the contract a persisted
// preference makes with the browser. The values seeded and set are the suites' own identifiers.
//
// The Colors surface is read off the module namespace with optional access, so a module without it fails these cases
// on their assertions.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs/spectrumcolors.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

const MODULE = "../../../../hqptuner/static/store/ui/prefs.js";
const KEY = "hqptuner.spectrumColors";

//: The suite a fresh or confused browser falls back to.
const CLASSIC = "classic";
// Two suites the owner offers, neither of them Classic, so a load or a write of either shows.
const INFERNO = "inferno";
const AMBER = "amber";
//: A stored value the app does not recognize, plausible on purpose: it reads like a suite name.
const UNKNOWN = "plasma";

/**
 * The Colors surface on the prefs module.
 *
 * @typedef {{ setSpectrumStyle(v: string): void, spectrumColors?: { value: string }, setSpectrumColors?(v: string): void }} ColorsSurface
 */

const storage = useStorage();
storage.setItem(KEY, INFERNO);

/** @type {ColorsSurface} */
const prefs = await import("../../../../hqptuner/static/store/ui/prefs.js");
const loaded = prefs.spectrumColors?.value;

storage.setItem(KEY, UNKNOWN);
/** @type {ColorsSurface} */
const confused = await import(`${MODULE.replace(/\.js$/, ".fresh-colors-unknown.js")}`);

test("test_a_saved_colors_suite_is_the_one_the_page_loads_with", () => {
  assert.equal(loaded, INFERNO);
});

test("test_a_stored_colors_value_the_app_does_not_recognize_loads_classic", () => {
  assert.equal(confused.spectrumColors?.value, CLASSIC);
});

test("test_choosing_a_colors_suite_saves_it", () => {
  prefs.setSpectrumColors?.(AMBER);
  assert.equal(storage.getItem(KEY), AMBER);
});
