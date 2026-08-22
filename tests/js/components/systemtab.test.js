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

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { System } from "../../../hqptuner/static/components/tabs/SystemTab.js";
import { health, config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions, quickSystemUpdates } from "../../../hqptuner/static/store/prefs.js";
import { stagingWire } from "../support/wire.js";
import { formFields, section } from "../support/tabform.js";
import { classes, elements, enclosing, hasAttr, hasLabel, labeled } from "../support/markup.js";

// The quick-updates preference is a module-level signal and outlives a case
// (docs/testing.md, harness facts), so the cases that write it are put back to
// the off state here rather than left for whatever runs next.
afterEach(() => {
  quickSystemUpdates.value = false;
});

test("about hqptuner prose stays unrendered until the subsection is opened", () => {
  health.value = { info: {}, license: null };
  assert.ok(!render(html`<${System} />`).includes("abt-prose"));
});

// DELETED: "about hqptuner head offers a closed disclosure triangle by default",
// which read the disclosure mark out of the render. The mark is presentation the
// owner may change at will — it is a shape CSS draws, in an element of its own —
// and no state stands behind it; that the subsection starts closed is what the
// case above pins.

// The two version readings are DATA, not copy: the daemon reports its installed
// release and its DSP engine build as separate numbers, and each has to reach
// the card as itself. Which row is captioned what is the owner's business and is
// asserted nowhere (docs/testing.md rule 9).

test("the card shows the daemon's release string", () => {
  health.value = { info: { engine: "6.0.4" }, release: "6.0.2", license: null };
  assert.ok(render(html`<${System} />`).includes("6.0.2"));
});

test("the card shows the reported engine version", () => {
  health.value = { info: { engine: "6.0.4" }, release: "6.0.2", license: null };
  assert.ok(render(html`<${System} />`).includes("6.0.4"));
});

test("an empty release renders no empty row of its own", () => {
  // A row rendered for a release the daemon never reported reads as a blank
  // value beside a caption; nothing on this card renders empty.
  health.value = { info: { engine: "6.0.4" }, release: "", license: null };
  assert.equal(/<dd>\s*<\/dd>/.test(render(html`<${System} />`)), false);
});

test("an empty release still leaves the engine version on the card", () => {
  health.value = { info: { engine: "6.0.4" }, release: "", license: null };
  assert.ok(render(html`<${System} />`).includes("6.0.4"));
});

// The notice a daemon outside the verified series draws, by its own identity —
// `data-note="unverified-daemon"`. What it says there is owner copy and is
// asserted nowhere (docs/testing.md rule 9).

const UNVERIFIED = 'data-note="unverified-daemon"';

test("a daemon outside the verified series draws the notice", () => {
  health.value = { info: { engine: "6.1.0" }, license: null };
  assert.ok(render(html`<${System} />`).includes(UNVERIFIED));
});

test("a daemon in the verified series draws no notice", () => {
  health.value = { info: { engine: "6.0.4" }, license: null };
  assert.equal(render(html`<${System} />`).includes(UNVERIFIED), false);
});

// LIVE renders the same engine-health card without its opt-in, since that page
// is always fast. The tab is where the choice is still real, so the tickbox has
// to survive here.

// The opt-in is found by the class its own region carries, `poll-quick` — a CSS
// class is contract, the words beside the tickbox are not (docs/testing.md rule
// 9).

/**
 * The tickbox inside the quick-updates opt-in.
 *
 * @param {string} out
 * @returns {import("../support/markup.js").MarkupElement}
 */
function quickTickbox(out) {
  const region = elements(out).find((el) => classes(el).includes("poll-quick"));
  if (!region) throw new Error("the card carries no quick-updates opt-in");
  const hit = elements(region.html).find((el) => el.name === "input");
  if (!hit) throw new Error("the quick-updates opt-in carries no tickbox");
  return hit;
}

test("the engine health card keeps its quick updates tickbox on the tab", () => {
  health.value = { info: {}, license: null };
  assert.ok(render(html`<${System} />`).includes("poll-quick"));
});

// The opt-in explains what the faster cadence costs, in a note of its own. That
// the explanation is there is the behavior; the cadence it names is store/ui.js's
// contract (tests/js/store/polling.test.js) and the sentence is owner copy, so
// the note is read by its identity alone (docs/testing.md rule 9).

test("the quick updates opt-in carries its explanatory note", () => {
  health.value = { info: {}, license: null };
  assert.ok(render(html`<${System} />`).includes('data-note="poll-quick"'));
});

test("the quick updates tickbox reflects the stored preference", () => {
  health.value = { info: {}, license: null };
  quickSystemUpdates.value = true;
  assert.ok(hasAttr(quickTickbox(render(html`<${System} />`)), "checked"));
});

test("the quick updates tickbox is clear when the preference is off", () => {
  health.value = { info: {}, license: null };
  quickSystemUpdates.value = false;
  assert.equal(hasAttr(quickTickbox(render(html`<${System} />`)), "checked"), false);
});

// --- engine timing and UPnP ---------------------------------------------------
// The reorganization moved the engine's timing knobs and the UPnP freewheel in
// from the Output tab. Membership is "exactly": each card's whole field-key
// sequence is compared, so a stray extra control fails alongside a missing one.
// A control is named by the schema key it wears in `data-k`, never by its label
// (docs/testing.md rule 9). Timing's internal order is not part of the contract,
// so its keys are compared as a sorted set.

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

// One card's fragment, keyed by the `data-card` its <section> carries.
const card = section;
/** @param {string} frag */
const keysOf = (frag) => [...frag.matchAll(/data-k="([^"]*)"/g)].map((m) => m[1]);

test("the timing card carries exactly the three engine timing controls", async () => {
  await reset();
  assert.deepEqual(keysOf(card(render(html`<${System} />`), "timing")).sort(), [
    "idle_time",
    "quick_pause",
    "short_buffer",
  ]);
});

test("the upnp card carries exactly the upnp freewheel control", async () => {
  await reset();
  assert.deepEqual(keysOf(card(render(html`<${System} />`), "upnp")), ["upnp_freewheel"]);
});

// --- description-visibility prefs ---------------------------------------------
// Two client-only localStorage prefs surface here as switches. The master
// ("Setting descriptions") forces the second ("Option descriptions") on while
// itself on: the second renders checked and disabled, purely as presentation —
// the stored keep-option pref is never rewritten by a render. With the master
// off, the second switch is live and mirrors the stored pref exactly.

// Each pref switch by the key its own field wears in `data-k` — the pref the
// switch is bound to, never the words announcing it (docs/testing.md rule 9).
const MASTER = "showDescriptions";
const KEEP = "keepOptionDescriptions";

// The switch input a keyed control announces. Starts inside the control itself
// (the tickbox convention from playbackvolume.test.js) and, when the input sits
// beside it rather than within, widens to the smallest enclosing region — the
// row the pair shares — without naming any structure in between.
/**
 * @param {string} out
 * @param {string} key
 * @returns {import("../support/markup.js").MarkupElement}
 */
function switchOf(out, key) {
  let region = labeled(out, key);
  for (let step = 0; step < 3; step += 1) {
    const hit = elements(region.html).find((el) => el.name === "input");
    if (hit) return hit;
    region = enclosing(out, region);
  }
  throw new Error(`no input near the control keyed "${key}"`);
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

test("the tab offers the master descriptions switch", async () => {
  await reset();
  assert.ok(hasLabel(render(html`<${System} />`), MASTER));
});

// DELETED: "no toggle is labeled feature descriptions any more". The switch is
// addressed by the pref it is bound to now, and the retired wording is not a
// state anything can be in — an absence assertion against it constrains nothing.

test("the tab offers the option descriptions switch", async () => {
  await reset();
  assert.ok(hasLabel(render(html`<${System} />`), KEEP));
});
