// Behavioral suite for store/tabmap.js — which tab a staged edit lights up.
//
// The mapping is hand-maintained (schema `group` is not the tab), and its
// failure mode is silent: a key nobody listed falls through to the DSP tab, so a
// change made on Output accents a tab the control isn't on. These cases are the
// two controls that moved in the System/Output re-home, driven through the real
// `edit()` against a staging wire (docs/testing.md rule 4) rather than by
// assigning to the staged buffer.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/tabmap.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { dirtyTabs } from "../../../hqptuner/static/store/tabmap.js";
import { config, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { stagingWire } from "../support/wire.js";

async function reset() {
  stagingWire();
  engineState.value = { filter_junk: 0 };
  config.value = { fields: [{ name: "pre_before_meter", value: false }], file: {}, active: "", profiles: null };
  await discardAll();
}

test("a staged high-frequency filter lights the output tab", async () => {
  await reset();
  await edit("junk_filter", "3");
  assert.deepEqual([...dirtyTabs.value], ["output"]);
});

test("a staged pre-process before metering lights the output tab", async () => {
  await reset();
  await edit("pre_before_meter", "1");
  assert.deepEqual([...dirtyTabs.value], ["output"]);
});
