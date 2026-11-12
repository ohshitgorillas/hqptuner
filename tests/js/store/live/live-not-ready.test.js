// Behavioral suite for store/live/write.js while the app is not ready: a LIVE edit is
// sent like any other, the server's readiness gate refuses it, and that refusal is the
// error the edited control shows. Nothing is held for later.
//
// Not ready is the health reading's `ready` being false, and also HQPTuner's own
// engine restart, during which the last health reading still says ready until the
// next poll while the server's gate already refuses.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at the
// wire. The suite drives the exported `health` and `engineRestarting` signals and
// `writeLive`; no store function is stubbed. The refusal text is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/live-not-ready.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../../hqptuner/static/store/signals.js";
import { engineRestarting } from "../../../../hqptuner/static/store/enginewrite.js";
import { liveErrors } from "../../../../hqptuner/static/store/live/state.js";
import { writeLive } from "../../../../hqptuner/static/store/live/write.js";
import { ok, bad, stagingWire } from "../../support/wire/wire.js";

const REFUSAL = "the gate's own sentence for a lane that is down";

/**
 * A server whose readiness gate refuses every LIVE write, recording each one it was sent.
 * @returns {{ posts: { fields: Record<string, string> }[] }}
 */
function gatedWire() {
  /** @type {{ fields: Record<string, string> }[]} */
  const posts = [];
  stagingWire({
    routes: (path, opts) => {
      if (path === "/api/state") return ok({ data: {} });
      if (path !== "/api/config/live") return undefined;
      posts.push(JSON.parse(String(opts.body)));
      return bad(503, REFUSAL);
    },
  });
  return { posts };
}

const poll = (/** @type {boolean} */ ready) => ({ reachable: true, ready, connected: true });

// A fresh slate, so no case leaves a refusal or a restart flag for the next.
function reset(/** @type {boolean} */ ready) {
  engineRestarting.value = false;
  health.value = poll(ready);
  liveErrors.value = {};
}

test("test_a_live_edit_made_while_not_ready_is_sent", async () => {
  const wire = gatedWire();
  reset(false);
  await writeLive("filter", "40");
  assert.deepEqual(wire.posts, [{ fields: { filter: "40" } }]);
});

test("test_a_live_edit_made_during_the_apps_own_restart_is_sent_though_ready_still_reads_true", async () => {
  const wire = gatedWire();
  reset(true);
  engineRestarting.value = true;
  await writeLive("filter", "40");
  engineRestarting.value = false;
  assert.deepEqual(wire.posts, [{ fields: { filter: "40" } }]);
});

test("test_the_servers_refusal_shows_on_the_control_that_was_edited", async () => {
  gatedWire();
  reset(false);
  await writeLive("filter", "40");
  assert.equal(liveErrors.value.filter, REFUSAL);
});
