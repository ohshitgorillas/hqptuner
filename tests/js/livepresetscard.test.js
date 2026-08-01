// Behavioral suite for the LIVE MODE card components/LiveView.js renders from
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

import { html } from "../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../hqptuner/static/components/LiveView.js";
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
  discardAll,
} from "../../hqptuner/static/store/state.js";
import { liveErrors, liveBusy } from "../../hqptuner/static/store/live.js";
import { liveMode } from "../../hqptuner/static/store/prefs.js";
import { livePresets, livePresetsBusy, livePresetError } from "../../hqptuner/static/store/livepresets.js";
import { rec, STATE, ENUMS, METADATA, presetWire } from "./livepresetwire.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// Total reset for the rendered page: every source signal the LIVE page reads,
// plus the three this file's store owns. LIVE mode stays OFF so the list on
// screen is the one the case seeded, not one the wire re-served.
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
const head = (title) => new RegExp(`class="card-head[^"]*">(<span class="tri">.</span> )?${title}</(div|button)>`);

// One named card's own markup: from its section tag up to the next section. A
// miss throws rather than quietly measuring the whole page — a renamed head must
// fail loudly, not pass on some other card's text.
function card(out, title) {
  const at = out.search(head(title));
  if (at < 0) throw new Error(`no card headed "${title}" in the rendered page`);
  const from = out.lastIndexOf(MARK, at);
  if (from < 0) throw new Error(`the card headed "${title}" is not inside a section`);
  const next = out.indexOf(MARK, at);
  return out.slice(from, next < 0 ? undefined : next);
}

// SSR escapes entities; decode before asserting on what the user reads.
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const options = (frag) =>
  [...frag.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)].map((m) => ({ tag: m[0], text: decode(m[1]).trim() }));

// The two fixtures straddle the chains on purpose: one was captured under the
// mode the engine reports, one under the other. Neither is special any more.
const HERE = () => rec("Living Room", "pcm"); // captured under the running mode
const ELSEWHERE = () => rec("Bedroom", "sdm"); // captured under the other one
const BOTH = () => [HERE(), ELSEWHERE()];
const NAMED = (frag) => options(frag).filter((o) => BOTH().some((p) => o.text.includes(p.name)));

test("test_the_live_page_carries_a_live_mode_card", async () => {
  await resetPage();
  assert.ok(head("LIVE MODE").test(page()));
});

test("test_the_live_mode_card_carries_the_pages_lede", async () => {
  await resetPage();
  assert.ok(card(page(), "LIVE MODE").includes("Nothing on this page is saved"));
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

// The last three are PARTIAL by construction: the spec says the card tells the
// user a save captures the output mode and an apply can switch it, and sets live
// presets apart from the header's presets and the matrix profiles, but quotes no
// copy for any of them. Only the claim is pinned, loosely enough to survive a
// rewording — the words asserted are the spec's own, and what the sentences
// actually say is a reading job, not a unit test's.

// What the user actually READS: markup out first, then entities in. Matching the
// raw fragment let class names, `title` attributes and the fixtures' own control
// tooltips — one of which is literally "Selects default output mode." — satisfy
// assertions about the card's prose.
const prose = (frag) =>
  decode(frag.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

// Sentence-scoped: every claim below has to be made by ONE sentence, or the
// card could satisfy it with two unrelated ones either side of a full stop.
const sentences = (frag) => prose(frag).split(/[.!?]+/);
const claims = (frag, ...parts) => sentences(frag).some((s) => parts.every((re) => re.test(s)));

test("test_the_live_mode_card_says_a_preset_saves_the_output_mode", async () => {
  await resetPage({ presets: BOTH() });
  const saves = /\b(saves?|saved|stores?|captur\w+|includ\w+|records?|remember\w*)/i;
  assert.ok(claims(card(page(), "LIVE MODE"), saves, /output mode/i));
});

test("test_the_live_mode_card_says_applying_a_preset_can_switch_the_output_mode", async () => {
  // Three parts in one sentence, because two of them alone are the claim the
  // test above already pins: the sentence naming the saved settings mentions the
  // output mode too, and would otherwise satisfy this by itself. What is new
  // here is that USING a preset moves the mode.
  await resetPage({ presets: BOTH() });
  const using = /\b(appl\w+|pick\w*|select\w*|load\w*)/i;
  const moves = /\b(switch\w*|chang\w*|put\w*)/i;
  assert.ok(claims(card(page(), "LIVE MODE"), using, moves, /output mode/i));
});

test("test_the_live_mode_card_sets_live_presets_apart_from_the_other_two_kinds", async () => {
  // Both words tied to the thing they name, in a sentence: bare "header" and
  // "matrix" occur in class names and unrelated copy all over the page, so their
  // mere presence distinguishes nothing.
  await resetPage({ presets: BOTH() });
  const frag = card(page(), "LIVE MODE");
  assert.ok(claims(frag, /presets/i, /header/i) && claims(frag, /matrix profiles/i));
});
