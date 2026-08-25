// Behavioral suite for the apply-time hazard guard on applyAll(), and for the
// one-warning-per-hazard rule it shares with the edit-time guards.
//
// The edit-time guards (store/guards.js, reached through edit(), covered by
// snrguard.test.js and directsdmwarn.test.js) catch a dangerous COMBINATION as
// the user builds it, one field at a time. They cannot catch a dangerous set
// that arrives whole — a previewed preset stages no fields at all — and they
// cannot re-state a hazard at the moment it actually reaches the daemon. That is
// this guard's job: applyAll() looks at the set it is about to POST, and where
// that set lands the daemon somewhere hazardous it was NOT already sitting, a
// warn question opens BEFORE the apply POST goes out. Confirming sends it,
// declining sends nothing and keeps the staged set.
//
// Two hazards:
//   * A modulator flagged `needs_external_volume` (hqptuner/data/shapers.json,
//     sdm_modulators: AHM5EC5L and AHM7EC5L) with a LIVE volume control —
//     nothing pinned (`fixed_volume_enabled` off, `optimal_iso` zero, a volume
//     range with somewhere to travel) and Direct SDM off.
//   * `direct_sdm` ON against a volume that is not already fixed at -3 dBFS,
//     which is where Direct SDM pins the chain (HQPlayer manual §4.5,
//     hqplayerd-readme.txt §1.2).
// Where the RUNNING config is already in the hazardous state and the staged set
// does not change that, there is nothing to warn about and the apply goes
// straight out.
//
// One hazard, one warning: a yes at edit time settles that hazard for the apply
// as well, so the same configuration is never questioned twice on its way
// through. The acknowledgement is PER HAZARD — settling the modulator pairing
// says nothing about Direct SDM — and it lapses the moment the hazard leaves the
// staged picture, so reaching it again asks again.
//
// That rule is why every "the apply asks" case below reaches its hazard through
// a PREVIEWED PRESET rather than through edit(): both hazards are edit-guarded
// from every per-field direction, so a staged set built field by field has
// already been acknowledged by the time Apply is pressed, and an apply-time
// question there would be the second warning the rule forbids. A preview stages
// no field, trips no edit guard, and reaches the apply unacknowledged.
//
// The flag itself is never faked: the REAL shipped overlay is seeded into the
// /api/metadata signal, so a case claiming a name is flagged claims it about the
// data that ships. Fixture helpers THROW rather than assert when their setup did
// not take — a fixture that failed to set up makes the case below it vacuous,
// which is a broken fixture and not a broken behavior.
//
// Everything rides the real wire (docs/testing.md rule 4): edits stage through
// POST /api/config/stage, applies go out as POST /api/config/apply, and the
// question is driven through the public ask surface (question / answer /
// cancel). No store function is stubbed. A guarded applyAll() does not settle
// until its question is answered, so these cases hold the promise, drive the
// question, then await — never the reverse.
//
// Both dialog sentences are owner copy (docs/testing.md rule 9): these cases
// assert that a question is or is not open, its `kind`, and its `owner` — never
// a word of either message.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/applyguard.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { applyAll, discardAll, edit, previewPreset, lastApply } from "../../../hqptuner/static/store/actions.js";
import { question, answer, cancel } from "../../../hqptuner/static/store/ask.js";
import { effective } from "../../../hqptuner/static/store/resolve.js";
import { ok, bad, stagingWire, quiesce } from "../support/wire.js";

// The shipped overlay, whole and unedited: the same payload /api/metadata serves
// the frontend under `shapers`.
const SHAPERS = JSON.parse(readFileSync(new URL("../../../hqptuner/data/shapers.json", import.meta.url), "utf8"));

// A flagged name, and a plainly unflagged one to stand for every modulator that
// is not flagged.
const AHM5 = "AHM5EC5L";
const PLAIN = "DSD7";

// The enumeration the /config form offers for `modulator`, in the form's own
// shape: an index string per row carrying the engine's name as its label. The
// overlay joins that enumeration BY NAME, so a staged modulator is an index that
// only means something through this list.
const MODULATORS = [
  { value: "0", label: PLAIN },
  { value: "1", label: AHM5 },
];
const PLAIN_V = "0";
const AHM5_V = "1";

/**
 * One /config form field: the form answers a checkbox with a real bool, an
 * enumeration with an index string plus its rows, and everything else with a
 * string.
 *
 * @typedef {{ [key: string]: unknown, name: string, value: unknown }} FormField
 */

// A volume nothing pins: both fixed mechanisms off, a real travel range, Direct
// SDM off — and a remembered fixed level that is not -3, so no case here is
// quietly sitting at the level Direct SDM would pin it to.
/** @type {FormField[]} */
const LIVE_VOLUME = [
  { name: "fixed_volume_enabled", value: false },
  { name: "volume_fixed", value: false },
  { name: "volume_min", value: "-60" },
  { name: "volume_max", value: "0" },
  { name: "direct_sdm", value: false },
];

/** @type {Record<string, string>} */
const REMEMBERED_LEVEL = { fixed_volume: "-20" };

/**
 * The same field list with one field's value replaced.
 *
 * @param {FormField[]} fields
 * @param {string} name
 * @param {unknown} value
 * @returns {FormField[]}
 */
const patch = (fields, name, value) => fields.map((f) => (f.name === name ? { ...f, value } : f));

// The two hazardous sets, as a preset carries them. GET /api/preset/{name}
// answers in FORM-FIELD terms, not store keys — the preview resolver looks each
// value up by the field a setting lives on — so this config is keyed the way the
// /config form names things (`modulator`), while the store side of the same
// setting is read back by its store key (`sdm_modulator`). The two are the same
// string for `direct_sdm` and different for the modulator, which is exactly the
// pair that tells a fake speaking the wrong domain from one speaking the wire.
//
// `expect` is that store-side reading: what `effective()` must report once the
// preview has landed, checked by preview() below so a preset the resolver never
// saw fails as the broken fixture it is rather than as a silent no-op.
/**
 * @typedef {{
 *   name: string,
 *   config: Record<string, string>,
 *   expect: { key: string, value: string },
 * }} PresetFixture
 */

/** @type {PresetFixture} */
const FLAGGED_MODULATOR_PRESET = {
  name: "Night",
  config: { modulator: AHM5_V },
  expect: { key: "sdm_modulator", value: AHM5_V },
};

/** @type {PresetFixture} */
const DIRECT_SDM_PRESET = {
  name: "Night",
  config: { direct_sdm: "1" },
  expect: { key: "direct_sdm", value: "1" },
};

// --- fixture -----------------------------------------------------------------

// Total reset: module-level signals outlive a test file, so a partial reset makes
// cases pass alone and fail in sequence. `staged` is private and is cleared
// through discardAll().
//
// The read endpoints answer with the trees this suite set, the way the real ones
// answer with the daemon's: an apply refreshes them, and a fake answering `{}`
// there would quietly erase the state under test. Every apply POST is recorded
// in `w.posts`, in arrival order, so "sent" and "not sent" are claims about the
// wire. `applyFails` makes the daemon refuse the apply, which is the real case
// in which a user presses Apply twice on one staged set.
/**
 * @param {{
 *   modulator?: string,
 *   volume?: FormField[],
 *   file?: Record<string, string>,
 *   preset?: PresetFixture,
 *   applyFails?: boolean,
 * }} [state]
 * @returns {Promise<import("../support/wire.js").StagingWire>}
 */
async function fixture({
  modulator = PLAIN_V,
  volume = LIVE_VOLUME,
  file = REMEMBERED_LEVEL,
  preset,
  applyFails = false,
} = {}) {
  if (!(AHM5 in (SHAPERS.sdm_modulators || {})) || !(PLAIN in (SHAPERS.sdm_modulators || {}))) {
    throw new Error(`shapers.json is missing ${AHM5} or ${PLAIN} under sdm_modulators: the cases below cannot bite`);
  }
  const w = stagingWire({
    routes: (path, opts, wire) => {
      if (path === "/api/config/apply") {
        wire.posts.push(JSON.parse(String(opts.body || "{}")));
        return applyFails ? bad(503, "engine refused") : ok({});
      }
      if (preset && path === `/api/preset/${preset.name}`) return ok({ name: preset.name, config: preset.config });
      if (path === "/api/config") return ok({ data: config.value });
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return undefined;
    },
  });
  engineState.value = {};
  enums.value = null;
  metadata.value = { settings: {}, filters: { filters: {}, aliases: {} }, shapers: SHAPERS };
  config.value = {
    fields: [{ name: "modulator", value: modulator, options: MODULATORS }, ...volume],
    file,
    active: "",
    profiles: null,
  };
  matrixConfig.value = { fields: [], active: "[Default]" };
  lastApply.value = null;
  cancel();
  await discardAll();
  return w;
}

// Throw unless the staged picture reads what the caller meant to put there. A
// premise that did not take makes the case below it vacuous, which is a broken
// fixture and not a broken behavior.
/**
 * @param {string} key
 * @param {string | boolean} value
 * @returns {void}
 */
function require(key, value) {
  if (effective(key) !== value) {
    throw new Error(`${key} is not staged: effective() reads ${String(effective(key))}, not ${String(value)}`);
  }
}

// Stage an edit the edit-time guards have nothing to say about. Throws if a
// question opens: a case that meant to stage quietly and instead answered a
// guard has acknowledged a hazard it never meant to, and every "no question at
// apply" assertion under it would pass for the wrong reason.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @param {string} key
 * @param {string | boolean} value
 * @returns {Promise<void>}
 */
async function stageQuietly(w, key, value) {
  const held = edit(key, value);
  await quiesce(w);
  if (question.value !== null) {
    const owner = question.value.owner;
    cancel();
    await held;
    throw new Error(`editing ${key} opened a question owned by ${owner}: this case cannot be read`);
  }
  await held;
  await quiesce(w);
  require(key, value);
}

// Stage an edit the edit-time guards DO question, and say yes — which is the
// acknowledgement the one-warning rule turns on. Throws if no question opened:
// without one there is nothing acknowledged, and the case below has lost its
// premise.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @param {string} key
 * @param {string | boolean} value
 * @returns {Promise<void>}
 */
async function stageAcknowledged(w, key, value) {
  const held = edit(key, value);
  await quiesce(w);
  if (question.value === null) {
    await held;
    throw new Error(`editing ${key} opened no question to acknowledge: this case cannot bite`);
  }
  answer();
  await held;
  await quiesce(w);
  require(key, value);
}

// Fire an edit without awaiting it and let the wire go quiet, so a case can look
// at the question it opened while the edit is still in flight.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @param {string} key
 * @param {string | boolean} value
 * @returns {Promise<{ held: Promise<unknown> }>}
 */
async function startEdit(w, key, value) {
  const held = edit(key, value);
  await quiesce(w);
  return { held: Promise.resolve(held) };
}

// Preview a preset and leave it previewed, with nothing staged per field. Throws
// if the preview itself opened a question: this suite's premise is that the
// apply is what asks, and a question already open before applyAll() runs would
// make that unreadable.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @param {PresetFixture} preset
 * @returns {Promise<void>}
 */
async function preview(w, preset) {
  await previewPreset(preset.name);
  await quiesce(w);
  if (question.value !== null) {
    throw new Error(`previewing ${preset.name} opened a question of its own: the apply-time case cannot bite`);
  }
  require(preset.expect.key, preset.expect.value);
}

// Fire an apply without awaiting it and let the wire go quiet, so a case can look
// at the question (or its absence) while the apply is still in flight. The held
// promise comes back boxed — an async function returning it bare would adopt it
// and never resolve while the question is open. Every case settles the question
// and awaits the held apply, so a guard that never resolves shows up as a hang
// rather than as a silent leak.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @returns {Promise<{ held: Promise<unknown> }>}
 */
async function startApply(w) {
  // The rejection handler goes on FIRST, before the wire is given a turn: a
  // refused apply rejects, and a rejected promise left unhandled across a turn
  // is an unhandled rejection that fails whatever test happens to be running.
  // Nothing here asserts whether a declined or refused apply resolves or
  // rejects, so settling it either way loses nothing.
  const held = Promise.resolve(applyAll()).catch(() => undefined);
  await quiesce(w);
  return { held };
}

// Apply once and say yes to the question that opens, which is the
// acknowledgement the second apply in a case is measured against. Throws if no
// question opened.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @returns {Promise<void>}
 */
async function applyAcknowledged(w) {
  const { held } = await startApply(w);
  if (question.value === null) {
    await held.catch(() => {});
    throw new Error("the first apply opened no question to acknowledge: this case cannot bite");
  }
  answer();
  await held.catch(() => {});
  await quiesce(w);
}

// --- hazard one: a flagged modulator against a live volume -------------------

test("test_applying_a_previewed_flagged_modulator_with_a_live_volume_opens_a_warn_question", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET });
  await preview(w, FLAGGED_MODULATOR_PRESET);
  const { held } = await startApply(w);
  assert.equal(question.value?.kind, "warn");
  cancel();
  await held.catch(() => {});
});

// "Before the POST" is the whole point of the guard: a question that opens after
// the daemon already has the set warns about nothing.
test("test_a_flagged_modulator_apply_sends_no_post_while_its_question_is_open", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET });
  await preview(w, FLAGGED_MODULATOR_PRESET);
  const { held } = await startApply(w);
  assert.equal(w.posts.length, 0);
  cancel();
  await held.catch(() => {});
});

// The running config is ALREADY in the pairing — flagged modulator, live volume —
// and the staged edit narrows the volume range from -60 to -50, which leaves it
// live. Nothing about the pairing changed, so there is nothing to say about it.
test("test_applying_a_pairing_the_running_config_already_has_opens_no_question", async () => {
  const w = await fixture({ modulator: AHM5_V });
  await stageQuietly(w, "volume_min", "-50");
  const { held } = await startApply(w);
  assert.equal(question.value, null);
  cancel();
  await held.catch(() => {});
});

// --- hazard two: direct sdm against a volume not fixed at -3 dB --------------

test("test_applying_a_previewed_direct_sdm_against_a_volume_not_fixed_at_minus_three_opens_a_warn_question", async () => {
  const w = await fixture({ preset: DIRECT_SDM_PRESET });
  await preview(w, DIRECT_SDM_PRESET);
  const { held } = await startApply(w);
  assert.equal(question.value?.kind, "warn");
  cancel();
  await held.catch(() => {});
});

test("test_a_direct_sdm_apply_sends_no_post_while_its_question_is_open", async () => {
  const w = await fixture({ preset: DIRECT_SDM_PRESET });
  await preview(w, DIRECT_SDM_PRESET);
  const { held } = await startApply(w);
  assert.equal(w.posts.length, 0);
  cancel();
  await held.catch(() => {});
});

// Direct SDM is already on in the running config and the staged set does not
// touch it, so the apply changes nothing about that hazard. The volume is still
// not fixed at -3, so a guard reading the staged picture alone would warn here.
test("test_applying_with_direct_sdm_already_on_and_staying_on_opens_no_question", async () => {
  const w = await fixture({ volume: patch(LIVE_VOLUME, "direct_sdm", true) });
  await stageQuietly(w, "volume_min", "-50");
  const { held } = await startApply(w);
  assert.equal(question.value, null);
  cancel();
  await held.catch(() => {});
});

// --- who owns the question ---------------------------------------------------

// `owner` names the surface the question renders on. An apply-time question
// belongs to the pending bar — the control the user pressed Apply on — not to
// the field that happens to be dangerous, which lives on another card.
test("test_an_apply_time_question_is_owned_by_pending", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET });
  await preview(w, FLAGGED_MODULATOR_PRESET);
  const { held } = await startApply(w);
  assert.equal(question.value?.owner, "pending");
  cancel();
  await held.catch(() => {});
});

test("test_a_direct_sdm_apply_time_question_is_owned_by_pending", async () => {
  const w = await fixture({ preset: DIRECT_SDM_PRESET });
  await preview(w, DIRECT_SDM_PRESET);
  const { held } = await startApply(w);
  assert.equal(question.value?.owner, "pending");
  cancel();
  await held.catch(() => {});
});

// --- answering ---------------------------------------------------------------

// Whether a declined apply resolves or rejects is not specified, so neither is
// asserted: the held promise is settled either way and the wire is the witness.
test("test_declining_an_apply_time_question_sends_no_apply_post", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET });
  await preview(w, FLAGGED_MODULATOR_PRESET);
  const { held } = await startApply(w);
  cancel();
  await held.catch(() => {});
  await quiesce(w);
  assert.equal(w.posts.length, 0);
});

// A decline is not a discard: the set the user built is still theirs to fix and
// apply again.
test("test_declining_an_apply_time_question_leaves_the_previewed_set_intact", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET });
  await preview(w, FLAGGED_MODULATOR_PRESET);
  const { held } = await startApply(w);
  cancel();
  await held.catch(() => {});
  await quiesce(w);
  assert.equal(effective("sdm_modulator"), AHM5_V);
});

// The same claim about a per-field edit sitting alongside the previewed set: the
// volume narrowing is staged before the preview, is nothing to do with the
// hazard, and a decline that swept the pending set would take it with it.
test("test_declining_an_apply_time_question_leaves_an_unrelated_staged_edit_alone", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET });
  await stageQuietly(w, "volume_min", "-50");
  await preview(w, FLAGGED_MODULATOR_PRESET);
  const { held } = await startApply(w);
  cancel();
  await held.catch(() => {});
  await quiesce(w);
  assert.equal(effective("volume_min"), "-50");
});

test("test_confirming_an_apply_time_question_sends_the_apply_post", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET });
  await preview(w, FLAGGED_MODULATOR_PRESET);
  const { held } = await startApply(w);
  answer();
  await held.catch(() => {});
  await quiesce(w);
  assert.equal(w.posts.length, 1);
});

// --- one hazard, one warning -------------------------------------------------

test("test_a_hazard_acknowledged_at_edit_time_opens_no_apply_time_question", async () => {
  const w = await fixture();
  await stageAcknowledged(w, "sdm_modulator", AHM5_V);
  const { held } = await startApply(w);
  assert.equal(question.value, null);
  cancel();
  await held.catch(() => {});
});

test("test_a_direct_sdm_hazard_acknowledged_at_edit_time_opens_no_apply_time_question", async () => {
  const w = await fixture();
  await stageAcknowledged(w, "direct_sdm", "1");
  const { held } = await startApply(w);
  assert.equal(question.value, null);
  cancel();
  await held.catch(() => {});
});

// The acknowledgement lapses with the hazard: staging back to an unflagged
// modulator takes the pairing out of the staged picture, so choosing the flagged
// one again is a fresh hazard and asks again.
test("test_leaving_a_hazard_and_reaching_it_again_asks_again_at_edit_time", async () => {
  const w = await fixture();
  await stageAcknowledged(w, "sdm_modulator", AHM5_V);
  await stageQuietly(w, "sdm_modulator", PLAIN_V);
  const { held } = await startEdit(w, "sdm_modulator", AHM5_V);
  assert.notEqual(question.value, null);
  cancel();
  await held.catch(() => {});
});

// A discard empties the staged set, so every hazard in it is gone and every
// acknowledgement with it.
test("test_discarding_after_acknowledging_a_hazard_asks_again_when_it_is_reached_again", async () => {
  const w = await fixture();
  await stageAcknowledged(w, "sdm_modulator", AHM5_V);
  await discardAll();
  await quiesce(w);
  const { held } = await startEdit(w, "sdm_modulator", AHM5_V);
  assert.notEqual(question.value, null);
  cancel();
  await held.catch(() => {});
});

// A refused apply keeps its staging, so the user presses Apply again on the same
// set. The hazard was acknowledged on the first press and nothing about it has
// changed, so the second press does not re-ask.
test("test_pressing_apply_again_on_the_same_acknowledged_set_opens_no_second_question", async () => {
  const w = await fixture({ preset: FLAGGED_MODULATOR_PRESET, applyFails: true });
  await preview(w, FLAGGED_MODULATOR_PRESET);
  await applyAcknowledged(w);
  require("sdm_modulator", AHM5_V);
  const { held } = await startApply(w);
  assert.equal(question.value, null);
  cancel();
  await held.catch(() => {});
});
