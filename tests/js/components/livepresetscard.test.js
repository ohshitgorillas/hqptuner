// Behavioral suite for the LIVE MODE card components/live/View.js renders from
// the saved live presets. The store itself — the list and the four verbs — is
// covered in livepresets.test.js; the wire fake and fixtures both suites use
// live in livepresetwire.js.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire.
//
// PICKING a preset IS observable here: an option row's own onClick is reached
// through the vnode preact built (tests/js/support/vnodeseam.js), the
// renderer's public seam, and the wire fake records the request the handler
// fires. What is still not observable is Save and Delete and their name prompt
// / overwrite / delete confirms, whose flows run through module-private signals
// this suite does not widen (docs/testing.md, "Branches that cannot be
// reached").
//
// Covered only as far as the mention, because the spec quotes no copy for them:
// the card naming live presets as distinct from the header's presets and the
// matrix profiles, and the two things it says about the output mode — that a
// save captures it and that an apply can switch it. The words matched are the
// spec's own; whether the sentences read well is a reading job, not a unit
// test's.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/livepresetscard.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/live/View.js";
import {
  health,
  engineState,
  engineStatus,
  enums,
  config,
  matrixConfig,
  metadata,
  volume,
  volumeRange,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { livePresets, livePresetsBusy, livePresetError } from "../../../hqptuner/static/store/live/presets.js";
import { rec, STATE, ENUMS, METADATA, presetWire } from "../support/livepresetwire.js";
import { renderTree } from "../support/vnodeseam.js";
import { quiesce } from "../support/wire.js";
import { cardHeadAt, section } from "../support/tabform.js";
import { elements, classes, attr, hasAttr, text } from "../support/markup.js";
import { boxText, rows, vnodeRows, click } from "../support/comborows.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// Total reset for the rendered page: every source signal the LIVE page reads,
// plus the three this file's store owns. LIVE mode stays OFF so the list on
// screen is the one the case seeded, not one the wire re-served.
/** @typedef {import("../support/livepresetwire.js").PresetRecord} PresetRecord */

/**
 * @param {{ chain?: string, presets?: PresetRecord[], error?: string, busy?: string }} [fixture]
 * @returns {Promise<import("../support/livepresetwire.js").PresetWire>}
 */
async function resetPage({ chain = "pcm", presets = [], error = "", busy = "" } = {}) {
  const wire = presetWire({ presets, chain });
  health.value = { reachable: true, info: {} };
  engineState.value = STATE(chain);
  engineStatus.value = null;
  enums.value = ENUMS;
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = false;
  livePresets.value = presets;
  livePresetsBusy.value = busy;
  livePresetError.value = error;
  await discardAll();
  return wire;
}

const page = () => render(html`<${LiveView} />`);

// The LIVE MODE card, by the id its section carries — the card's own machine
// identity, never the words in its head (docs/testing.md rule 9).
const LIVE_MODE = "live-mode";

// One card's own markup. A miss throws rather than quietly measuring the whole
// page, so a card that stopped rendering fails loudly.
/**
 * @param {string} out
 * @param {string} id
 */
function card(out, id) {
  const frag = section(out, id);
  if (frag === "") throw new Error(`no card identified "${id}" in the rendered page`);
  return frag;
}

// SSR escapes entities; decode before asserting on what the user reads.
/** @param {string} s */
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// The picker is a combobox (controls/Combobox.js): a role="combobox" button
// beside a .dd-pop listbox of .dd-opt rows, each carrying the option's wire
// value in `data-v`. The pop renders in its CLOSED state here rather than
// unmounted, so its rows are in the SSR string and can be read.
//
// The picker's own subtree, by the machine identity its control wrapper carries
// — not the whole card, so a control added to the card later cannot be mistaken
// for an option of this one.
/** @param {string} frag */
const picker = (frag) => {
  const el = elements(frag).find((e) => attr(e, "data-testid") === "live-preset");
  if (el === undefined) throw new Error("the card renders no live preset picker");
  return el.html;
};

// SSR emits an EMPTY attribute value bare (`data-v`, never `data-v=""`), which
// `attr` reads as undefined — so presence is asked first and the placeholder
// row's value comes back as the empty string it is. A row carrying no `data-v`
// at all is not an option and is dropped.
/** @param {import("../support/markup.js").MarkupElement} el */
const valueOf = (el) => (hasAttr(el, "data-v") ? (attr(el, "data-v") ?? "") : undefined);

/** @param {string} frag */
const options = (frag) =>
  rows(picker(frag))
    .filter((el) => valueOf(el) !== undefined)
    .map((el) => ({ el, v: /** @type {string} */ (valueOf(el)), text: decode(text(el)) }));

// The two fixtures straddle the chains on purpose: one was captured under the
// mode the engine reports, one under the other. Neither is special any more.
const HERE = () => rec("Living Room", "pcm"); // captured under the running mode
const ELSEWHERE = () => rec("Bedroom", "sdm"); // captured under the other one
const BOTH = () => [HERE(), ELSEWHERE()];
// The rows offering the two fixture presets, found by the wire value each row
// carries: for this picker an option's value IS the preset's name, so the row
// is identified without reading the words rendered in it (rule 9).
/** @param {string} frag */
const NAMED = (frag) => options(frag).filter((o) => BOTH().some((p) => o.v === p.name));

test("test_the_live_page_carries_a_live_mode_card", async () => {
  await resetPage();
  assert.notEqual(cardHeadAt(page(), LIVE_MODE), -1);
});

// The case that pinned the card's lede is gone: that sentence is owner-owned
// copy with no machine identity beside it (rule 9).

// The case that asked only that both presets are OFFERED by name is gone: it is
// subsumed by test_both_saved_presets_can_be_picked_while_the_engine_runs_pcm,
// which asserts the same two wire values and their pickability besides.

// Stated positively — "the pickable ones are BOTH of them", not "none is
// disabled" — so a card that dropped a preset from the picker altogether fails
// here instead of passing on an empty list.
// A combobox row states its unpickability with `aria-disabled` rather than the
// native attribute, and dresses it with a class; either one grays the row.
/** @param {import("../support/markup.js").MarkupElement} el */
const grayed = (el) => attr(el, "aria-disabled") === "true" || classes(el).includes("disabled");

/** @param {string} frag */
const pickable = (frag) =>
  NAMED(frag)
    .filter((o) => !grayed(o.el))
    .map((o) => o.v)
    .sort();

test("test_both_saved_presets_can_be_picked_while_the_engine_runs_pcm", async () => {
  await resetPage({ chain: "pcm", presets: BOTH() });
  assert.deepEqual(pickable(card(page(), LIVE_MODE)), ["Bedroom", "Living Room"]);
});

test("test_both_saved_presets_can_be_picked_while_the_engine_runs_sdm", async () => {
  await resetPage({ chain: "sdm", presets: BOTH() });
  assert.deepEqual(pickable(card(page(), LIVE_MODE)), ["Bedroom", "Living Room"]);
});

test("test_every_saved_preset_is_offered_by_name_alone", async () => {
  // No reason, no chain tag, no "(SDM)" — nothing beside the name, for either
  // preset, because neither is second-class now.
  // Sorted on both sides: the picker's ORDER is not a spec'd behavior, so it
  // is not what this case is here to pin.
  await resetPage({ presets: BOTH() });
  assert.deepEqual(
    NAMED(card(page(), LIVE_MODE))
      .map((o) => o.text)
      .sort(),
    ["Bedroom", "Living Room"],
  );
});

test("test_an_empty_preset_store_offers_one_option_that_is_no_preset", async () => {
  // In the PICKER, not merely somewhere on the card: the line has to be what the
  // dropdown offers, or a card that printed it as a paragraph beside an empty
  // picker would pass while the control said nothing. WHAT that one option says
  // is the owner's wording (rule 9), so the "is no preset" half is read off the
  // option's VALUE: a preset option carries the preset it selects, and this one
  // carries nothing — SSR emits an empty value as a bare `data-v`. Counting the
  // options alone leaves that half unchecked.
  await resetPage({ presets: [] });
  const only = options(card(page(), LIVE_MODE));
  const seen = { count: only.length, selects: only.map((o) => o.v) };
  assert.deepEqual(seen, { count: 1, selects: [""] });
});

test("test_a_stocked_picker_opens_on_something_that_is_no_preset", async () => {
  // The picker's SELECTION, which is what the CLOSED button shows — not the
  // first row of the pop, which says only what the list starts with. WHAT the
  // button says instead is the owner's wording (rule 9), so the assertion is
  // that it is none of the saved names.
  await resetPage({ presets: BOTH() });
  const shown = decode(boxText(picker(card(page(), LIVE_MODE))));
  assert.equal(
    BOTH().some((p) => shown === p.name),
    false,
  );
});

test("test_a_preset_failure_shows_on_the_card", async () => {
  await resetPage({ presets: BOTH(), error: "the preset store is not writable" });
  assert.ok(/class="live-error">the preset store is not writable</.test(card(page(), LIVE_MODE)));
});

// One further case stood here, asserting that some sentence on the card claims
// a preset stores the whole page — a regex over the card's prose. It is gone:
// what the card's sentences say is owner-owned copy and a reading job, not a
// unit test's (docs/testing.md rule 9).

// --- what a pick does ---------------------------------------------------------
//
// A pick is an option row's own onClick, fired through the vnode preact built
// for that row — the renderer's public `options.vnode` seam, nothing of
// HQPTuner's stubbed (docs/testing.md rule 4), the same way
// combobox-fav.test.js activates a star SSR renders but cannot click.
//
// Rows are addressed by the wire value each carries and NOT by walking down
// from the picker's wrapper: `props.children` does not cross a component
// boundary (support/wheel.js states the same limit), so a subtree walk from a
// wrapper some parent rendered reaches none of the rows. `pickRow` instead
// requires the value to be carried by exactly one dd-opt row in the whole page
// and throws otherwise, so no case can click another dropdown's row by mistake.

/** @typedef {import("../support/wheel.js").VNode} VNode */

const renderLive = () => renderTree(html`<${LiveView} />`);

/**
 * The one option row carrying `value`, anywhere in the rendered page.
 *
 * @param {VNode[]} seen
 * @param {string} value
 * @returns {VNode}
 */
function pickRow(seen, value) {
  const hits = vnodeRows(seen).filter((r) => r.props["data-v"] === value);
  if (hits.length !== 1) {
    throw new Error(`expected one dd-opt row carrying data-v="${value}", found ${hits.length}`);
  }
  return hits[0];
}

// POST /api/livepresets/{name}/apply is the one request that applies a preset
// (the fake serves the real path). The names are read back off the paths the
// fake was handed, so a case pins WHICH preset was applied and HOW OFTEN in one
// comparison.
const APPLY = /^\/api\/livepresets\/([^/]+)\/apply$/;

/**
 * @param {import("../support/livepresetwire.js").PresetWire} w
 * @returns {string[]}
 */
const applied = (w) =>
  w.calls
    .filter((c) => c.method === "POST" && APPLY.test(c.path))
    .map((c) => decodeURIComponent(/** @type {RegExpExecArray} */ (APPLY.exec(c.path))[1]));

// The picker's SELECTION, off the closed button — for this picker the wire
// value of a preset row IS the preset's name, so this reads data and not copy.
// Throws rather than asserting: it is the second re-pick case's PRECONDITION,
// and a case whose precondition never held must not read as a pass.
/** @param {string} name */
function requireSelection(name) {
  const shown = decode(boxText(picker(card(page(), LIVE_MODE))));
  if (shown !== name) throw new Error(`the picker's selection is "${shown}", not "${name}"`);
}

test("test_picking_a_preset_applies_that_preset_once", async () => {
  const w = await resetPage({ presets: BOTH() });
  click(pickRow(renderLive().seen, "Living Room"));
  await quiesce(w);
  assert.deepEqual(applied(w), ["Living Room"]);
});

test("test_picking_the_preset_already_selected_applies_it_again", async () => {
  // One apply per click: two clicks on the same row, two applies. The first
  // click is what makes the preset the selection, and that precondition is
  // established before the second click rather than assumed — without it the
  // case would pass against a picker that applies only on a CHANGE of value.
  const w = await resetPage({ presets: BOTH() });
  click(pickRow(renderLive().seen, "Living Room"));
  await quiesce(w);
  requireSelection("Living Room");
  click(pickRow(renderLive().seen, "Living Room"));
  await quiesce(w);
  assert.deepEqual(applied(w), ["Living Room", "Living Room"]);
});

test("test_picking_the_placeholder_row_applies_nothing", async () => {
  // A deterministic negative: the fake answers every request it is handed, so
  // `quiesce` returns on a wire that went quiet rather than on one still
  // waiting (combobox-fav.test.js does the same for a star click).
  const w = await resetPage({ presets: BOTH() });
  click(pickRow(renderLive().seen, ""));
  await quiesce(w);
  assert.deepEqual(applied(w), []);
});
