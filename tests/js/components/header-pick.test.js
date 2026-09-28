// Behavioral case for components/Header.js's preset picker: a pick made in the
// header reaches the wire as a switch to that preset.
//
// A fetch fake answers the real REST paths and records every request's path
// and JSON body. The change event is fired through the vnode seam, since
// render-to-string fires no events. LIVE mode is on because that is the mode in
// which a pick sends a JSON body at all; outside it the pick is a bodiless
// preview read.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/header-pick.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Header } from "../../../hqptuner/static/components/Header.js";
import { health, engineState, config, pendingPreset } from "../../../hqptuner/static/store/signals.js";
import { liveMode } from "../../../hqptuner/static/store/ui/prefs.js";
import { ok } from "../support/wire/wire.js";
import { renderTree } from "../support/vnodeseam.js";

/** @typedef {import("../support/vnodeseam.js").VNode} VNode */

/** @type {{ fetch?: unknown }} */
const env = globalThis;

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
  liveMode.value = false;
});

const NAMES = ["Day", "Night"];

/** @type {{ path: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

function wire() {
  CALLS.length = 0;
  env.fetch = async (/** @type {string} */ path, /** @type {{ body?: string }} */ opts = {}) => {
    CALLS.push({ path, body: opts.body ? JSON.parse(opts.body) : null });
    if (path === `/api/preset/${NAMES[1]}`) return ok({ name: NAMES[1], config: {} });
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/config/apply") return ok({ report: {} });
    return ok({});
  };
}

test("test_picking_a_preset_in_the_header_sends_it_as_the_switch_target", async () => {
  health.value = { reachable: true, ready: true, info: {} };
  engineState.value = {};
  config.value = {
    fields: [],
    active: "",
    profiles: { value: "", options: NAMES.map((n) => ({ value: n, label: n })) },
  };
  pendingPreset.value = null;
  liveMode.value = true;
  wire();
  const { seen } = renderTree(html`<${Header} />`);
  const select = /** @type {VNode} */ (seen.find((v) => v.type === "select"));
  const onChange = /** @type {(e: { target: { value: string } }) => Promise<void>} */ (select.props.onChange);
  await onChange({ target: { value: NAMES[1] } });
  const sent = CALLS.find((c) => c.body !== null);
  assert.deepEqual([sent?.path, sent?.body?.switch_to], ["/api/config/apply", NAMES[1]]);
});
