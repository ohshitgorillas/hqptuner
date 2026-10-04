// Behavioral suite for hqptuner/static/store/faceplate/builders/profile.js: the Profile builder's store. Opening on the
// loaded station, the book of saved profiles, the values and answers the walk reads off the staged chain, which steps
// skip, when the edit reads dirty, the state line, switching between profiles and stashing an edit, starting from
// scratch, and what Save, Remove and Discard send.
//
// The wire is the seam: the /config form (the stations, the loaded one, Fixed volume) into `config`, the /api/matrix
// payload (the post-process selects, the pipeline rows, the stored and daemon-known profiles, which stations hold
// which, the live profile) into `matrixConfig`, the stored descriptions into `descriptions`. Staging rides
// `stagingWire`'s real /api/config/stage path; every request the store sends is recorded on `w.posts` in arrival order,
// so a save's sequence is observable as the requests it made. The record being edited and its stashed edits are the
// shell's `cur` and `staged` (./shell.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-builders/profile.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, engineState } from "../../../../hqptuner/static/store/signals.js";
import { effective, effectivePipelines } from "../../../../hqptuner/static/store/resolve.js";
import { edit, stagePipelines, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { descriptions } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { NEW, keyOf } from "../../../../hqptuner/static/model/builders/builder.js";
import { cur, staged, ask, refused } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { LISTEN, PB_STEPS, PROFILE_COPY } from "../../../../hqptuner/static/store/faceplate/builders/profile-data.js";
import {
  meta,
  page,
  openProfileBuilder,
  profileBook,
  valsNow,
  skip,
  answerOf,
  dirty,
  setDesc,
  setName,
  setStations,
  setListen,
  stateNow,
  switchTo,
  scratch,
  saveProfile,
  removeProfile,
  discardEdit,
} from "../../../../hqptuner/static/store/faceplate/builders/profile.js";
import { ROW, PROF } from "../../support/profile-fixtures.js";
import { stagingWire, ok, quiesce } from "../../support/wire/wire.js";

/** @typedef {import("../../support/profile-fixtures.js").PipelineRow} PipelineRow */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */
/** @typedef {import("../../support/wire/wire.js").FakeRequest} FakeRequest */
/** @typedef {{ at: string, body: unknown }} Sent  one request the store sent: "METHOD path" and its parsed body */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

const LOADED = "Day";
const STATIONS = [LOADED, "Night", "Spare"];

/** Three peak stages, as a pipeline's process carries them. */
const PEAKS = [
  "iir:type=peak;f=100.0;q=0.70;g=-3",
  "iir:type=peak;f=1000.0;q=1.00;g=2",
  "iir:type=peak;f=8000.0;q=2.00;g=-1",
].join(",");

/**
 * A straight stereo pair, In 1 to Out 1 and In 2 to Out 2, both rows on one gain and one process.
 *
 * @param {string} gain
 * @param {string} [process]
 * @returns {PipelineRow[]}
 */
const STEREO = (gain, process = "") => [
  { ...ROW(gain), process },
  { ...ROW(gain), process, source: "1", mixdown: "1" },
];

/** The Bauer presets the matrix form offers, each with the fixture's own label. */
const BAUER = [
  { value: "default", label: "fx-Default" },
  { value: "cmoy", label: "fx-Moy" },
  { value: "jmeier", label: "fx-Meier" },
  { value: "custom", label: "fx-Custom" },
];
/** The DAC models the matrix form offers: none, and two models. */
const MODELS = [
  { value: "", label: "" },
  { value: "fx-dac-a", label: "fx-dac-a" },
  { value: "fx-dac-b", label: "fx-dac-b" },
];

/** A stored profile engaging every part. */
const FLAT = () =>
  PROF(STEREO("-2", PEAKS), {
    post_bauer_enabled: "1",
    post_bauer_preset: "jmeier",
    post_correction_enabled: "1",
    post_correction_dac0: "fx-dac-b",
    post_loudness_enabled: "1",
    post_loudness_rangelow: "-50",
    post_loudness_rangehigh: "-20",
  });
/** A stored profile at the form's own values, the one the engine runs. */
const WARM = () =>
  PROF(STEREO("0"), {
    post_bauer_enabled: "0",
    post_bauer_preset: "cmoy",
    post_correction_enabled: "0",
    post_correction_dac0: "fx-dac-a",
    post_loudness_enabled: "0",
    post_loudness_rangelow: "-40",
    post_loudness_rangehigh: "-10",
  });

const FLAT_NOTE = "fixture flat note";

/**
 * A fresh /api/matrix payload.
 *
 * @param {{ models?: { value: string, label: string }[], live?: string[] }} [o]
 *   models: the DAC model select's options; live: the names the daemon knows
 */
const matrixTree = ({ models = MODELS, live = ["Warm"] } = {}) => ({
  fields: [
    { name: "post_bauer_enabled", value: "0", options: [] },
    { name: "post_bauer_preset", value: "cmoy", options: BAUER },
    { name: "post_correction_enabled", value: "0", options: [] },
    { name: "post_correction_dac0", value: "fx-dac-a", options: models },
    { name: "post_loudness_enabled", value: "0", options: [] },
    { name: "post_loudness_rangelow", value: "-40", options: [] },
    { name: "post_loudness_rangehigh", value: "-10", options: [] },
  ],
  rows: STEREO("0"),
  file_profiles: { Flat: FLAT(), Warm: WARM() },
  live_profiles: live,
  preset_profiles: { Day: ["Flat", "Warm"], Night: ["Warm"], Spare: ["Flat"] },
  live_active: "Warm",
});

/**
 * A fresh /config form: the stations, Day loaded, and Fixed volume.
 *
 * @param {{ fixed?: string }} [o]
 */
const configTree = ({ fixed = "0" } = {}) => ({
  fields: [{ name: "fixed_volume_enabled", value: fixed, options: [] }],
  file: {},
  profiles: { options: [{ value: "" }, ...STATIONS.map((value) => ({ value }))] },
  active: LOADED,
});

/**
 * The routes the builder's writes reach beyond staging.
 *
 * @param {string} path
 * @param {FakeRequest} opts
 */
const routes = (path, opts) => {
  if (path === "/api/config/apply") return ok({ report: {} });
  if (path === "/api/matrix/profile" && opts.method === "POST") {
    return ok({ active: JSON.parse(String(opts.body)).name });
  }
  if (path === "/api/descriptions" && opts.method === "PUT") return ok({ profiles: {} });
  return undefined;
};

/** @type {StagingWire} */
let w;

/** A staging wire whose every request lands on `w.posts` as a `Sent`, in arrival order. */
function wire() {
  w = stagingWire({ routes });
  const inner = /** @type {(path: string, opts?: FakeRequest) => Promise<unknown>} */ (env.fetch);
  env.fetch = (/** @type {string} */ path, /** @type {FakeRequest} */ opts = {}) => {
    w.posts.push({ at: `${opts.method ?? "GET"} ${path}`, body: opts.body ? JSON.parse(opts.body) : null });
    return inner(path, opts);
  };
}

beforeEach(async () => {
  wire();
  engineState.value = {};
  config.value = configTree();
  matrixConfig.value = matrixTree();
  descriptions.value = { Flat: { text: FLAT_NOTE, updated: "2026-01-01T00:00:00Z" } };
  await discardAll();
  staged.value = new Map();
  ask.value = null;
  refused.value = false;
  cur.value = { st: "", name: NEW };
  await openProfileBuilder();
  await quiesce(w);
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * Every request the store sent from index `from` on that writes something, as "METHOD path".
 *
 * @param {number} from
 * @returns {string[]}
 */
const writesFrom = (from) =>
  /** @type {Sent[]} */ (w.posts.slice(from)).map((p) => p.at).filter((at) => !at.startsWith("GET "));

/**
 * The parsed http-lane field `field` of the first stage request carrying it, from index `from` on.
 *
 * @param {number} from
 * @param {string} field
 * @returns {unknown}
 */
function stagedField(from, field) {
  const hit = /** @type {Sent[]} */ (w.posts.slice(from)).find(
    (p) =>
      p.at === "POST /api/config/stage" && /** @type {{ http?: Record<string, string> }} */ (p.body)?.http?.[field],
  );
  const http = /** @type {{ http: Record<string, string> } | undefined} */ (hit?.body)?.http;
  return http ? JSON.parse(http[field]) : null;
}

/**
 * Switch to a saved profile in the loaded station and let the wire settle.
 *
 * @param {string} name
 */
async function onSaved(name) {
  await switchTo({ st: LOADED, name });
  await quiesce(w);
}

/**
 * Stage one schema-key edit and let the wire settle.
 *
 * @param {string} key
 * @param {string} value
 */
async function staging(key, value) {
  await edit(key, value);
  await quiesce(w);
}

/**
 * Save a fresh name to the loaded station and Night with a description, and return the index the save's requests
 * start at.
 *
 * @returns {Promise<number>}
 */
async function freshSave() {
  await setName("Dusk");
  await setStations([LOADED, "Night"]);
  await setDesc("fx-dusk note");
  const from = w.posts.length;
  await saveProfile();
  await quiesce(w);
  return from;
}

/**
 * Remove the saved Flat and return the index the removal's requests start at.
 *
 * @returns {Promise<number>}
 */
async function removeFlat() {
  await onSaved("Flat");
  const from = w.posts.length;
  await removeProfile();
  await quiesce(w);
  return from;
}

/**
 * The sentence a step's own table gives for a context.
 *
 * @param {string} id
 * @param {{ listen?: string, fixed?: boolean, models?: number }} [x]
 * @returns {string}
 */
const sentence = (id, { listen = "speakers", fixed = false, models = 2 } = {}) =>
  PB_STEPS.find((s) => s.id === id)?.skip?.({ listen, fixed, models }) ?? "no-such-step";

/** @param {string} v */
const listenLabel = (v) => LISTEN.find((l) => l.v === v)?.label ?? "no-such-choice";

// --- opening ---------------------------------------------------------------------------------------

test("test_opening_edits_the_new_entry_of_the_loaded_station", () => {
  assert.deepEqual(cur.value, { st: LOADED, name: NEW });
});

test("test_opening_with_crossfeed_off_starts_an_unnamed_speakers_edit_in_the_loaded_station", () => {
  assert.deepEqual(meta.value, { name: "", stations: [LOADED], desc: "", listen: "speakers" });
});

test("test_opening_with_crossfeed_staged_engaged_listens_on_headphones", async () => {
  await staging("crossfeed_enabled", "1");
  await openProfileBuilder();
  assert.equal(meta.value.listen, "headphones");
});

test("test_opening_shows_the_overview", () => {
  assert.equal(page.value, "overview");
});

// --- the book --------------------------------------------------------------------------------------

test("test_the_book_keys_the_loaded_station_only", () => {
  assert.deepEqual(Object.keys(profileBook()), [LOADED]);
});

test("test_the_book_holds_a_stored_profiles_rows_and_post", () => {
  assert.deepEqual(profileBook()[LOADED]?.Flat, FLAT());
});

test("test_the_book_holds_null_for_a_name_only_the_daemon_knows", () => {
  matrixConfig.value = matrixTree({ live: ["Warm", "Echo"] });
  assert.equal(profileBook()[LOADED]?.Echo, null);
});

// --- the values now --------------------------------------------------------------------------------

test("test_the_values_name_every_part_of_the_chain", () => {
  assert.deepEqual(Object.keys(valsNow()).sort(), [
    "dcdac",
    "dcen",
    "ldon",
    "ldrhigh",
    "ldrlow",
    "xfmode",
    "xfpreset",
    "xsangle",
    "xslambda",
  ]);
});

test("test_crossfeed_reads_off_while_its_gate_is_0", () => {
  assert.equal(valsNow().xfmode, "off");
});

test("test_crossfeed_reads_bauer_with_its_gate_1_and_no_structural_block", async () => {
  await staging("crossfeed_enabled", "1");
  assert.equal(valsNow().xfmode, "bauer");
});

test("test_the_crossfeed_preset_reads_the_staged_preset", async () => {
  await staging("crossfeed_preset", "jmeier");
  assert.equal(valsNow().xfpreset, "jmeier");
});

test("test_dac_correction_reads_1_staged_engaged", async () => {
  await staging("dac_correction_enabled", "1");
  assert.equal(valsNow().dcen, "1");
});

test("test_dac_correction_reads_0_at_the_forms_bypass", () => {
  assert.equal(valsNow().dcen, "0");
});

test("test_the_dac_model_reads_the_staged_model", async () => {
  await staging("dac_correction_profile", "fx-dac-b");
  assert.equal(valsNow().dcdac, "fx-dac-b");
});

test("test_loudness_reads_1_staged_engaged", async () => {
  await staging("loudness_enabled", "1");
  assert.equal(valsNow().ldon, "1");
});

test("test_the_loudness_lower_bound_reads_the_form", () => {
  assert.equal(String(valsNow().ldrlow), "-40");
});

test("test_the_loudness_upper_bound_reads_the_form", () => {
  assert.equal(String(valsNow().ldrhigh), "-10");
});

// --- which steps skip ------------------------------------------------------------------------------

test("test_crossfeed_skips_for_speakers", () => {
  assert.equal(skip("crossfeed"), sentence("crossfeed", { listen: "speakers" }));
});

test("test_crossfeed_applies_for_headphones", async () => {
  await setListen("headphones");
  assert.equal(skip("crossfeed"), "");
});

test("test_dac_correction_applies_with_models_offered", () => {
  assert.equal(skip("correction"), "");
});

test("test_dac_correction_skips_with_no_model_offered", () => {
  matrixConfig.value = matrixTree({ models: [{ value: "", label: "" }] });
  assert.equal(skip("correction"), sentence("correction", { models: 0 }));
});

test("test_loudness_skips_while_fixed_volume_runs", () => {
  config.value = configTree({ fixed: "1" });
  assert.equal(skip("loudness"), sentence("loudness", { fixed: true }));
});

// --- the answers -----------------------------------------------------------------------------------

test("test_listening_answers_with_the_speakers_label", () => {
  assert.equal(answerOf("listen"), listenLabel("speakers"));
});

test("test_listening_answers_with_the_headphones_label", async () => {
  await setListen("headphones");
  assert.equal(answerOf("listen"), listenLabel("headphones"));
});

test("test_crossfeed_answers_off_while_off", () => {
  assert.equal(answerOf("crossfeed"), "Off");
});

test("test_crossfeed_answers_with_the_named_presets_label_while_engaged", async () => {
  await staging("crossfeed_enabled", "1");
  assert.equal(answerOf("crossfeed"), `Bauer · ${BAUER[1].label}`);
});

test("test_dac_correction_answers_bypassed_while_off", () => {
  assert.equal(answerOf("correction"), "Bypassed");
});

test("test_dac_correction_answers_with_the_model_while_engaged", async () => {
  await staging("dac_correction_enabled", "1");
  assert.equal(answerOf("correction"), "fx-dac-a");
});

test("test_loudness_answers_off_while_off", () => {
  assert.equal(answerOf("loudness"), "Off");
});

test("test_loudness_answers_with_what_applies_while_engaged", async () => {
  await staging("loudness_enabled", "1");
  assert.match(String(answerOf("loudness")), /% applied$/);
});

test("test_eq_answers_none_with_no_peak_stage", () => {
  assert.equal(answerOf("eq"), "None");
});

test("test_eq_answers_with_the_first_stereo_rows_peak_stage_count", async () => {
  await stagePipelines(STEREO("0", PEAKS));
  await quiesce(w);
  assert.equal(answerOf("eq"), "3 bands");
});

// --- dirty -----------------------------------------------------------------------------------------

test("test_an_edit_just_opened_is_clean", () => {
  assert.equal(dirty(), false);
});

test("test_a_typed_description_reads_dirty", async () => {
  await setDesc("x");
  assert.equal(dirty(), true);
});

test("test_a_typed_name_reads_dirty", async () => {
  await setName("x");
  assert.equal(dirty(), true);
});

test("test_a_ticked_station_reads_dirty", async () => {
  await setStations([LOADED, "Night"]);
  assert.equal(dirty(), true);
});

test("test_a_changed_listening_reads_dirty", async () => {
  await setListen("headphones");
  assert.equal(dirty(), true);
});

test("test_a_staged_crossfeed_gate_reads_dirty", async () => {
  await staging("crossfeed_enabled", "1");
  assert.equal(dirty(), true);
});

// --- the state line --------------------------------------------------------------------------------

test("test_the_new_entry_says_saving_restarts", () => {
  assert.equal(stateNow()?.line, "restarts");
});

test("test_a_dirty_saved_profile_says_saving_restarts", async () => {
  await onSaved("Flat");
  await setDesc("x");
  assert.equal(stateNow()?.line, "restarts");
});

test("test_save_is_off_with_no_station_ticked", async () => {
  await setStations([]);
  assert.equal(stateNow()?.saveOff, true);
});

test("test_a_clean_saved_profile_the_engine_runs_reads_live", async () => {
  await onSaved("Warm");
  assert.equal(stateNow()?.line, "live");
});

// --- switching -------------------------------------------------------------------------------------

test("test_switching_to_a_saved_profile_stages_its_rows", async () => {
  await onSaved("Flat");
  assert.deepEqual(effectivePipelines.value, STEREO("-2", PEAKS));
});

test("test_switching_to_a_saved_profile_stages_its_post", async () => {
  await onSaved("Flat");
  assert.equal(effective("crossfeed_preset"), "jmeier");
});

test("test_switching_to_a_saved_profile_names_the_edit", async () => {
  await onSaved("Flat");
  assert.equal(meta.value.name, "Flat");
});

test("test_switching_to_a_saved_profile_reads_its_stored_description", async () => {
  await onSaved("Flat");
  assert.equal(meta.value.desc, FLAT_NOTE);
});

test("test_switching_to_a_saved_profile_ticks_every_station_holding_it", async () => {
  await onSaved("Flat");
  assert.deepEqual([...meta.value.stations].sort(), [LOADED, "Spare"]);
});

test("test_switching_away_from_a_dirty_edit_stashes_it", async () => {
  await setName("Dusk");
  await staging("crossfeed_enabled", "1");
  await onSaved("Warm");
  assert.equal(staged.value.has(keyOf({ st: LOADED, name: NEW })), true);
});

test("test_switching_back_restores_the_typed_name", async () => {
  await setName("Dusk");
  await staging("crossfeed_enabled", "1");
  await onSaved("Warm");
  await onSaved(NEW);
  assert.equal(meta.value.name, "Dusk");
});

test("test_switching_back_restores_the_staged_crossfeed_gate", async () => {
  await setName("Dusk");
  await staging("crossfeed_enabled", "1");
  await onSaved("Warm");
  await onSaved(NEW);
  assert.equal(effective("crossfeed_enabled"), "1");
});

// --- from scratch ----------------------------------------------------------------------------------

test("test_scratch_empties_every_rows_process", async () => {
  await onSaved("Flat");
  await scratch();
  await quiesce(w);
  assert.deepEqual(
    effectivePipelines.value.map((/** @type {PipelineRow} */ r) => r.process),
    ["", ""],
  );
});

test("test_scratch_shows_the_first_step", async () => {
  await scratch();
  await quiesce(w);
  assert.equal(page.value, PB_STEPS[0].id);
});

// --- save ------------------------------------------------------------------------------------------

test("test_saving_with_no_name_is_refused", async () => {
  await saveProfile();
  await quiesce(w);
  assert.equal(refused.value, true);
});

test("test_saving_over_a_name_a_ticked_station_holds_asks_first", async () => {
  await setName("Flat");
  await saveProfile();
  await quiesce(w);
  assert.equal(ask.value?.text, PROFILE_COPY.overwrite("Flat"));
});

test("test_a_fresh_save_stages_the_name_the_rows_and_the_other_stations", async () => {
  const from = await freshSave();
  assert.deepEqual(stagedField(from, "matrix_profile_save"), {
    name: "Dusk",
    rows: STEREO("0"),
    presets: ["Night"],
  });
});

test("test_a_fresh_save_stages_then_applies_then_writes_its_description", async () => {
  const from = await freshSave();
  assert.deepEqual(writesFrom(from), ["POST /api/config/stage", "POST /api/config/apply", "PUT /api/descriptions"]);
});

test("test_a_fresh_save_writes_its_description_under_its_name", async () => {
  const from = await freshSave();
  const put = /** @type {Sent[]} */ (w.posts.slice(from)).find((p) => p.at === "PUT /api/descriptions");
  assert.deepEqual(put?.body, { name: "Dusk", text: "fx-dusk note" });
});

test("test_a_save_of_a_name_the_daemon_knows_switches_to_it_last", async () => {
  await onSaved("Warm");
  await setDesc("fx-warm note");
  const from = w.posts.length;
  await saveProfile();
  await quiesce(w);
  const sent = /** @type {Sent[]} */ (w.posts.slice(from)).filter((p) => !p.at.startsWith("GET "));
  assert.deepEqual(sent.at(-1), { at: "POST /api/matrix/profile", body: { action: "switch", name: "Warm" } });
});

test("test_renaming_a_saved_profile_stages_the_delete_of_the_old_name_before_the_save", async () => {
  await onSaved("Flat");
  await setName("Dusk");
  await saveProfile();
  await quiesce(w);
  const bodies = /** @type {Sent[]} */ (w.posts)
    .filter((p) => p.at === "POST /api/config/stage")
    .map((p) => /** @type {{ http?: Record<string, string> }} */ (p.body)?.http ?? {});
  const del = bodies.findIndex((h) => h.matrix_profile_delete);
  const save = bodies.findIndex((h) => h.matrix_profile_save);
  const parsed = del < 0 ? null : JSON.parse(bodies[del].matrix_profile_delete);
  assert.deepEqual([del < save, parsed], [true, { name: "Flat", presets: ["Spare"] }]);
});

test("test_a_fresh_save_edits_the_saved_profile_in_the_loaded_station", async () => {
  await freshSave();
  assert.deepEqual(cur.value, { st: LOADED, name: "Dusk" });
});

test("test_a_fresh_save_leaves_no_stashed_edit_under_its_key", async () => {
  await freshSave();
  assert.equal(staged.value.has(keyOf({ st: LOADED, name: "Dusk" })), false);
});

// --- remove ----------------------------------------------------------------------------------------

test("test_removing_stages_the_name_and_the_other_stations_holding_it", async () => {
  const from = await removeFlat();
  assert.deepEqual(stagedField(from, "matrix_profile_delete"), { name: "Flat", presets: ["Spare"] });
});

test("test_removing_stages_then_applies", async () => {
  const from = await removeFlat();
  assert.deepEqual(writesFrom(from), ["POST /api/config/stage", "POST /api/config/apply"]);
});

test("test_removing_lands_on_the_first_saved_name_left", async () => {
  await removeFlat();
  assert.deepEqual(cur.value, { st: LOADED, name: "Warm" });
});

// --- discard ---------------------------------------------------------------------------------------

test("test_discarding_an_edit_reads_clean", async () => {
  await setName("x");
  await staging("crossfeed_enabled", "1");
  await discardEdit();
  await quiesce(w);
  assert.equal(dirty(), false);
});

test("test_discarding_an_edit_clears_the_staged_set", async () => {
  await setName("x");
  await staging("crossfeed_enabled", "1");
  await discardEdit();
  await quiesce(w);
  assert.deepEqual(w.staged, { live: {}, http: {} });
});
