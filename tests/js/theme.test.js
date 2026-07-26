// Behavioral suite for store/theme.js — the accent preset swatches, the
// custom-hex override, and the boot-time stamp.
//
// The module's only dependencies are environment seams — document and
// localStorage — so those are what the fakes stand in for (the wire-level
// equivalent for a module that never talks REST). No theme function is
// stubbed. Both globals are restored after every test, and the two exported
// signals are re-zeroed by setup() because module-level signals outlive a test.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/theme.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { accent, accentHex, applyAccent, applyAccentHex, initAccent } from "../../hqptuner/static/store/theme.js";

const KEY = "hqptuner.accent";
const KEY_HEX = "hqptuner.accentHex";

// A root element the way theme.js touches it: dataset + inline style variables.
function fakeDocument() {
  const vars = new Map();
  return {
    documentElement: {
      dataset: {},
      style: {
        vars,
        setProperty: (k, v) => vars.set(k, v),
        removeProperty: (k) => vars.delete(k),
      },
    },
  };
}

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

// Private-mode storage: present, but every touch throws.
const brokenStorage = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("storage disabled");
  },
  removeItem: () => {
    throw new Error("storage disabled");
  },
};

function setup(storage = fakeStorage()) {
  globalThis.document = fakeDocument();
  globalThis.localStorage = storage;
  accent.value = "blue";
  accentHex.value = "";
  return { root: globalThis.document.documentElement, storage };
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.localStorage;
});

// --- preset swatches ----------------------------------------------------------

test("test_a_preset_swatch_sets_the_root_accent_attribute", () => {
  const { root } = setup();
  applyAccent("green");
  assert.equal(root.dataset.accent, "green");
});

test("test_an_unknown_swatch_name_falls_back_to_the_default", () => {
  setup();
  applyAccent("magenta");
  assert.equal(accent.value, "blue");
});

test("test_a_preset_swatch_drops_a_custom_hex_override", () => {
  setup();
  applyAccentHex("#123456");
  applyAccent("green");
  assert.equal(accentHex.value, "");
});

test("test_a_preset_swatch_clears_the_inline_accent_variable", () => {
  const { root } = setup();
  applyAccentHex("#123456");
  applyAccent("green");
  assert.equal(root.style.vars.has("--accent"), false);
});

test("test_a_preset_swatch_is_persisted", () => {
  const { storage } = setup();
  applyAccent("amber");
  assert.equal(storage.getItem(KEY), "amber");
});

test("test_a_preset_swatch_drops_the_persisted_custom_hex", () => {
  const { storage } = setup(fakeStorage({ [KEY_HEX]: "#123456" }));
  applyAccent("green");
  assert.equal(storage.getItem(KEY_HEX), null);
});

test("test_a_swatch_still_applies_when_storage_is_disabled", () => {
  setup(brokenStorage);
  applyAccent("amber");
  assert.equal(accent.value, "amber");
});

// --- custom hex ------------------------------------------------------------------

test("test_a_custom_hex_is_applied_as_the_inline_accent", () => {
  const { root } = setup();
  applyAccentHex("#4f9dde");
  assert.equal(root.style.vars.get("--accent"), "#4f9dde");
});

test("test_a_bare_hex_gains_its_hash", () => {
  setup();
  applyAccentHex("4f9dde");
  assert.equal(accentHex.value, "#4f9dde");
});

test("test_surrounding_whitespace_is_trimmed", () => {
  setup();
  applyAccentHex("  #4f9dde  ");
  assert.equal(accentHex.value, "#4f9dde");
});

for (const junk of ["#12g456", "#123", "#1234567", "", "red"]) {
  test(`test_a_malformed_hex_is_ignored: ${JSON.stringify(junk)}`, () => {
    setup();
    applyAccentHex(junk);
    assert.equal(accentHex.value, "");
  });
}

test("test_the_glow_is_derived_by_pulling_the_hex_toward_white", () => {
  // each channel moves 30% of its distance to 255: 0 -> 77 (0x4d)
  const { root } = setup();
  applyAccentHex("#000000");
  assert.equal(root.style.vars.get("--accent-glow"), "#4d4d4d");
});

test("test_a_white_accent_keeps_a_white_glow", () => {
  const { root } = setup();
  applyAccentHex("#ffffff");
  assert.equal(root.style.vars.get("--accent-glow"), "#ffffff");
});

test("test_a_custom_hex_is_persisted", () => {
  const { storage } = setup();
  applyAccentHex("#4f9dde");
  assert.equal(storage.getItem(KEY_HEX), "#4f9dde");
});

test("test_a_custom_hex_still_applies_when_storage_is_disabled", () => {
  setup(brokenStorage);
  applyAccentHex("#4f9dde");
  assert.equal(accentHex.value, "#4f9dde");
});

// --- initAccent: the boot-time stamp ------------------------------------------------

test("test_init_stamps_the_root_attribute_from_the_stored_accent", () => {
  const { root } = setup();
  accent.value = "green";
  initAccent();
  assert.equal(root.dataset.accent, "green");
});

test("test_init_reapplies_a_stored_custom_hex_inline", () => {
  const { root } = setup();
  accentHex.value = "#123456";
  initAccent();
  assert.equal(root.style.vars.get("--accent"), "#123456");
});

test("test_init_without_a_custom_hex_leaves_the_inline_variable_unset", () => {
  const { root } = setup();
  initAccent();
  assert.equal(root.style.vars.has("--accent"), false);
});
