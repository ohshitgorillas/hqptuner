// Behavioral suite for the favorites error caption (store/narrow/favorites.js
// `favoritesError`, rendered by components/Field.js): when a star could not be
// saved to the server, the sentence the server sent is shown to the user, under
// the dropdowns that carry stars and nowhere else.
//
// Which dropdowns carry stars is the schema's `narrow` marking: the four filter
// dropdowns have it, a dither or modulator combobox does not. So the caption
// under a filter field is the affordance's own feedback, while the same signal
// must leave a dither field untouched.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The error line is driven by assigning the exported signal, the way
// every other source signal is driven; nothing of the store is stubbed, and the
// harness's wire answers /api/favorites so no request is left hanging.
//
// SSR escapes entities, so the harness's `field()` decodes before the text is
// matched — the contract is the sentence a user reads, not its encoding.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/field-favcaption.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field } from "../support/field-harness.js";
import { staticWire } from "../support/wire.js";
import { favoritesState, favoritesRoutes } from "../support/favoriteswire.js";
import { favoriteFilters, favoritesError } from "../../../hqptuner/static/store/narrow/favorites.js";

// A sentence in the shape FastAPI's `detail` carries, with no characters SSR
// would re-encode.
const SENTENCE = "Favorites could not be saved.";

/** @typedef {import("../support/field-harness.js").ConfigField} ConfigField */

// A starred dropdown: one of the four filter fields.
/** @type {ConfigField[]} */
const FILTER_FIELDS = [
  {
    name: "filter1x",
    value: "0",
    options: [
      { value: "0", label: "sinc-M" },
      { value: "1", label: "poly-sinc-xtr-mp" },
    ],
  },
];

// A dropdown with no stars: a dither. The rate sits above NS9's 352.8k floor so
// no row is rate-grayed and nothing but the labels is in the rows.
/** @type {ConfigField[]} */
const DITHER_FIELDS = [
  { name: "defaults_samplerate", value: "384000" },
  {
    name: "dither",
    value: "0",
    options: [
      { value: "0", label: "TPDF" },
      { value: "1", label: "NS9" },
    ],
  },
];

/**
 * @param {ConfigField[]} fields
 * @param {string} error
 */
async function start(fields, error) {
  await reset({ fields });
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
  favoriteFilters.value = new Set();
  favoritesError.value = error;
}

// The caption is a `div` carrying the class `field-error`, a class used for
// nothing else on the page. Absence is asserted on the ELEMENT, not on the
// sentence: an empty caption box is a stray gap under the dropdown, and a
// missing sentence would not rule one out.

/** @param {string} out */
function hasFieldError(out) {
  const openers = /<(\w+)\b[^<>]*>/g;
  let m;
  while ((m = openers.exec(out)) !== null) {
    const cls = (/\bclass="([^"]*)"/.exec(m[0]) || [])[1] || "";
    if (cls.split(/\s+/).includes("field-error")) return true;
  }
  return false;
}

/**
 * The text a user reads inside the caption, or null when no caption rendered.
 * @param {string} out
 */
function fieldErrorText(out) {
  const divs = /<div\b([^<>]*)>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = divs.exec(out)) !== null) {
    const cls = (/\bclass="([^"]*)"/.exec(m[1]) || [])[1] || "";
    if (cls.split(/\s+/).includes("field-error")) return m[2].replace(/<[^<>]*>/g, "").trim();
  }
  return null;
}

test("test_a_failed_save_shows_its_sentence_under_a_starred_filter_dropdown", async () => {
  await start(FILTER_FIELDS, SENTENCE);
  assert.equal(fieldErrorText(field("pcm_filter_1x")), SENTENCE);
});

test("test_a_failed_save_shows_nothing_under_a_dropdown_that_carries_no_stars", async () => {
  await start(DITHER_FIELDS, SENTENCE);
  assert.equal(hasFieldError(field("pcm_dither")), false);
});

test("test_with_no_error_no_caption_renders_under_a_filter_dropdown", async () => {
  await start(FILTER_FIELDS, "");
  assert.equal(hasFieldError(field("pcm_filter_1x")), false);
});
