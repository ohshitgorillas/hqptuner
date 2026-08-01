// Behavioral suite for components/LogTail.js — the live log-tail block on the
// System tab: a checkbox that DEFAULTS to the daemon's logging state
// (log_enabled), revealing a static 50-line window while checked.
//
// Policy (docs/testing.md): public API only, one assertion per test. The
// toggle's default is a pure function of effective("log_enabled") — the staged
// buffer over the /config form — so both sides of the follow-the-config branch
// are reachable through the exported store: config for the baseline, edit()
// over the real staging wire for the staged override.
//
// NOT REACHABLE from here, and deliberately not exported to make it so: the
// module-private `shown`, `lines` and `message` signals. `shown` (the user's
// manual override of the default) is written only by the checkbox's onChange;
// `lines`/`message` (the tail text, and the unavailable/failed states) are
// written only by the poll's refresh(), which runs from useEffect — and SSR
// fires no events and runs no effects. So the pane is only observable EMPTY
// here: its populated, unavailable and request-failed renderings, and the
// 3-second polling machinery itself, belong to the playwright hand-back
// protocol.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/logtail.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { LogTail } from "../../hqptuner/static/components/LogTail.js";
import { config, matrixConfig } from "../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../hqptuner/static/store/actions.js";
import { stagingWire } from "./wire.js";

// Full reset: a real staging wire (docs/testing.md rule 4), the /config form
// grounding log_enabled, and a clean pending buffer via the public discard.
async function reset(logEnabled) {
  stagingWire();
  matrixConfig.value = null;
  config.value = { fields: [{ name: "log_enabled", value: logEnabled }], file: {} };
  await discardAll();
}

const block = () => render(html`<${LogTail} />`);

// --- the toggle follows the logging config ------------------------------------

test("test_the_toggle_defaults_on_while_logging_is_enabled", async () => {
  await reset(true);
  assert.ok(block().includes("checked"));
});

test("test_the_toggle_defaults_off_while_logging_is_disabled", async () => {
  await reset(false);
  assert.equal(block().includes("checked"), false);
});

test("test_a_staged_logging_enable_turns_the_toggle_on", async () => {
  await reset(false);
  await edit("log_enabled", "1");
  assert.ok(block().includes("checked"));
});

test("test_a_staged_logging_disable_turns_the_toggle_off", async () => {
  await reset(true);
  await edit("log_enabled", "0");
  assert.equal(block().includes("checked"), false);
});

// --- the tail pane -------------------------------------------------------------

test("test_an_on_toggle_reveals_the_tail_pane", async () => {
  await reset(true);
  assert.ok(block().includes('class="log-tail"'));
});

test("test_an_off_toggle_hides_the_tail_pane", async () => {
  await reset(false);
  assert.equal(block().includes('class="log-tail"'), false);
});

test("test_the_toggle_names_its_fifty_line_window", async () => {
  await reset(false);
  assert.ok(block().includes("last 50 lines"));
});
