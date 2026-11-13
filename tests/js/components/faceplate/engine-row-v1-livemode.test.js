// The engine row's counter lamps in a browser that still holds v1's LIVE mode flag. v1 stored LIVE mode's on/off
// state in localStorage under `hqptuner.liveMode`; v2 has no LIVE mode, so a browser holding the flag set draws the
// lamps exactly as a browser that never held it does.
//
// Each browser is a worker of its own (tests/js/support/engine-row-world.js), because the prefs are read from storage
// once at load: both are handed the same Status frames and differ only in what their localStorage held.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/engine-row-v1-livemode.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { lampsIn } from "../../support/engine-row-world.js";

/** The key v1 kept LIVE mode's on/off state under, and the value it wrote for on. */
const V1_LIVE_MODE = "hqptuner.liveMode";
const ON = "1";

test("test_a_browser_holding_v1s_live_mode_flag_draws_the_counter_lamps_as_a_fresh_browser_does", async () => {
  const [held, fresh] = await Promise.all([lampsIn({ [V1_LIVE_MODE]: ON }), lampsIn({})]);
  assert.deepEqual(held, fresh);
});
