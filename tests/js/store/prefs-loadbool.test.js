// Behavioral suite for loadBool in store/ui/prefs.js, the read every boolean pref loads through: a store holding
// nothing, or one that refuses to be read, gives back the default the caller passed, and a stored choice overrides it.
// Each case passes its own default, so no pref's shipped default is pinned here.
//
// The environment is the seam: a fake localStorage is installed per case and removed after it. Nothing of HQPTuner's
// is stubbed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs-loadbool.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { useStorage, useThrowingStorage, dropStorage } from "../support/storage.js";
import { loadBool } from "../../../hqptuner/static/store/ui/prefs.js";

const KEY = "test.loadBool";

afterEach(dropStorage);

for (const dflt of [true, false]) {
  test(`test_an_unset_key_loads_the_default_${dflt}`, () => {
    useStorage();
    assert.equal(loadBool(KEY, dflt), dflt);
  });

  test(`test_a_throwing_store_loads_the_default_${dflt}`, () => {
    useThrowingStorage();
    assert.equal(loadBool(KEY, dflt), dflt);
  });
}

for (const [stored, dflt, loaded] of /** @type {[string, boolean, boolean][]} */ ([
  ["1", false, true],
  ["0", true, false],
])) {
  test(`test_a_stored_${stored}_overrides_the_default_${dflt}`, () => {
    useStorage().setItem(KEY, stored);
    assert.equal(loadBool(KEY, dflt), loaded);
  });
}
