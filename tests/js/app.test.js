// Behavioral suite for components/App.js — the root composition: chrome
// (header, signal path, alert strip, tab bar) over the tab body, with the
// pending bar at the bottom.
//
// Policy (docs/testing.md): public API only, one assertion per test. The only
// branch App takes on its own is the unreachable gate — the `offline` class
// off the exported `reachable` computed (itself a pure function of the
// exported `health` signal). That gate, plus the fact that the chrome still
// stands while offline, is the whole contract asserted here: everything else
// App renders belongs to its children's own suites (header.test.js,
// signalpath.test.js, alertstrip.test.js, pendingbar.test.js, the tab
// suites), and re-asserting their trees here would be a snapshot, not a
// contract.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/app.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { App } from "../../hqptuner/static/components/App.js";
import { health, engineState, engineStatus, config, matrixConfig, enums } from "../../hqptuner/static/store/signals.js";

// Full reset on every call: module signals outlive a test, and every child of
// App reads the store, so each case states the whole world it renders in.
function app(reachable) {
  health.value = { reachable, info: {} };
  engineState.value = {};
  engineStatus.value = null;
  config.value = null;
  matrixConfig.value = null;
  enums.value = null;
  return render(html`<${App} />`);
}

test("test_an_unreachable_daemon_marks_the_app_offline", () => {
  assert.ok(app(false).includes('class="app offline"'));
});

test("test_a_reachable_daemon_leaves_the_offline_mark_off", () => {
  assert.equal(app(true).includes("offline"), false);
});

test("test_the_tab_bar_still_stands_while_offline", () => {
  assert.ok(app(false).includes('class="tab-nav"'));
});

test("test_the_tab_body_renders_inside_main", () => {
  assert.ok(app(true).includes("<main>"));
});
