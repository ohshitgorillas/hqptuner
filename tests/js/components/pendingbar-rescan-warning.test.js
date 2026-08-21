// Behavioral suite for what a device rescan tells the user when it could not
// put the live settings back: the rescan answers `POST /api/config/refresh`
// with a `warning` sentence, and that sentence has to reach the user's eye.
// The apply status line is where every other write reports — a failed apply, a
// preset save (`store/actions.js` lastApply, rendered by components/PendingBar
// .js) — so the rescan reports there too rather than inventing a second place
// to look. When the refresh answers no `warning` the line is left exactly as it
// was: a rescan that cost the user nothing must not wipe the result they are
// still reading.
//
// Driven at the wire (docs/testing.md rule 4): `globalThis.fetch` answers the
// real REST paths with the real payload shapes, the store's own
// `refreshDevices` is the call under test, and the assertion is on the text the
// rendered bar shows. Nothing of the store is stubbed and no private signal is
// touched — `lastApply` is exported and is the same signal pendingbar.test.js
// drives.
//
// The button itself is not clicked: render-to-string attaches no handlers, so
// the click belongs to the playwright hand-back protocol. What is pinned here
// is everything from the rescan call onwards, which is where the behavior is.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/pendingbar-rescan-warning.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { PendingBar } from "../../../hqptuner/static/components/PendingBar.js";
import { cancel } from "../../../hqptuner/static/store/ask.js";
import { health, config, matrixConfig, engineState, pendingPreset } from "../../../hqptuner/static/store/signals.js";
import { applying, lastApply, discardAll } from "../../../hqptuner/static/store/actions.js";
import { refreshDevices } from "../../../hqptuner/static/store/sync.js";
import { ok, staticWire } from "../support/wire.js";

// The sentence in the shape the server sends one, with no character SSR would
// re-encode. Its wording is the server's business; what is pinned here is that
// whatever it says arrives in front of the user.
const WARNING = "Live settings could not be put back.";

// What a status line already showing a result looks like, so a rescan that
// wipes it is visible.
const EARLIER = "Applied 1 change";

/** @param {string} [warning] */
function wire(warning) {
  staticWire({ live: {}, http: {} }, (path) => {
    if (path === "/api/config/refresh") {
      return ok(warning === undefined ? { refreshed: true, restored: {} } : { refreshed: true, restored: {}, warning });
    }
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/matrix") return ok({ data: matrixConfig.value });
    return undefined; // unhandled path: the wire's own fallback answers it
  });
}

// Full reset every time — these signals outlive a test (pendingbar.test.js).
/** @param {string} [warning] */
async function reset(warning) {
  wire(warning);
  cancel();
  applying.value = false;
  lastApply.value = null;
  pendingPreset.value = null;
  health.value = { reachable: true };
  engineState.value = {};
  matrixConfig.value = { fields: [] };
  config.value = { fields: [{ name: "volume_max", value: "-3" }], file: {}, active: "", profiles: null };
  await discardAll();
}

// SSR escapes entities; the contract is the text a user reads.
const bar = () =>
  render(html`<${PendingBar} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

test("test_a_rescan_that_could_not_put_the_live_settings_back_says_so_in_the_status_line", async () => {
  await reset(WARNING);
  await refreshDevices();
  assert.ok(bar().includes(WARNING));
});

test("test_a_rescan_with_nothing_to_warn_about_leaves_the_status_line_alone", async () => {
  await reset();
  lastApply.value = { ok: true, text: EARLIER };
  // the whole render, not a substring: a rescan that appended a second status
  // line beside the old one would still contain the old one
  const before = bar();
  await refreshDevices();
  assert.equal(bar(), before);
});
