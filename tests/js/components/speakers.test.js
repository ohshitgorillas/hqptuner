// Behavioral suite for the DSP tab's SPEAKERS half: the mode switcher
// (store/matrixmode.js), the speaker card's rendered contract
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

import { html } from "../../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../../hqptuner/static/components/MatrixTab.js";
import { SpeakersCard, chooseSet } from "../../../hqptuner/static/components/SpeakersCard.js";
import {
  speakers,
  speakersStale,
  speakersError,
  applySpeakers,
  loadSpeakers,
} from "../../../hqptuner/static/store/speakers.js";
import { matrixMode, setMatrixMode } from "../../../hqptuner/static/store/matrixmode.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { effective, effectivePipelines } from "../../../hqptuner/static/store/resolve.js";
import { stagePipelines, discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { msCompile, msRecognize, fitComp, BAUER_PRESETS } from "../../../hqptuner/static/lib/xfeed.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { structuralBlock } from "../../../hqptuner/static/lib/xfmode.js";
import { ok, bad, stagingWire } from "../support/wire.js";

const DEF = BAUER_PRESETS.default;
const EQ = "iir:type=peak;f=1000;q=1;g=-3";

// The two installed crossfeed shapes, built with the real compilers: eight
// compensation rows carrying the headphone EQ the way a real one does, or the
// sixteen rows of a structural block.
const compBlock = () => msCompile(EQ, -3, { fit: fitComp(DEF.fc, DEF.feed), s: 1 }, { a: 0, b: 1 });
const structuralRows = () =>
  compileRows({ lambda: 1, angle: 30, headRadius: HEAD_RADIUS, srcA: 0, srcB: 1, preampDb: -3, eqProcess: EQ });

// The staging wire plus /api/speakers, whose POST bodies the apply cases read.
let W;

function wire() {
  W = stagingWire({
    routes: (path, opts, w) => {
      if (path === "/api/speakers" && opts.method === "POST") {
        w.posts.push(JSON.parse(opts.body));
        return ok({ applied: true, speakers: SPK });
      }
      return undefined; // unhandled path: the wire's own fallback answers it
    },
  });
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
async function reset({ mode = "speakers", set = "2.0", sdm = false, spk = SPK, crossfeed = "1", pipes = null } = {}) {
  wire();
  showDescriptions.value = false;
  speakers.value = spk;
  config.value = {
    fields: [{ name: "direct_sdm", value: sdm }],
    file: pipes ? { matrix_pipelines: JSON.stringify(pipes) } : {},
    active: "",
    profiles: null,
  };
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: crossfeed },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: String(DEF.fc) },
      { name: "post_bauer_level", value: String(DEF.feed) },
    ],
    rows: [],
  };
  await discardAll();
  matrixMode.value = mode;
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
  await setMatrixMode("speakers");
  assert.equal(effective("crossfeed_enabled"), "0");
});

// Suppression is not a decision to abandon the setting: the user enabled
// crossfeed on the headphone side, and coming back to that side finds it as they
// left it. What the switch never took away, it never puts back.
test("test_switching_back_to_headphones_restores_the_crossfeed_it_suppressed", async () => {
  await reset({ mode: "headphones", crossfeed: "1" });
  await setMatrixMode("speakers");
  await setMatrixMode("headphones");
  assert.equal(effective("crossfeed_enabled"), "1");
});

test("test_switching_back_to_headphones_does_not_turn_an_off_crossfeed_on", async () => {
  await reset({ mode: "headphones", crossfeed: "0" });
  await setMatrixMode("speakers");
  await setMatrixMode("headphones");
  assert.equal(effective("crossfeed_enabled"), "0");
});

test("test_switching_back_to_headphones_restores_the_compensation_block", async () => {
  await reset({ mode: "headphones", crossfeed: "1", pipes: compBlock() });
  await setMatrixMode("speakers");
  await setMatrixMode("headphones");
  assert.ok(msRecognize(effectivePipelines.value, 0, DEF.fc, DEF.feed));
});

test("test_switching_back_to_headphones_restores_the_structural_block", async () => {
  await reset({ mode: "headphones", crossfeed: "0", pipes: structuralRows() });
  await setMatrixMode("speakers");
  await setMatrixMode("headphones");
  assert.ok(structuralBlock(effectivePipelines.value));
});

test("test_a_pipeline_edited_on_the_speaker_side_is_not_overwritten", async () => {
  await reset({ mode: "headphones", crossfeed: "1", pipes: compBlock() });
  await setMatrixMode("speakers");
  stagePipelines([{ gain: "0", gainunit: "dB", mixdown: "0", process: "", source: "0" }]);
  await setMatrixMode("headphones");
  assert.equal(effectivePipelines.value.length, 1);
});

// The flag is only half of Bauer. Its compensation block is eight matrix rows,
// and they went on correcting for a crossfeed that had just been switched off —
// with the headphone EQ profile trapped inside them.
test("test_switching_to_speakers_dismantles_the_compensation_block", async () => {
  await reset({ mode: "headphones", crossfeed: "1", pipes: compBlock() });
  await setMatrixMode("speakers");
  assert.equal(msRecognize(effectivePipelines.value, 0, DEF.fc, DEF.feed), null);
});

test("test_switching_to_speakers_keeps_the_eq_profile", async () => {
  await reset({ mode: "headphones", crossfeed: "1", pipes: compBlock() });
  await setMatrixMode("speakers");
  assert.ok(effectivePipelines.value.every((r) => r.process === EQ));
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
  assert.equal(W.posts[0].enabled, true);
});

test("test_apply_posts_the_channel_overlay", async () => {
  await reset();
  await applySpeakers(true, { 0: { level: "-3" } });
  assert.deepEqual(W.posts[0].channels, { 0: { level: "-3" } });
});

test("test_apply_refreshes_the_card_from_the_daemons_answer", async () => {
  await reset({ spk: null });
  await applySpeakers(true, {});
  assert.equal(speakers.value.channels.length, 8);
});

// --- what a refused apply says -----------------------------------------------
// The apply lane is this tab's one public error signal, so it is where the two
// halves of the REST error contract are exercised: a refusal carrying the
// daemon's own sentence reaches the user verbatim, and a refusal carrying no
// sentence still tells them the status. What the fallback wording IS belongs to
// lib/api.js, not to this suite — the claim here is only that the code survives.

function refuse(answer) {
  stagingWire({
    routes: (path, opts) => (path === "/api/speakers" && opts.method === "POST" ? answer : undefined),
  });
}

test("test_a_refused_apply_reports_the_daemons_own_reason", async () => {
  await reset();
  refuse(bad(502, "speakers apply failed: engine did not answer"));
  await applySpeakers(true, {});
  assert.equal(speakersError.value, "speakers apply failed: engine did not answer");
});

test("test_a_refusal_with_no_reason_still_reports_the_status", async () => {
  await reset();
  refuse(bad(502));
  await applySpeakers(true, {});
  assert.match(speakersError.value, /502/);
});

// --- the read lane -------------------------------------------------------------
// /api/speakers answers the backend's snapshot wrapper {stale, loaded_at, data}.

function serve(answer) {
  stagingWire({ routes: (path, opts) => (path === "/api/speakers" && !opts.method ? answer : undefined) });
}

test("test_load_mirrors_the_daemons_speaker_form", async () => {
  await reset({ spk: null });
  serve(ok({ stale: false, loaded_at: 1, data: SPK }));
  await loadSpeakers();
  assert.equal(speakers.value.channels.length, 8);
});

test("test_load_mirrors_the_stale_flag", async () => {
  await reset();
  serve(ok({ stale: true, loaded_at: 1, data: SPK }));
  await loadSpeakers();
  assert.equal(speakersStale.value, true);
});

test("test_a_successful_load_clears_a_prior_error", async () => {
  await reset();
  speakersError.value = "old failure";
  serve(ok({ stale: false, loaded_at: 1, data: SPK }));
  await loadSpeakers();
  assert.equal(speakersError.value, "");
});

test("test_a_refused_load_reports_the_daemons_own_reason", async () => {
  await reset();
  serve(bad(503, "/speakers form not loaded yet"));
  await loadSpeakers();
  assert.equal(speakersError.value, "/speakers form not loaded yet");
});
