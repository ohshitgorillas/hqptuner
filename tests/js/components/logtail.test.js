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
// The COPY button and the SCROLL-PINNING behaviour are subject to the same
// limit, and it bites harder. Both were specified against a DOM the JS harness
// does not have: docs/testing.md pins components to preact-render-to-string, so
// there is no element to carry scrollTop/scrollHeight/clientHeight, no useEffect
// to run the poll that fills the pane, and no event dispatch to click a button
// with. Nothing is reachable here that needs LINES on screen. What IS reachable
// is the button's ABSENCE, in both states this harness can reach — tail hidden,
// and tail shown but empty — because absence is a property of the render alone.
// Its presence over a populated pane, the clipboard/execCommand routes, the
// Copied / Copy failed labels and every scroll case belong to tests/e2e/ and the
// playwright hand-back protocol; they are NOT covered here and must not be
// manufactured by exporting the module's private lines/message signals.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/logtail.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { elements } from "../support/markup.js";
import { html } from "../../../hqptuner/static/lib/dom.js";
import { LogTail } from "../../../hqptuner/static/components/LogTail.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { stagingWire } from "../support/wire.js";

// Full reset: a real staging wire (docs/testing.md rule 4), the /config form
// grounding log_enabled, and a clean pending buffer via the public discard.
/** @param {boolean} logEnabled */
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

// --- the copy button ------------------------------------------------------------
//
// Selected as a user finds it: a <button> reading "Copy" anywhere in the block,
// never a test-only hook. "Copied" and "Copy failed" are the same button under a
// changed label, so the needle matches those too and an absence assertion stays
// an absence assertion whatever the button last did.
/** @param {string} out */
const copyButtons = (out) => elements(out).filter((e) => e.name === "button" && e.html.includes("Copy"));

test("test_a_hidden_tail_offers_no_copy_button", async () => {
  // The toggle is drawn either way, so a copy button sharing its header row is
  // one gate away from being drawn either way too.
  await reset(false);
  assert.equal(copyButtons(block()).length, 0);
});

test("test_a_shown_tail_with_no_lines_offers_no_copy_button", async () => {
  await reset(true);
  assert.equal(copyButtons(block()).length, 0);
});
