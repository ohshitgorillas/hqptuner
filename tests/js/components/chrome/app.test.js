// Behavioral suite for components/App.js — the root composition: chrome
// (header, signal path, alert strip, tab bar) over the tab body, with the
// pending bar at the bottom.
//
// Policy (docs/testing.md): public API only, one assertion per test. The only
// branch App takes on its own is the unreachable gate — the `offline` class
// off the exported `ready` computed (itself a pure function of the
// exported `health` signal). That gate, plus the fact that the chrome still
// stands while offline, is the whole contract asserted here: everything else
// App renders belongs to its children's own suites (header.test.js,
// signalpath.test.js, alertstrip.test.js, pendingbar.test.js, the tab
// suites), and re-asserting their trees here would be a snapshot, not a
// contract.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/app.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { App } from "../../../../hqptuner/static/components/App.js";
import {
  health,
  engineState,
  engineStatus,
  config,
  matrixConfig,
  enums,
} from "../../../../hqptuner/static/store/signals.js";
import { loggedOut, setupOpen } from "../../../../hqptuner/static/store/setup.js";
import { attr, elements } from "../../support/markup.js";

afterEach(() => {
  loggedOut.value = false;
  setupOpen.value = false;
});

// Full reset on every call: module signals outlive a test, and every child of
// App reads the store, so each case states the whole world it renders in.
//
// `ready` follows `reachable` unless a case says otherwise: the ordinary world
// is a daemon that is either both or neither, and the window between them is
// what the third case below is about.
/**
 * @param {boolean} reachable
 * @param {boolean} [ready]
 */
function app(reachable, ready = reachable) {
  health.value = { reachable, ready, info: {} };
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

test("test_a_reachable_daemon_the_app_is_not_ready_for_stays_marked_offline", () => {
  assert.ok(app(true, false).includes('class="app offline"'));
});

test("test_the_tab_bar_still_stands_while_offline", () => {
  assert.ok(app(false).includes('class="tab-nav"'));
});

test("test_the_tab_body_renders_inside_main", () => {
  assert.ok(app(true).includes("<main>"));
});

// --- a browser with no login gets the login screen and nothing behind it ---

/**
 * Whether the rendered app holds the element with this test id.
 *
 * @param {string} out
 * @param {string} id
 * @returns {boolean}
 */
const has = (out, id) => elements(out).some((el) => attr(el, "data-testid") === id);

/** The app as a browser with no login renders it, over a daemon that is up. */
function loggedOutApp() {
  loggedOut.value = true;
  setupOpen.value = true;
  return app(true);
}

test("test_a_logged_out_browser_renders_the_panel", () => {
  assert.equal(has(loggedOutApp(), "setup-panel"), true);
});

test("test_a_logged_out_browser_renders_none_of_the_app", () => {
  assert.equal(has(loggedOutApp(), "app"), false);
});

test("test_a_logged_in_browser_renders_the_app", () => {
  assert.equal(has(app(true), "app"), true);
});

test("test_a_logged_in_browser_with_the_panel_shut_renders_no_panel", () => {
  assert.equal(has(app(true), "setup-panel"), false);
});
