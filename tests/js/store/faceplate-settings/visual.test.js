// Behavioral suite for hqptuner/static/store/faceplate/settings/visual.js, the faceplate's Visual settings: the accent
// swatches it offers, the four accent tokens a pick derives, and stamping those tokens and the dyslexic switch on a
// root element from the theme store's live signals.
//
// The accent tokens are pinned against `effectOf` in model/shell/settings.js, the derivation they mirror, and the
// swatch hexes against theme.js's `ACCENT_HEX`; no color literal is restated here. The root is a fake carrying only
// `dataset` and `style.setProperty`. The watch is driven through theme.js's own `applyAccent` and `applyDyslexic`,
// which touch `document` and `localStorage`, so both globals are faked and restored after every test, and the three
// theme signals are reset by setup() because module-level signals outlive a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-settings/visual.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  ACCENT_HEX,
  accent,
  accentHex,
  applyAccent,
  applyDyslexic,
  dyslexic,
} from "../../../../hqptuner/static/store/ui/theme.js";
import { effectOf } from "../../../../hqptuner/static/model/shell/settings.js";
import {
  ACCENTS,
  ACCENT_OPTIONS,
  accentTokens,
  applyFaceplateTheme,
  watchFaceplateTheme,
} from "../../../../hqptuner/static/store/faceplate/settings/visual.js";

/** @type {{ document?: unknown, localStorage?: unknown }} */
const env = globalThis;

/** @type {(() => void)[]} */
const disposers = [];

// A root element the way the module touches it: dataset + inline style variables.
function fakeRoot() {
  const vars = new Map();
  return {
    vars,
    /** @type {Record<string, string>} */
    dataset: {},
    style: {
      setProperty: (/** @type {string} */ k, /** @type {string} */ v) => vars.set(k, v),
    },
  };
}

// The document and storage theme.js's own apply functions write to.
function fakeGlobals() {
  const store = new Map();
  env.document = {
    documentElement: {
      dataset: {},
      style: { setProperty: () => undefined, removeProperty: () => undefined },
    },
  };
  env.localStorage = {
    getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, v),
    removeItem: (/** @type {string} */ k) => store.delete(k),
  };
}

function setup() {
  fakeGlobals();
  accent.value = "amber";
  accentHex.value = "";
  dyslexic.value = false;
  return fakeRoot();
}

/**
 * The tokens `effectOf` derives for one accent value.
 *
 * @param {string} v
 * @returns {Record<string, string>}
 */
function effectTokens(v) {
  const e = effectOf("vacc", v, ACCENTS, []);
  return e.kind === "accent" ? e.tokens : {};
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  delete env.document;
  delete env.localStorage;
});

// --- the swatches ----------------------------------------------------------------

test("test_the_swatches_are_exactly_the_v1_accent_presets", () => {
  assert.deepEqual(ACCENTS.map((a) => a.v).sort(), Object.keys(ACCENT_HEX).sort());
});

test("test_each_swatch_carries_its_v1_preset_hex", () => {
  assert.deepEqual(
    ACCENTS.map((a) => a.hex),
    ACCENTS.map((a) => ACCENT_HEX[a.v]),
  );
});

test("test_each_accent_option_value_is_its_swatch_name", () => {
  assert.deepEqual(
    ACCENT_OPTIONS.map((o) => o.value),
    ACCENTS.map((a) => a.v),
  );
});

test("test_each_accent_option_label_is_its_swatch_label", () => {
  assert.deepEqual(
    ACCENT_OPTIONS.map((o) => o.label),
    ACCENTS.map((a) => a.label),
  );
});

// --- accentTokens ------------------------------------------------------------------

test("test_amber_derives_the_four_tokens_effectOf_derives_for_amber", () => {
  assert.deepEqual(accentTokens("amber", ""), effectTokens(ACCENT_HEX.amber));
});

test("test_a_named_swatch_derives_its_tokens_from_its_own_hex", () => {
  assert.equal(accentTokens("blue", "")["--acc"], ACCENT_HEX.blue);
});

test("test_a_custom_hex_wins_over_the_named_swatch", () => {
  assert.deepEqual(accentTokens("blue", "#123456"), effectTokens("#123456"));
});

test("test_an_unknown_swatch_name_falls_back_to_amber", () => {
  assert.equal(accentTokens("magenta", "")["--acc"], ACCENT_HEX.amber);
});

// --- applyFaceplateTheme -------------------------------------------------------------

test("test_apply_writes_the_live_accent_tokens_on_the_root", () => {
  const root = setup();
  accent.value = "green";
  applyFaceplateTheme(root);
  assert.deepEqual(Object.fromEntries(root.vars), effectTokens(ACCENT_HEX.green));
});

test("test_apply_writes_the_live_custom_hex_on_the_root", () => {
  const root = setup();
  accentHex.value = "#123456";
  applyFaceplateTheme(root);
  assert.equal(root.vars.get("--acc"), "#123456");
});

test("test_apply_stamps_the_dyslexic_attribute_when_the_switch_is_on", () => {
  const root = setup();
  dyslexic.value = true;
  applyFaceplateTheme(root);
  assert.equal(root.dataset.dyslexic, "1");
});

test("test_apply_clears_the_dyslexic_attribute_when_the_switch_is_off", () => {
  const root = setup();
  root.dataset.dyslexic = "1";
  applyFaceplateTheme(root);
  assert.equal(root.dataset.dyslexic, undefined);
});

// --- watchFaceplateTheme -------------------------------------------------------------

test("test_the_watch_follows_a_picked_swatch", () => {
  const root = setup();
  disposers.push(watchFaceplateTheme(root));
  applyAccent("blue");
  assert.equal(root.vars.get("--acc"), ACCENT_HEX.blue);
});

test("test_the_watch_follows_the_dyslexic_switch", () => {
  const root = setup();
  disposers.push(watchFaceplateTheme(root));
  applyDyslexic(true);
  assert.equal(root.dataset.dyslexic, "1");
});

test("test_a_disposed_watch_stops_following", () => {
  const root = setup();
  const dispose = watchFaceplateTheme(root);
  applyAccent("blue");
  dispose();
  applyAccent("violet");
  assert.equal(root.vars.get("--acc"), ACCENT_HEX.blue);
});
