// Behavioral suite for store/livepresets.js — the LIVE page's own presets: the
// saved list and the four verbs (read / apply / save / delete) — plus the LIVE
// MODE card components/LiveView.js renders from them.
//
// A live preset is HQPTuner's, not the daemon's: it stores a batch of live
// settings keyed by form-field name, and it carries the OUTPUT MODE among them
// (`fields.mode`, one of auto / pcm / sdm). Applying one switches the engine to
// that mode before applying the rest, so there is no such thing as an
// incompatible preset: every saved preset is pickable, always, whatever chain
// the engine currently reports. The fixtures below straddle both chains for
// exactly that reason — a card that still gated on the running chain would gray
// one of them out and fail here.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The fake answers the real REST paths with the real shapes —
// GET /api/livepresets -> {presets}, PUT /api/livepresets/{name} -> the record,
// POST /api/livepresets/{name}/apply -> {live, stored}, DELETE -> {deleted} —
// and it HOLDS the list the way the backend does, so "a save re-reads the list"
// is observable as the list having moved. No store function is ever stubbed.
//
// Not observable here, deliberately: picking a preset from the dropdown,
// clicking Save or Delete, and the name prompt / overwrite / delete confirms.
// The suite renders server-side (preact-render-to-string), which never fires an
// event handler, and the module-private signals those handlers write are not
// widened to reach them (docs/testing.md, "Branches that cannot be reached").
// The store functions those clicks call ARE public, and are tested directly.
//
// Covered only as far as the mention, because the spec quotes no copy for them:
// the card naming live presets as distinct from the header's presets and the
// matrix profiles, and the two things it says about the output mode — that a
// save captures it and that an apply can switch it. The words matched are the
// spec's own; whether the sentences read well is a reading job, not a unit
// test's.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/livepresets.test.js

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
import {
  livePresets,
  livePresetsBusy,
  livePresetError,
  applyLivePreset,
  saveLivePreset,
  deleteLivePreset,
} from "../../hqptuner/static/store/livepresets.js";
import { ok, bad } from "./wire.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// A saved record as /api/livepresets serves it: `fields` is the batch that gets
// applied, keyed by form-field name and carrying the output mode it was
// captured under; `names` is display only.
const rec = (name, chain) => ({
  name,
  chain,
  fields: { mode: chain, filter1x: "40", rate: "0" },
  names: { mode: chain.toUpperCase(), filter1x: "poly-sinc-gauss-long" },
});

// The engine's own answer for /api/state: `active_chain` is "pcm", "sdm" or
// null (nothing loaded yet).
const STATE = (chain, rate = "1") => ({
  mode: "1",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate,
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

// PUT and DELETE move the list the fake HOLDS, the way the backend's store
// does, so a following GET answers differently — the only way "a save re-reads
// the list" can be told apart from a save that quietly kept the old one.
function storeSave(w, c, name) {
  if (c.saveStatus !== 200) return bad(c.saveStatus, c.saveDetail);
  const saved = rec(name, c.chain);
  w.presets = [...w.presets.filter((p) => p.name !== name), saved];
  return ok(saved);
}

function storeDelete(w, name) {
  w.presets = w.presets.filter((p) => p.name !== name);
  return ok({ deleted: name });
}

// /api/livepresets/{name} and its /apply sub-path.
function onePreset(w, c, name, isApply, method) {
  if (isApply) return c.applyStatus === 200 ? ok(c.report) : bad(c.applyStatus, c.applyDetail);
  if (method === "PUT") return storeSave(w, c, name);
  if (method === "DELETE") return storeDelete(w, name);
  return ok({});
}

// The endpoints a preset lane may touch on either side of its own: the engine's
// state, and the three trees the page reads. Each answers its real shape, so a
// lane that re-mirrors gets something it can adopt rather than a bare {}.
function ambient(path, c) {
  // the whole frame the daemon lane serves, not just its payload: a lane reading
  // `stale` must see the real field rather than undefined (docs/testing.md rule 4)
  if (path === "/api/state") return ok({ stale: false, loaded_at: 1, data: c.mirrored || STATE(c.chain) });
  if (path === "/api/enumerations") return ok({ data: ENUMS });
  if (path === "/api/config") return ok({ data: { fields: [], file: {}, active: "", profiles: null } });
  if (path === "/api/matrix") return ok({ data: { fields: [] } });
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  return ok({});
}

const ONE = /^\/api\/livepresets\/([^/]+)(\/apply)?$/;

function presetWire(cfg = {}) {
  const c = { presets: [], chain: "pcm", listStatus: 200, saveStatus: 200, applyStatus: 200, ...cfg };
  c.report = cfg.report || { live: [], stored: {} };
  const w = { calls: [], presets: [...c.presets] };
  globalThis.fetch = async (path, opts = {}) => {
    const method = opts.method || "GET";
    w.calls.push({ path, method, body: opts.body });
    if (path === "/api/livepresets") {
      return c.listStatus === 200 ? ok({ presets: w.presets }) : bad(c.listStatus, c.listDetail);
    }
    const one = ONE.exec(path);
    return one ? onePreset(w, c, decodeURIComponent(one[1]), Boolean(one[2]), method) : ambient(path, c);
  };
  return w;
}

// Module-level signals outlive a test, so every one this file touches is
// reassigned in every case; a partial reset makes cases pass alone and fail in
// sequence.
function reset({ state, ...wire } = {}) {
  engineState.value = state === undefined ? STATE("pcm") : state;
  livePresets.value = null;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  liveMode.value = false;
  return presetWire(wire);
}

// The fake resolves without timers, so the whole read -> json -> signal chain
// settles in a handful of microtask ticks. No wall clock is waited on
// (docs/testing.md rule 7): a lane that never fired fails here immediately
// rather than hanging.
async function settle(ticks = 50) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

// --- the list -----------------------------------------------------------------

// FIRST, deliberately: "not looked yet" is the signal's state before anything in
// this file has read, and no later case can restore it honestly — a reset that
// wrote null would only assert the test's own write back at itself.
test("test_the_preset_list_is_unknown_before_the_first_read", () => {
  assert.equal(livePresets.value, null);
});

test("test_turning_live_mode_on_reads_the_saved_presets", async () => {
  reset({ presets: [rec("Living Room", "pcm")] });
  liveMode.value = true;
  await settle();
  assert.deepEqual(
    (livePresets.value || []).map((p) => p.name),
    ["Living Room"],
  );
});

test("test_a_failed_read_leaves_the_list_empty", async () => {
  reset({ listStatus: 500, listDetail: "the preset store is unreadable" });
  liveMode.value = true;
  await settle();
  assert.deepEqual(livePresets.value, []);
});

test("test_a_failed_read_reports_its_reason", async () => {
  reset({ listStatus: 500, listDetail: "the preset store is unreadable" });
  liveMode.value = true;
  await settle();
  assert.ok(livePresetError.value.includes("the preset store is unreadable"));
});

// --- applying -----------------------------------------------------------------

test("test_applying_a_preset_posts_to_its_apply_endpoint", async () => {
  const w = reset({ presets: [rec("Den", "pcm")] });
  await applyLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Den/apply" && c.method === "POST").length, 1);
});

test("test_applying_a_preset_whose_name_has_a_space_escapes_the_path", async () => {
  const w = reset({ presets: [rec("Living Room", "pcm")] });
  await applyLivePreset("Living Room");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Living%20Room/apply").length, 1);
});

test("test_a_refused_apply_carries_the_engines_own_reason", async () => {
  // 409's detail is a per-field object; the fetch wrapper flattens its values
  // into one sentence, so the reason — not the object — is what surfaces.
  reset({
    presets: [rec("Den", "pcm")],
    applyStatus: 409,
    applyDetail: { filter1x: "the pcm chain is not loaded (engine chain: sdm)" },
  });
  await applyLivePreset("Den");
  assert.ok(livePresetError.value.includes("the pcm chain is not loaded (engine chain: sdm)"));
});

test("test_a_setting_that_did_not_verify_is_reported_after_a_successful_apply", async () => {
  // A 200 can still carry a failure: result="OK" is not proof, so every live
  // write is verified by reading the state back (protocol.md §4).
  reset({
    presets: [rec("Den", "pcm")],
    report: {
      live: [
        { setting: "filter1x", ok: true },
        { setting: "rate", ok: false, error: "SetRate did not take" },
      ],
      stored: {},
    },
  });
  await applyLivePreset("Den");
  assert.ok(livePresetError.value.includes("SetRate did not take"));
});

test("test_an_apply_whose_settings_all_verified_reports_nothing", async () => {
  // Seeded with a standing complaint, so this pins the error being CLEARED
  // rather than never written: an empty signal is also what the reset wrote, and
  // a lane that only ever appends failures would leave last time's sentence on
  // the card under a write that just succeeded.
  reset({
    presets: [rec("Den", "pcm")],
    report: { live: [{ setting: "filter1x", ok: true }], stored: {} },
  });
  livePresetError.value = "SetRate did not take";
  await applyLivePreset("Den");
  assert.equal(livePresetError.value, "");
});

test("test_a_successful_apply_re_reads_the_engines_state", async () => {
  // A live write never reaches the config file, so /api/state is the only place
  // the new values appear. Asserting the state SIGNAL moved, not just that the
  // call went out: a lane that fetched and dropped the answer would show the
  // user stale values.
  reset({
    presets: [rec("Den", "pcm")],
    report: { live: [{ setting: "rate", ok: true }], stored: {} },
    mirrored: STATE("pcm", "2"),
  });
  await applyLivePreset("Den");
  assert.equal(engineState.value.rate, "2");
});

test("test_a_refused_apply_does_not_re_read_the_engines_state", async () => {
  const w = reset({
    presets: [rec("Den", "pcm")],
    applyStatus: 409,
    applyDetail: { filter1x: "the pcm chain is not loaded (engine chain: sdm)" },
  });
  await applyLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/state").length, 0);
});

// The mark is what the card's "working…" reads, so it has to be pinned in both
// directions: SET while the call is out, and released after. Asserting only the
// release would pass on a lane that never touched the signal at all — the reset
// already wrote the empty string the release leaves behind.
test("test_a_preset_in_flight_is_marked_busy_by_name", async () => {
  reset({ presets: [rec("Den", "pcm")] });
  const applying = applyLivePreset("Den");
  const marked = livePresetsBusy.value;
  await applying;
  assert.equal(marked, "Den");
});

test("test_a_settled_apply_releases_the_busy_mark", async () => {
  reset({ presets: [rec("Den", "pcm")] });
  livePresetsBusy.value = "Den";
  await applyLivePreset("Den");
  assert.equal(livePresetsBusy.value, "");
});

test("test_a_refused_apply_releases_the_busy_mark_too", async () => {
  reset({
    presets: [rec("Den", "pcm")],
    applyStatus: 409,
    applyDetail: { filter1x: "the pcm chain is not loaded (engine chain: sdm)" },
  });
  livePresetsBusy.value = "Den";
  await applyLivePreset("Den");
  assert.equal(livePresetsBusy.value, "");
});

// --- saving and deleting --------------------------------------------------------

test("test_saving_a_preset_puts_to_its_endpoint", async () => {
  const w = reset();
  await saveLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Den" && c.method === "PUT").length, 1);
});

test("test_a_save_sends_no_request_body", async () => {
  // The backend snapshots the running engine itself; a body would be the
  // frontend's idea of the settings instead of the engine's.
  const w = reset();
  await saveLivePreset("Den");
  assert.equal(w.calls.find((c) => c.method === "PUT").body, undefined);
});

test("test_a_save_re_reads_the_preset_list", async () => {
  reset({ presets: [rec("Living Room", "pcm")] });
  await saveLivePreset("Den");
  assert.deepEqual(
    (livePresets.value || []).map((p) => p.name),
    ["Living Room", "Den"],
  );
});

test("test_a_failed_save_reports_its_reason", async () => {
  reset({ saveStatus: 500, saveDetail: "the preset store is not writable" });
  await saveLivePreset("Den");
  assert.ok(livePresetError.value.includes("the preset store is not writable"));
});

test("test_deleting_a_preset_sends_a_delete_to_its_endpoint", async () => {
  const w = reset({ presets: [rec("Den", "pcm")] });
  await deleteLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Den" && c.method === "DELETE").length, 1);
});

test("test_a_delete_re_reads_the_preset_list", async () => {
  reset({ presets: [rec("Living Room", "pcm"), rec("Den", "pcm")] });
  await deleteLivePreset("Den");
  assert.deepEqual(
    (livePresets.value || []).map((p) => p.name),
    ["Living Room"],
  );
});

// --- the LIVE MODE card ----------------------------------------------------------

const ENUMS = {
  filters: [
    { index: "0", value: "0", name: "none" },
    { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  ],
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: "PCM" },
};

// settings.json's per-control label and tooltip, plus the name-keyed overlays:
// same SHAPE as the shipped prose, cut to a sentence each.
const METADATA = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      junk_filter: { label: "High-frequency filter", tooltip: "Playback filters for noise.", options: { 0: "None." } },
    },
    dsp: {
      filter_1x: { label: "1x filter", tooltip: "Oversampling filter for base-rate sources." },
      filter_nx: { label: "Nx filter", tooltip: "Oversampling filter above the base rates." },
      shaper: { label: "Dither", tooltip: "Noise shaping applied at the output word length." },
    },
    volume: { adaptive_volume: { label: "Adaptive volume", tooltip: "Applies the source's ReplayGain 2.0 offset." } },
  },
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
};

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

test("test_a_preset_call_in_flight_says_so_on_the_card", async () => {
  await resetPage({ presets: BOTH(), busy: "Living Room" });
  assert.ok(card(page(), "LIVE MODE").includes("working…"));
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
