// Behavioral suite for the `split` counter (store/resolve.js) — the pending
// bar's "N live · M restart" arithmetic, shape `{ live, restart }`.
//
// Policy (docs/testing.md): public API only, one assertion per test. Counts
// cannot be assigned — `split` is computed over the schema and the staged
// buffer — so every case stages real edits through `edit()` against the real
// staging wire (rule 4); no store function is stubbed.
//
// The contract under test: a dirty appliesLive field (pcm_dither, form field
// "dither") counts LIVE exactly when every dirty http-lane field in the buffer
// is live-capable; one dirty restart-required field (volume_max) drags every
// appliesLive field over to the restart count, because the whole batch then
// rides one restore. A lane:"live" field (adaptive_volume) counts live
// unconditionally — it never touches the config file at all.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/split.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { split } from "../../../hqptuner/static/store/resolve.js";
import { edit, discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire, quiesce } from "../support/wire.js";

/**
 * One /config form field as the daemon serves it.
 *
 * @typedef {{ name: string, value: string | boolean }} FormField
 */

// A clean three-tree baseline over the real staging wire. Every source signal
// is reassigned — module-level signals outlive a test. The engine runs the PCM
// chain with adaptive volume on; the config file agrees (mode pcm, dither enum
// "0"), so each edit below is a real, dirty change against its own baseline.
async function trees() {
  engineState.value = { adaptive: "1", active_chain: "pcm" };
  config.value = {
    fields: [
      { name: "dither", value: "0" },
      { name: "volume_max", value: "-3" },
    ],
    file: { mode: "pcm", dither: "0" },
    active: "",
  };
  matrixConfig.value = { fields: [], active: "[Default]" };
  const w = stagingWire({
    routes: (/** @type {string} */ path) => {
      if (path === "/api/config") return ok({ data: config.value });
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return undefined;
    },
  });
  await discardAll();
  return w;
}

test("test_a_dirty_dither_alone_counts_live", async () => {
  const w = await trees();
  await edit("pcm_dither", "5");
  await quiesce(w);
  assert.deepEqual(split.value, { live: 1, restart: 0 });
});

test("test_a_dirty_restart_field_alone_counts_restart", async () => {
  const w = await trees();
  await edit("volume_max", "-6");
  await quiesce(w);
  assert.deepEqual(split.value, { live: 0, restart: 1 });
});

test("test_a_dither_beside_a_restart_field_counts_restart_with_it", async () => {
  // the batch rides one restore, so the dither restarts the daemon too
  const w = await trees();
  await edit("pcm_dither", "5");
  await edit("volume_max", "-6");
  await quiesce(w);
  assert.deepEqual(split.value, { live: 0, restart: 2 });
});

test("test_a_lane_live_field_counts_live_even_beside_a_restart_field", async () => {
  const w = await trees();
  await edit("adaptive_volume", "0");
  await edit("volume_max", "-6");
  await quiesce(w);
  assert.deepEqual(split.value, { live: 1, restart: 1 });
});

test("test_a_deferred_dither_leaves_the_lane_live_count_alone", async () => {
  // all three at once: the restart field pulls the dither over, never the
  // control-lane setting
  const w = await trees();
  await edit("pcm_dither", "5");
  await edit("adaptive_volume", "0");
  await edit("volume_max", "-6");
  await quiesce(w);
  assert.deepEqual(split.value, { live: 1, restart: 2 });
});
