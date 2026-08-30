// Behavioral suite for the LIVE MODE card components/live/View.js renders from
// the saved live presets. The store itself — the list and the four verbs — is
// covered in livepresets.test.js; the wire fake and fixtures both suites use
// live in livepresetwire.js.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire.
//
// Not observable here, deliberately: picking a preset from the dropdown,
// clicking Save or Delete, and the name prompt / overwrite / delete confirms.
// The suite renders server-side (preact-render-to-string), which never fires an
// event handler, and the module-private signals those handlers write are not
// widened to reach them (docs/testing.md, "Branches that cannot be reached").
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
import { cardHeadAt, section } from "../support/tabform.js";
import { elements, classes, attr, hasAttr, text } from "../support/markup.js";
import { rows } from "../support/comborows.js";

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
 */
async function resetPage({ chain = "pcm", presets = [], error = "", busy = "" } = {}) {
  presetWire({ presets, chain });
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

test("test_every_saved_preset_is_offered_by_name", async () => {
  await resetPage({ presets: BOTH() });
  const offered = options(card(page(), LIVE_MODE)).map((o) => o.v);
  assert.deepEqual(
    ["Living Room", "Bedroom"].filter((n) => offered.includes(n)),
    ["Living Room", "Bedroom"],
  );
});

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
  await resetPage({ presets: BOTH() });
  const first = options(card(page(), LIVE_MODE))[0].v;
  assert.equal(
    BOTH().some((p) => first === p.name),
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
