// Behavioral suite for the DSP tab's SPEAKERS half: the mode switcher
// (store/dspmode.js), the speaker card's rendered contract
// (components/SpeakersCard.js), and the apply lane (store/speakers.js).
//
// Policy (docs/testing.md): public API only, one assertion per test. The card's
// sub-components (ChannelRow, Body) are private and stay that way — every case
// renders the exported `SpeakersCard` or the whole `MatrixTab`, driven by
// exported signals. `edits` has no public writer (it is filled by typing in a
// channel box, which SSR cannot do), so the per-channel overlay is covered
// where it IS public: applySpeakers, against a faked wire.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/speakers.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../hqptuner/static/components/MatrixTab.js";
import { SpeakersCard, chooseSet } from "../../hqptuner/static/components/SpeakersCard.js";
import { speakers, applySpeakers } from "../../hqptuner/static/store/speakers.js";
import { dspMode, setDspMode } from "../../hqptuner/static/store/dspmode.js";
import { config, matrixConfig, effective, discardAll } from "../../hqptuner/static/store/state.js";
import { showDescriptions } from "../../hqptuner/static/store/prefs.js";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

// A staging server, not a stub of our own store: it holds the pending buffer the
// way the backend does and echoes it back, so `edit` rides the real REST path
// (docs/testing.md rule 4). POST bodies are captured for the apply cases.
let stagedBuf = { live: {}, http: {} };
let posts = [];

function wire() {
  stagedBuf = { live: {}, http: {} };
  posts = [];
  globalThis.fetch = async (path, opts = {}) => {
    if (path === "/api/config/stage") {
      const body = JSON.parse(opts.body);
      stagedBuf = { live: { ...stagedBuf.live, ...body.live }, http: { ...stagedBuf.http, ...body.http } };
      return ok(stagedBuf);
    }
    if (path === "/api/config/pending" && opts.method === "DELETE") {
      stagedBuf = { live: {}, http: {} };
      return ok(stagedBuf);
    }
    if (path === "/api/config/pending") return ok(stagedBuf);
    if (path === "/api/speakers" && opts.method === "POST") {
      posts.push(JSON.parse(opts.body));
      return ok({ applied: true, speakers: SPK });
    }
    return ok({});
  };
}

// A placed speaker: distance is what puts it in the room, and a channel with no
// distance is not drawn at all (see the unplaced case below).
const CH = (index, label) => ({
  index,
  label,
  level: 0,
  distance: 300,
  level_min: -60,
  level_max: 0,
  level_step: 0.1,
  distance_min: 0,
  distance_max: 5000,
});

const NAMES = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];
const SPK = { enabled: false, channels: NAMES.map((n, i) => CH(i, n)) };

// Full reset every time — every signal here outlives a test.
async function reset({ mode = "speakers", set = "2.0", sdm = false, spk = SPK, crossfeed = "1" } = {}) {
  wire();
  showDescriptions.value = false;
  speakers.value = spk;
  config.value = { fields: [{ name: "direct_sdm", value: sdm }], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [{ name: "post_bauer_enabled", value: crossfeed }], rows: [] };
  await discardAll();
  dspMode.value = mode;
  chooseSet(set);
}

const tab = () => render(html`<${MatrixTab} />`).replace(/&quot;/g, '"');
const card = () => render(html`<${SpeakersCard} />`).replace(/&quot;/g, '"');
const rows = (out) => [...out.matchAll(/<div class="spkr-row">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
const numbers = (row) => [...row.matchAll(/<input type="number"[^>]*>/g)].map((m) => m[0]);

// --- the switcher ------------------------------------------------------------

test("test_speakers_mode_shows_the_speaker_card", async () => {
  await reset({ mode: "speakers" });
  assert.match(tab(), /Speaker set/);
});

test("test_speakers_mode_hides_the_crossfeed_card", async () => {
  await reset({ mode: "speakers" });
  assert.doesNotMatch(tab(), /Crossfeed/);
});

test("test_headphones_mode_shows_the_crossfeed_card", async () => {
  await reset({ mode: "headphones" });
  assert.match(tab(), /Crossfeed/);
});

test("test_headphones_mode_hides_the_speaker_card", async () => {
  await reset({ mode: "headphones" });
  assert.doesNotMatch(tab(), /Speaker set/);
});

test("test_switching_to_speakers_stages_crossfeed_off", async () => {
  await reset({ mode: "headphones", crossfeed: "1" });
  await setDspMode("speakers");
  assert.equal(effective("crossfeed_enabled"), "0");
});

test("test_switching_back_to_headphones_does_not_turn_crossfeed_on", async () => {
  await reset({ mode: "headphones", crossfeed: "1" });
  await setDspMode("speakers");
  await setDspMode("headphones");
  assert.equal(effective("crossfeed_enabled"), "0");
});

// --- the speaker set ---------------------------------------------------------

test("test_stereo_set_renders_two_channel_rows", async () => {
  await reset({ set: "2.0" });
  assert.equal(rows(card()).length, 2);
});

test("test_seven_one_set_renders_eight_channel_rows", async () => {
  await reset({ set: "7.1" });
  assert.equal(rows(card()).length, 8);
});

test("test_a_channel_outside_the_set_is_drawn_dimmed", async () => {
  await reset({ set: "2.0" });
  assert.equal(card().match(/room-spk room-off/g).length, 6);
});

test("test_the_row_carries_the_daemons_own_channel_name", async () => {
  await reset({ set: "7.1" });
  assert.match(rows(card())[4], /Left rear/);
});

// --- Direct SDM --------------------------------------------------------------

test("test_direct_sdm_disables_the_level_box", async () => {
  await reset({ sdm: true });
  assert.match(numbers(rows(card())[0])[0], /\bdisabled\b/);
});

test("test_direct_sdm_leaves_the_distance_box_editable", async () => {
  await reset({ sdm: true });
  assert.doesNotMatch(numbers(rows(card())[0])[1], /\bdisabled\b/);
});

test("test_without_direct_sdm_the_level_box_is_editable", async () => {
  await reset({ sdm: false });
  assert.doesNotMatch(numbers(rows(card())[0])[0], /\bdisabled\b/);
});

// --- the apply lane ----------------------------------------------------------

test("test_apply_posts_the_enabled_switch", async () => {
  await reset();
  await applySpeakers(true, {});
  assert.equal(posts[0].enabled, true);
});

test("test_apply_posts_the_channel_overlay", async () => {
  await reset();
  await applySpeakers(true, { 0: { level: "-3" } });
  assert.deepEqual(posts[0].channels, { 0: { level: "-3" } });
});

test("test_apply_refreshes_the_card_from_the_daemons_answer", async () => {
  await reset({ spk: null });
  await applySpeakers(true, {});
  assert.equal(speakers.value.channels.length, 8);
});
