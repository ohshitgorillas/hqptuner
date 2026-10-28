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

import { config } from "../../../../hqptuner/static/store/signals.js";
import { loadSpeakers } from "../../../../hqptuner/static/store/matrix/speakers.js";
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
  const served = loaded ? form(enabled) : null;
  stagingWire({ routes: (path) => (path === "/api/speakers" ? ok({ data: served }) : undefined) });
  await loadSpeakers();
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
      if (path !== "/api/speakers") return undefined;
      if (opts.method !== "POST") return ok({ data: after });
      w.posts.push(JSON.parse(String(opts.body)));
      return ok({ report: { applied, speakers: after } });
    },
  });
}

const distances = () => speakerDraft().channels.map((c) => c.distance);
const levels = () => speakerDraft().channels.map((c) => c.level);

// --- the draft over the daemon's form ----------------------------------------------------------------------------

test("test_the_draft_is_not_loaded_while_the_daemons_form_is_absent", async () => {
  await reset({ loaded: false });
  assert.equal(speakerDraft().loaded, false);
});

test("test_the_draft_is_loaded_once_the_daemons_form_arrives", async () => {
  await reset({ loaded: false });
  speakerDraft(); // read while absent, so the arrival has to reach a draft already read
  stagingWire({ routes: (path) => (path === "/api/speakers" ? ok({ data: form(false) }) : undefined) });
  await loadSpeakers();
  assert.equal(speakerDraft().loaded, true);
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
  speakerDraft(); // read unedited, so the edit has to reach a draft already read
  setChannelDistance(1, "350");
  assert.equal(speakerDraft().differs, true);
});

test("test_an_edit_back_to_the_daemons_value_no_longer_differs", async () => {
  await reset();
  setChannelDistance(1, "350");
  speakerDraft(); // read while edited, so the edit back has to reach a draft already read
  setChannelDistance(1, "301");
  assert.equal(speakerDraft().differs, false);
});

for (const [field, typed, reported] of /** @type {["distance" | "level", string, number][]} */ ([
  ["distance", "350.0", 350],
  ["level", "-3.00", -3],
])) {
  // Break: comparing a numeric edit's spelling with readback text leaves an equal value dirty.
  test(`test_matching_numeric_readback_cleans_the_${field}_despite_its_spelling`, async () => {
    await reset();
    const channel = 1;
    const setValue = field === "distance" ? setChannelDistance : setChannelLevel;
    setValue(channel, typed);
    const differedBeforeReadback = speakerDraft().differs;
    const after = form(false);
    after.channels[channel][field] = reported;
    stagingWire({ routes: (path) => (path === "/api/speakers" ? ok({ data: after }) : undefined) });
    await loadSpeakers();
    assert.deepEqual([differedBeforeReadback, speakerDraft().differs], [true, false]);
  });
}

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

test("test_flipping_the_draft_switch_overrides_the_daemons", async () => {
  await reset({ enabled: true });
  speakerDraft(); // read unflipped, so the flip has to reach a draft already read
  setSpeakersGate(false);
  assert.equal(speakerDraft().enabled, false);
});

test("test_a_flipped_switch_differs_from_the_daemons_form", async () => {
  await reset();
  setSpeakersGate(true);
  assert.equal(speakerDraft().differs, true);
});

test("test_a_switch_flipped_back_no_longer_differs", async () => {
  await reset();
  setSpeakersGate(true);
  speakerDraft(); // read while flipped, so the flip back has to reach a draft already read
  setSpeakersGate(false);
  assert.equal(speakerDraft().differs, false);
});

test("test_staged_is_off_while_the_draft_matches_the_daemons_form", async () => {
  await reset();
  assert.equal(staged.value, false);
});

test("test_staged_is_on_once_the_draft_differs", async () => {
  await reset();
  staged.value; // read unedited, so the edit has to reach a staged flag already read
  setChannelLevel(0, "-1");
  assert.equal(staged.value, true);
});

// --- the speaker set ---------------------------------------------------------------------------------------------

test("test_picking_a_set_never_stages", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  assert.equal(speakerDraft().differs, false);
});

test("test_an_edit_after_picking_a_set_still_differs", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  speakerDraft(); // read after the pick, so the edit has to reach a draft already read
  setChannelDistance(7, "500");
  assert.equal(speakerDraft().differs, true);
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

for (const [name, applied, answer] of /** @type {[string, boolean, boolean][]} */ ([
  ["test_a_confirmed_apply_answers_true", true, true],
  ["test_an_unconfirmed_apply_answers_false", false, false],
])) {
  test(name, async () => {
    await reset();
    speakersWire(applied, form(false));
    setChannelDistance(1, "350");
    assert.equal(await applyDraft(), answer);
  });
}

test("test_an_unconfirmed_apply_keeps_the_draft", async () => {
  await reset();
  speakersWire(false, form(false));
  setChannelDistance(1, "350");
  await applyDraft();
  assert.equal(speakerDraft().channels[1]?.distance, 350);
});

for (const newerDistance of [375, 425]) {
  // Break: successful apply discards an edit entered after its submitted snapshot.
  test(`test_apply_readback_preserves_the_newer_distance_${newerDistance}`, async () => {
    await reset();
    const submittedDistance = 350;
    const after = form(false, [287, submittedDistance, 280, 330, 240, 241, 210, 211]);
    /** @type {(response: ReturnType<typeof ok>) => void} */
    let finish = () => {};
    const response = new Promise(
      /** @param {(response: ReturnType<typeof ok>) => void} resolve */ (resolve) => {
        finish = resolve;
      },
    );
    stagingWire({
      routes: (path, opts) => {
        if (path !== "/api/speakers") return undefined;
        return opts.method === "POST" ? response : ok({ data: after });
      },
    });
    setChannelDistance(1, submittedDistance);
    const applying = applyDraft();
    setChannelDistance(1, newerDistance);
    finish(ok({ report: { applied: true, speakers: after } }));
    await applying;
    assert.equal(speakerDraft().channels[1]?.distance, newerDistance);
  });
}

// --- levels under Direct SDM -------------------------------------------------------------------------------------

for (const [name, direct, dead] of /** @type {[string, boolean, boolean][]} */ ([
  ["test_the_levels_are_live_while_the_running_direct_sdm_is_off", false, false],
  ["test_the_levels_are_dead_while_the_running_direct_sdm_is_on", true, true],
])) {
  test(name, async () => {
    await reset({ direct });
    assert.equal(levelsDead(), dead);
  });
}
