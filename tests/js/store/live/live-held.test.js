// Behavioral suite for store/live/write.js's HOLD: a LIVE edit made while the app is
// not ready sends nothing, and once both lanes are ready the newest value of each
// edited setting goes out, one POST /api/config/live per setting.
//
// Not ready is the health reading's `ready` being false, and also HQPTuner's own
// engine restart, during which the last health reading still says ready until the
// next poll while the server's gate already refuses.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at the
// wire. The suite drives the exported `health` and `engineRestarting` signals and
// `writeLive`; no store function is stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/live-held.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../../hqptuner/static/store/signals.js";
import { engineRestarting } from "../../../../hqptuner/static/store/enginewrite.js";
import { writeLive } from "../../../../hqptuner/static/store/live/write.js";
import { ok, stagingWire, quiesce } from "../../support/wire/wire.js";

/** @returns {{ posts: { fields: Record<string, string> }[], w: import("../../support/wire/wire.js").StagingWire }} */
function liveWire() {
  /** @type {{ fields: Record<string, string> }[]} */
  const posts = [];
  const w = stagingWire({
    routes: (path, opts) => {
      if (path !== "/api/config/live") return undefined;
      posts.push(JSON.parse(String(opts.body)));
      return ok({ report: { live: [] } });
    },
  });
  return { posts, w };
}

const poll = (/** @type {boolean} */ ready) => ({ reachable: true, ready, connected: true });

// Back to a ready app with nothing held, so no case leaves a held edit for the next.
async function settle(/** @type {ReturnType<typeof liveWire>} */ { w }) {
  engineRestarting.value = false;
  health.value = poll(true);
  await quiesce(w);
}

test("test_live_edits_made_while_not_ready_send_nothing", async () => {
  const wire = liveWire();
  health.value = poll(false);
  await writeLive("filter", "40");
  await writeLive("shaper", "31");
  await quiesce(wire.w);
  const sent = wire.posts.length;
  await settle(wire);
  assert.equal(sent, 0);
});

test("test_held_live_edits_go_out_once_per_setting_with_the_newest_value_when_ready", async () => {
  const wire = liveWire();
  health.value = poll(false);
  await writeLive("filter", "40");
  await writeLive("shaper", "31");
  await writeLive("filter", "25");
  health.value = poll(true);
  await quiesce(wire.w);
  const sent = wire.posts.map((p) => p.fields);
  assert.deepEqual(
    sent.sort((a, b) => Object.keys(a)[0].localeCompare(Object.keys(b)[0])),
    [{ filter: "25" }, { shaper: "31" }],
  );
});

test("test_a_live_edit_made_during_the_apps_own_restart_is_held_though_ready_still_reads_true", async () => {
  const wire = liveWire();
  health.value = poll(true);
  engineRestarting.value = true;
  await writeLive("filter", "40");
  await quiesce(wire.w);
  const sent = wire.posts.length;
  await settle(wire);
  assert.equal(sent, 0);
});
