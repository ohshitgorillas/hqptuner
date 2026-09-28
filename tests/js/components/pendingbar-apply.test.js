// Behavioral case for components/PendingBar.js's Apply button: a click with an
// edit staged reaches the wire as the apply request.
//
// A fetch fake answers the real REST paths with their real shapes and records
// every request's method and path. The click is fired through the vnode seam, since
// render-to-string fires no events.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/pendingbar-apply.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { PendingBar } from "../../../hqptuner/static/components/PendingBar.js";
import { health, config, engineState, pendingPreset } from "../../../hqptuner/static/store/signals.js";
import { applying, lastApply, discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { ok } from "../support/wire/wire.js";
import { renderTree } from "../support/vnodeseam.js";

/** @typedef {import("../support/vnodeseam.js").VNode} VNode */

/** @type {{ fetch?: unknown }} */
const env = globalThis;

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** @type {{ method: string | undefined, path: string }[]} */
const CALLS = [];

/** @param {{ live: Record<string, unknown>, http: Record<string, unknown> }} staged */
function wire(staged) {
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string }} */ opts = {}) => {
    CALLS.push({ method: opts.method, path });
    if (path === "/api/config/stage" || path === "/api/config/pending") return ok(staged);
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/matrix") return ok({ data: null });
    if (path === "/api/config/apply") return ok({ report: {} });
    return ok({});
  };
}

test("test_clicking_apply_with_an_edit_staged_posts_the_apply_request", async () => {
  wire({ live: {}, http: {} });
  applying.value = false;
  lastApply.value = null;
  pendingPreset.value = null;
  health.value = { reachable: true, ready: true };
  engineState.value = {};
  config.value = { fields: [{ name: "volume_max", value: "-3" }], file: {}, active: "", profiles: null };
  await discardAll();
  wire({ live: {}, http: { volume_max: "-6" } });
  await edit("volume_max", "-6");
  const { seen } = renderTree(html`<${PendingBar} />`);
  const apply = /** @type {VNode} */ (seen.find((v) => v.type === "button" && v.props["data-testid"] === "apply"));
  CALLS.length = 0;
  await /** @type {() => Promise<void>} */ (apply.props.onClick)();
  assert.deepEqual([CALLS[0]?.method, CALLS[0]?.path], ["POST", "/api/config/apply"]);
});
