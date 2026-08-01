// Behavioral suite for components/tabs/SystemTab.js — the System tab's rendered
// contract.
//
// Policy (docs/testing.md): public API only, one assertion per test. `About`,
// `AboutHqptuner`, `DescriptionPrefs` and `AccentPicker` are private components
// and stay that way; every case here goes through the exported `System`, driven
// by the exported `health` signal.
//
// NOT covered, because the state that reaches it lives in a module-private signal
// with no public writer: the *expanded* "About HQPTuner" subsection, and so the
// Ko-fi anchor inside it. `aboutOpen` is written only from the head button's
// onClick and SSR never fires event handlers. Exporting it to reach the branch
// would widen the public surface to serve a test, so the branch is honestly
// uncovered here; it belongs to the playwright hand-back protocol.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/systemtab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { System } from "../../hqptuner/static/components/tabs/SystemTab.js";
import { health } from "../../hqptuner/static/store/signals.js";

test("about hqptuner prose stays unrendered until the subsection is opened", () => {
  health.value = { info: {}, license: null };
  assert.ok(!render(html`<${System} />`).includes("abt-prose"));
});

test("about hqptuner head offers a closed disclosure triangle by default", () => {
  health.value = { info: {}, license: null };
  assert.ok(render(html`<${System} />`).includes("▸"));
});

test("engine build string is labelled version", () => {
  health.value = { info: { engine: "6.0.0-test" }, license: null };
  assert.ok(render(html`<${System} />`).includes("<dt>Version</dt>"));
});

test("a daemon outside the verified series says so under its version", () => {
  health.value = { info: { engine: "6.1.0" }, license: null };
  assert.ok(render(html`<${System} />`).includes("verified against"));
});

test("a daemon in the verified series draws no notice", () => {
  health.value = { info: { engine: "6.0.4" }, license: null };
  assert.ok(!render(html`<${System} />`).includes("verified against"));
});

// LIVE renders the same engine-health card without its opt-in, since that page
// is always fast. The tab is where the choice is still real, so the tickbox has
// to survive here.

test("the engine health card keeps its quick updates tickbox on the tab", () => {
  health.value = { info: {}, license: null };
  assert.ok(render(html`<${System} />`).includes("Quick updates"));
});
