// Behavioral suite for hqptuner/static/store/faceplate/drawers/speakers.js: the Speakers drawer's own form. Its edits
// (the switch, each channel's level and distance) are held over the daemon's /speakers form, read back as the staged
// form and whether it differs from the daemon's, applied through the form's own POST and dropped by a discard. The
// speaker set is a view choice that never stages, and the levels are dead while the running Direct SDM is on.
//
// The wire is the seam: each case writes the daemon's /speakers form into `speakers` and the running direct_sdm into
// `config`; an apply rides the real `POST /api/speakers`, answered by a fake that records the body and echoes a form.
// The draft is reset through `discardDraft` and the set through `pickSpeakerSet` on every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-speakers.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { config, staged as stagedBuffer } from "../../../../hqptuner/static/store/signals.js";
import { speakers } from "../../../../hqptuner/static/store/matrix/speakers.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import {
  SETS,
  applyDraft,
  discardDraft,
  levelsDead,
  pickSpeakerSet,
  setChannelDistance,
  setChannelLevel,
  setSpeakersGate,
  speakerDraft,
  staged,
} from "../../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

const LABELS = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];
const DISTANCES = [287, 301, 280, 330, 240, 241, 210, 211];
const LEVELS = [0, -0.5, 0, -2, 0, 0, -1, 0];

/**
 * The daemon's /speakers form as the server parses it, with its switch.
 *
 * @param {boolean} enabled
 * @param {number[]} [distances]
 */
const form = (enabled, distances = DISTANCES) => ({
  enabled,
  channels: LABELS.map((label, index) => ({
    index,
    label,
    level: LEVELS[index],
    distance: distances[index],
    level_min: -60,
    level_max: 0,
    level_step: 0.1,
    distance_min: 0,
    distance_max: 5000,
  })),
});

/** The first and last of the sets, which list different channels. */
const FIRST = SETS[0];
const LAST = SETS[SETS.length - 1];

/**
 * @param {{ enabled?: boolean, direct?: boolean, loaded?: boolean }} [s]
 */
async function reset({ enabled = false, direct = false, loaded = true } = {}) {
  stagingWire();
  speakers.value = loaded ? form(enabled) : null;
  config.value = { fields: [{ name: "direct_sdm", value: direct }], file: {} };
  await discardAll();
  discardDraft();
  pickSpeakerSet(FIRST.id);
}

/**
 * A wire answering the speakers POST with `applied` and the form after it; returns the bodies it was handed.
 *
 * @param {boolean} applied
 * @param {ReturnType<typeof form>} after
 */
function speakersWire(applied, after) {
  return stagingWire({
    routes: (path, opts, w) => {
      if (path !== "/api/speakers" || opts.method !== "POST") return undefined;
      w.posts.push(JSON.parse(String(opts.body)));
      return ok({ report: { applied, speakers: after } });
    },
  });
}

const distances = () => speakerDraft().channels.map((c) => c.distance);
const levels = () => speakerDraft().channels.map((c) => c.level);

// --- the draft over the daemon's form ----------------------------------------------------------------------------

test("test_the_draft_reads_the_daemons_form_until_the_form_is_loaded", async () => {
  await reset({ loaded: false });
  const before = speakerDraft().loaded;
  speakers.value = form(false);
  assert.deepEqual([before, speakerDraft().loaded], [false, true]);
});

test("test_an_unedited_draft_carries_the_daemons_distances", async () => {
  await reset();
  assert.deepEqual(distances(), DISTANCES);
});

test("test_an_unedited_draft_carries_the_daemons_levels", async () => {
  await reset();
  assert.deepEqual(levels(), LEVELS);
});

test("test_an_edited_distance_lands_on_its_own_channel_only", async () => {
  await reset();
  setChannelDistance(1, "350");
  assert.deepEqual(distances(), [287, 350, 280, 330, 240, 241, 210, 211]);
});

test("test_an_edited_level_lands_on_its_own_channel_only", async () => {
  await reset();
  setChannelLevel(3, -6.5);
  assert.deepEqual(levels(), [0, -0.5, 0, -6.5, 0, 0, -1, 0]);
});

test("test_an_edit_makes_the_draft_differ_from_the_daemons_form", async () => {
  await reset();
  const before = speakerDraft().differs;
  setChannelDistance(1, "350");
  assert.deepEqual([before, speakerDraft().differs], [false, true]);
});

test("test_an_edit_back_to_the_daemons_value_no_longer_differs", async () => {
  await reset();
  setChannelDistance(1, "350");
  const edited = speakerDraft().differs;
  setChannelDistance(1, "301");
  assert.deepEqual([edited, speakerDraft().differs], [true, false]);
});

test("test_an_emptied_box_falls_back_to_the_daemons_value", async () => {
  await reset();
  setChannelDistance(1, "350");
  setChannelDistance(1, "");
  assert.equal(speakerDraft().channels[1]?.distance, 301);
});

test("test_a_box_holding_no_number_falls_back_to_the_daemons_value", async () => {
  await reset();
  setChannelLevel(1, "-3");
  setChannelLevel(1, "abc");
  assert.equal(speakerDraft().channels[1]?.level, -0.5);
});

test("test_the_draft_switch_follows_the_daemons_until_flipped", async () => {
  await reset({ enabled: true });
  const before = speakerDraft().enabled;
  setSpeakersGate(false);
  assert.deepEqual([before, speakerDraft().enabled], [true, false]);
});

test("test_a_flipped_switch_differs_and_flipping_it_back_does_not", async () => {
  await reset();
  setSpeakersGate(true);
  const flipped = speakerDraft().differs;
  setSpeakersGate(false);
  assert.deepEqual([flipped, speakerDraft().differs], [true, false]);
});

test("test_staged_reads_whether_the_draft_differs", async () => {
  await reset();
  const before = staged.value;
  setChannelLevel(0, "-1");
  assert.deepEqual([before, staged.value], [false, true]);
});

// --- the speaker set ---------------------------------------------------------------------------------------------

test("test_the_picked_set_names_the_channels_shown", async () => {
  await reset();
  const first = speakerDraft().shown;
  pickSpeakerSet(LAST.id);
  assert.deepEqual([first, speakerDraft().shown], [FIRST.channels, LAST.channels]);
});

test("test_a_set_outside_the_list_is_turned_away", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  pickSpeakerSet("no such set");
  assert.deepEqual(speakerDraft().shown, LAST.channels);
});

test("test_picking_a_set_never_stages", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  const picked = speakerDraft().differs;
  setChannelDistance(7, "500");
  assert.deepEqual([picked, speakerDraft().differs], [false, true]);
});

// --- discard -----------------------------------------------------------------------------------------------------

test("test_a_discard_puts_back_every_edited_distance", async () => {
  await reset();
  setChannelDistance(1, "350");
  setChannelDistance(6, "400");
  discardDraft();
  assert.deepEqual(distances(), DISTANCES);
});

test("test_a_discard_puts_back_the_switch", async () => {
  await reset({ enabled: true });
  setSpeakersGate(false);
  discardDraft();
  assert.equal(speakerDraft().enabled, true);
});

test("test_a_discard_keeps_the_picked_set", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  discardDraft();
  assert.deepEqual(speakerDraft().shown, LAST.channels);
});

// --- apply -------------------------------------------------------------------------------------------------------

test("test_an_apply_sends_the_switch_and_only_the_edited_fields", async () => {
  await reset();
  const w = speakersWire(true, form(true));
  setSpeakersGate(true);
  setChannelDistance(1, 350);
  setChannelLevel(4, "-2.5");
  await applyDraft();
  await quiesce(w);
  assert.deepEqual(w.posts, [{ enabled: true, channels: { 1: { distance: "350" }, 4: { level: "-2.5" } } }]);
});

test("test_an_apply_with_nothing_staged_sends_nothing", async () => {
  await reset();
  const w = speakersWire(true, form(false));
  await applyDraft();
  setChannelDistance(1, "350");
  await applyDraft();
  await quiesce(w);
  assert.equal(w.posts.length, 1);
});

test("test_a_confirmed_apply_leaves_the_draft_on_the_daemons_new_form", async () => {
  await reset();
  const after = [287, 350, 280, 330, 240, 241, 210, 211];
  speakersWire(true, form(false, after));
  setChannelDistance(1, "350");
  setChannelDistance(2, "260");
  await applyDraft();
  assert.deepEqual(distances(), after);
});

test("test_a_confirmed_apply_answers_true_and_an_unconfirmed_one_false", async () => {
  await reset();
  speakersWire(true, form(false));
  setChannelDistance(1, "350");
  const confirmed = await applyDraft();
  speakersWire(false, form(false));
  setChannelDistance(1, "360");
  assert.deepEqual([confirmed, await applyDraft()], [true, false]);
});

test("test_an_unconfirmed_apply_keeps_the_draft", async () => {
  await reset();
  speakersWire(false, form(false));
  setChannelDistance(1, "350");
  await applyDraft();
  assert.equal(speakerDraft().channels[1]?.distance, 350);
});

// --- levels under Direct SDM -------------------------------------------------------------------------------------

test("test_the_levels_are_dead_while_the_running_direct_sdm_is_on", async () => {
  await reset();
  const off = levelsDead();
  await reset({ direct: true });
  assert.deepEqual([off, levelsDead()], [false, true]);
});

test("test_a_staged_direct_sdm_leaves_the_levels_live_until_it_runs", async () => {
  await reset();
  stagedBuffer.value = { live: {}, http: { direct_sdm: true } };
  const stagedOnly = levelsDead();
  await reset({ direct: true });
  assert.deepEqual([stagedOnly, levelsDead()], [false, true]);
});
