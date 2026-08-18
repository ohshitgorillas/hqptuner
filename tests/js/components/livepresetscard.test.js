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
import { classes, elements, headTitle } from "../support/markup.js";

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

const MARK = "<section";

// The card heads of a rendered page whose title is exactly `title`, earliest
// first. Scanned as elements, by the class the head wears and by the words a
// reader sees in it (tests/js/support/markup.js) — never against the raw
// attribute text, so the order of a head's classes, and whatever else the
// component writes into the tag, are the component's own business.
/**
 * @param {string} out
 * @param {string} title
 * @returns {import("../support/markup.js").MarkupElement[]}
 */
const heads = (out, title) =>
  elements(out)
    .filter((el) => classes(el).includes("card-head") && headTitle(el) === title)
    .sort((a, b) => a.start - b.start);

/**
 * @param {string} out
 * @param {string} title
 * @returns {boolean}
 */
const hasHead = (out, title) => heads(out, title).length > 0;

// One named card's own markup: from its section tag up to the next section. A
// miss throws rather than quietly measuring the whole page — a renamed head must
// fail loudly, not pass on some other card's text.
/**
 * @param {string} out
 * @param {string} title
 */
function card(out, title) {
  const [hit] = heads(out, title);
  if (!hit) throw new Error(`no card headed "${title}" in the rendered page`);
  const at = hit.start;
  const from = out.lastIndexOf(MARK, at);
  if (from < 0) throw new Error(`the card headed "${title}" is not inside a section`);
  const next = out.indexOf(MARK, at);
  return out.slice(from, next < 0 ? undefined : next);
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

/** @param {string} frag */
const options = (frag) =>
  [...frag.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)].map((m) => ({ tag: m[0], text: decode(m[1]).trim() }));

// The two fixtures straddle the chains on purpose: one was captured under the
// mode the engine reports, one under the other. Neither is special any more.
const HERE = () => rec("Living Room", "pcm"); // captured under the running mode
const ELSEWHERE = () => rec("Bedroom", "sdm"); // captured under the other one
const BOTH = () => [HERE(), ELSEWHERE()];
/** @param {string} frag */
const NAMED = (frag) => options(frag).filter((o) => BOTH().some((p) => o.text.includes(p.name)));

test("test_the_live_page_carries_a_live_mode_card", async () => {
  await resetPage();
  assert.ok(hasHead(page(), "LIVE MODE"));
});

test("test_the_live_mode_card_carries_the_pages_lede", async () => {
  await resetPage();
  assert.ok(card(page(), "LIVE MODE").includes("writes to the engine when you select it"));
});

test("test_every_saved_preset_is_offered_by_name", async () => {
  await resetPage({ presets: BOTH() });
  const labels = options(card(page(), "LIVE MODE")).map((o) => o.text);
  assert.deepEqual(
    ["Living Room", "Bedroom"].filter((n) => labels.some((t) => t.includes(n))),
    ["Living Room", "Bedroom"],
  );
});

// Stated positively — "the pickable ones are BOTH of them", not "none is
// disabled" — so a card that dropped a preset from the picker altogether fails
// here instead of passing on an empty list.
/** @param {string} frag */
const pickable = (frag) =>
  NAMED(frag)
    .filter((o) => !/\bdisabled/.test(o.tag))
    .map((o) => o.text)
    .sort();

test("test_both_saved_presets_can_be_picked_while_the_engine_runs_pcm", async () => {
  await resetPage({ chain: "pcm", presets: BOTH() });
  assert.deepEqual(pickable(card(page(), "LIVE MODE")), ["Bedroom", "Living Room"]);
});

test("test_both_saved_presets_can_be_picked_while_the_engine_runs_sdm", async () => {
  await resetPage({ chain: "sdm", presets: BOTH() });
  assert.deepEqual(pickable(card(page(), "LIVE MODE")), ["Bedroom", "Living Room"]);
});

test("test_every_saved_preset_is_offered_by_name_alone", async () => {
  // No reason, no chain tag, no "(SDM)" — nothing beside the name, for either
  // preset, because neither is second-class now.
  // Sorted on both sides: the picker's ORDER is not a spec'd behaviour, so it
  // is not what this case is here to pin.
  await resetPage({ presets: BOTH() });
  assert.deepEqual(
    NAMED(card(page(), "LIVE MODE"))
      .map((o) => o.text)
      .sort(),
    ["Bedroom", "Living Room"],
  );
});

test("test_an_empty_preset_store_says_so_in_the_picker", async () => {
  // In the PICKER, not merely somewhere on the card: the line has to be what the
  // dropdown offers, or a card that printed it as a paragraph beside an empty
  // select would pass while the control said nothing.
  await resetPage({ presets: [] });
  assert.deepEqual(
    options(card(page(), "LIVE MODE")).map((o) => o.text),
    ["No live presets saved"],
  );
});

test("test_a_stocked_picker_opens_on_an_invitation_to_choose", async () => {
  await resetPage({ presets: BOTH() });
  assert.equal(options(card(page(), "LIVE MODE"))[0].text, "Select a preset…");
});

test("test_a_preset_failure_shows_on_the_card", async () => {
  await resetPage({ presets: BOTH(), error: "the preset store is not writable" });
  assert.ok(/class="live-error">the preset store is not writable</.test(card(page(), "LIVE MODE")));
});

// The last one is PARTIAL by construction: the spec says the card tells the
// user a preset stores the whole page, but quotes no copy for it. Only the
// claim is pinned, loosely enough to survive a rewording — the words asserted
// are the spec's own, and what the sentence actually says is a reading job,
// not a unit test's.

// What the user actually READS: markup out first, then entities in. Matching the
// raw fragment let class names, `title` attributes and the fixtures' own control
// tooltips — one of which is literally "Selects default output mode." — satisfy
// assertions about the card's prose.
/** @param {string} frag */
const prose = (frag) =>
  decode(frag.replace(/<[^<>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

// Sentence-scoped: every claim below has to be made by ONE sentence, or the
// card could satisfy it with two unrelated ones either side of a full stop.
/** @param {string} frag */
const sentences = (frag) => prose(frag).split(/[.!?]+/);
/**
 * @param {string} frag
 * @param {...RegExp} parts
 */
const claims = (frag, ...parts) => sentences(frag).some((s) => parts.every((re) => re.test(s)));

test("test_the_live_mode_card_says_a_preset_stores_the_page", async () => {
  await resetPage({ presets: BOTH() });
  const saves = /\b(saves?|saved|stores?|captur\w+|includ\w+|records?|remember\w*)/i;
  assert.ok(claims(card(page(), "LIVE MODE"), saves, /everything on this page/i));
});
