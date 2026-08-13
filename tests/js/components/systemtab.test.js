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

import { html } from "../../../hqptuner/static/lib/dom.js";
import { System } from "../../../hqptuner/static/components/tabs/SystemTab.js";
import { health, config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions, quickSystemUpdates } from "../../../hqptuner/static/store/prefs.js";
import { stagingWire } from "../support/wire.js";
import { formFields } from "../support/tabform.js";
import { elements, enclosing, hasAttr, hasLabel, labelled } from "../support/markup.js";

test("about hqptuner prose stays unrendered until the subsection is opened", () => {
  health.value = { info: {}, license: null };
  assert.ok(!render(html`<${System} />`).includes("abt-prose"));
});

test("about hqptuner head offers a closed disclosure triangle by default", () => {
  health.value = { info: {}, license: null };
  assert.ok(render(html`<${System} />`).includes("▸"));
});

test("the version row carries the daemon's release string", () => {
  health.value = { info: { engine: "6.0.4" }, release: "6.0.2", license: null };
  assert.match(render(html`<${System} />`), /<dt>Version<\/dt>\s*<dd>6\.0\.2<\/dd>/);
});

test("the engine row carries the reported engine version", () => {
  health.value = { info: { engine: "6.0.4" }, release: "6.0.2", license: null };
  assert.match(render(html`<${System} />`), /<dt>Engine<\/dt>\s*<dd>6\.0\.4<\/dd>/);
});

test("an empty release renders no version row", () => {
  health.value = { info: { engine: "6.0.4" }, release: "", license: null };
  assert.ok(!render(html`<${System} />`).includes("<dt>Version</dt>"));
});

test("an empty release still leaves the engine row in place", () => {
  health.value = { info: { engine: "6.0.4" }, release: "", license: null };
  assert.match(render(html`<${System} />`), /<dt>Engine<\/dt>\s*<dd>6\.0\.4<\/dd>/);
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

test("the quick updates opt-in keeps its poll opt-in class", () => {
  health.value = { info: {}, license: null };
  assert.ok(render(html`<${System} />`).includes("poll-quick"));
});

// The cadence the opt-in buys is one second, and the note says so in those
// words — one second is what every fast page now polls at (store/ui.js).

test("the quick updates note names a one second refresh", () => {
  health.value = { info: {}, license: null };
  assert.ok(render(html`<${System} />`).includes("refresh every second while this page is open"));
});

test("the quick updates tickbox reflects the stored preference", () => {
  health.value = { info: {}, license: null };
  quickSystemUpdates.value = true;
  assert.ok(hasAttr(switchOf(render(html`<${System} />`), "Quick updates"), "checked"));
});

test("the quick updates tickbox is clear when the preference is off", () => {
  health.value = { info: {}, license: null };
  quickSystemUpdates.value = false;
  assert.equal(hasAttr(switchOf(render(html`<${System} />`), "Quick updates"), "checked"), false);
});

// --- engine timing and UPnP ---------------------------------------------------
// The reorganization moved the engine's timing knobs and the UPnP freewheel in
// from the Output tab. Membership is "exactly": each card's whole <label>
// sequence is compared, so a stray extra control fails alongside a missing one.
// Timing's internal order is not part of the contract, so its labels are
// compared as a sorted set.

async function reset() {
  stagingWire();
  health.value = { info: {}, license: null };
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  matrixConfig.value = { fields: [] };
  config.value = {
    fields: formFields({ idle_time: "0", quick_pause: false, short_buffer: "0", upnp_freewheel: false }),
    file: {},
    active: "",
    profiles: null,
  };
  await discardAll();
}

/**
 * @param {string} out
 * @param {string} title
 */
const card = (out, title) => {
  const head = out.indexOf(`<div class="card-head">${title}</div>`);
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};
/** @param {string} frag */
const labelsOf = (frag) => [...frag.matchAll(/<label>([^<]*)/g)].map((m) => m[1].trim());

test("the timing card carries exactly the three engine timing controls", async () => {
  await reset();
  assert.deepEqual(labelsOf(card(render(html`<${System} />`), "Timing")).sort(), [
    "Engine idle time",
    "Quick pause",
    "Short buffer",
  ]);
});

test("the upnp card carries exactly the upnp freewheel control", async () => {
  await reset();
  assert.deepEqual(labelsOf(card(render(html`<${System} />`), "UPnP")), ["UPnP freewheel"]);
});

// --- description-visibility prefs ---------------------------------------------
// Two client-only localStorage prefs surface here as switches. The master
// ("Setting descriptions") forces the second ("Option descriptions") on while
// itself on: the second renders checked and disabled, purely as presentation —
// the stored keep-option pref is never rewritten by a render. With the master
// off, the second switch is live and mirrors the stored pref exactly.

const MASTER = "Setting descriptions";
const KEEP = "Option descriptions";

// The switch input a label announces. Starts inside the label itself (the
// tickbox convention from playbackvolume.test.js) and, when the input sits
// beside the label rather than inside it, widens to the smallest enclosing
// region — the row the pair shares — without naming any structure in between.
/**
 * @param {string} out
 * @param {string} label
 * @returns {import("../support/markup.js").MarkupElement}
 */
function switchOf(out, label) {
  let region = labelled(out, label);
  for (let step = 0; step < 3; step += 1) {
    const hit = elements(region.html).find((el) => el.name === "input");
    if (hit) return hit;
    region = enclosing(out, region);
  }
  throw new Error(`no input near the control labelled "${label}"`);
}

test("the master pref on forces the option descriptions switch checked", async () => {
  await reset();
  showDescriptions.value = true;
  keepOptionDescriptions.value = false;
  assert.ok(hasAttr(switchOf(render(html`<${System} />`), KEEP), "checked"));
});

test("the master pref on disables the option descriptions switch", async () => {
  await reset();
  showDescriptions.value = true;
  keepOptionDescriptions.value = false;
  assert.ok(hasAttr(switchOf(render(html`<${System} />`), KEEP), "disabled"));
});

test("with the master off an off keep pref renders the switch unchecked", async () => {
  await reset();
  showDescriptions.value = false;
  keepOptionDescriptions.value = false;
  assert.equal(hasAttr(switchOf(render(html`<${System} />`), KEEP), "checked"), false);
});

test("with the master off an on keep pref renders the switch checked", async () => {
  await reset();
  showDescriptions.value = false;
  keepOptionDescriptions.value = true;
  assert.ok(hasAttr(switchOf(render(html`<${System} />`), KEEP), "checked"));
});

test("with the master off the option descriptions switch is enabled", async () => {
  await reset();
  showDescriptions.value = false;
  keepOptionDescriptions.value = false;
  assert.equal(hasAttr(switchOf(render(html`<${System} />`), KEEP), "disabled"), false);
});

test("with the master off an on keep pref leaves the switch enabled", async () => {
  await reset();
  showDescriptions.value = false;
  keepOptionDescriptions.value = true;
  assert.equal(hasAttr(switchOf(render(html`<${System} />`), KEEP), "disabled"), false);
});

test("a render under the master pref leaves the stored keep pref untouched", async () => {
  await reset();
  showDescriptions.value = true;
  keepOptionDescriptions.value = false;
  render(html`<${System} />`);
  assert.equal(keepOptionDescriptions.value, false);
});

test("the master toggle is labelled setting descriptions", async () => {
  await reset();
  assert.ok(hasLabel(render(html`<${System} />`), MASTER));
});

test("no toggle is labelled feature descriptions any more", async () => {
  await reset();
  assert.equal(hasLabel(render(html`<${System} />`), "Feature descriptions"), false);
});

test("the second toggle is labelled option descriptions", async () => {
  await reset();
  assert.ok(hasLabel(render(html`<${System} />`), KEEP));
});
