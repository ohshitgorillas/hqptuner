// Behavioral suite for the apply-time hazard guard on applyAll(), and for the
// one-warning-per-hazard rule it shares with the edit-time guards.
//
// The edit-time guards (store/guards.js, reached through edit(), covered by
// directsdmwarn.test.js) catch a dangerous setting as the user stages it, one
// field at a time. They cannot re-state a hazard at the moment it actually
// reaches the daemon. That is this guard's job:
// applyAll() looks at the set it is about to POST, and where that set lands the
// daemon somewhere hazardous it was NOT already sitting, a warn question opens
// BEFORE the apply POST goes out. Confirming sends it, declining sends nothing
// and keeps the staged set.
//
// The hazard: `direct_sdm` ON against a volume that is not already fixed at
// -3 dBFS, which is where Direct SDM pins the chain (HQPlayer manual §4.5,
// hqplayerd-readme.txt §1.2). Where the RUNNING config already has Direct SDM on
// and the staged set does not change that, there is nothing to warn about and
// the apply goes straight out.
//
// One hazard, one warning: a yes at edit time settles that hazard for the apply
// as well, so the same configuration is never questioned twice on its way
// through. The acknowledgement lapses the moment the hazard leaves the staged
// picture, so reaching it again asks again.
//
// Edits stage through POST /api/config/stage, applies go out as
// POST /api/config/apply, and the question is driven through the public ask
// surface (question / answer / cancel). A guarded applyAll() does not settle
// until its question is answered, so these cases hold the promise, drive the
// question, then await — never the reverse.
//
// These cases assert that a question is or is not open, its `kind`, and its
// `owner`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/guards/applyguard.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
  lastApply,
} from "../../../../hqptuner/static/store/signals.js";
import { applyAll, discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { question, answer, cancel } from "../../../../hqptuner/static/store/ask.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { ok, stagingWire, quiesce } from "../../support/wire/wire.js";
import { fieldReading, seedReadings } from "../../support/readings.js";
import { readings } from "../../../../hqptuner/static/store/core/readings.js";

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
  { name: "direct_sdm", value: "0" },
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

// --- fixture -----------------------------------------------------------------

// Total reset: module-level signals outlive a test file, so a partial reset makes
// cases pass alone and fail in sequence. `staged` is private and is cleared
// through discardAll().
//
// The read endpoints answer with the trees this suite set, the way the real ones
// answer with the daemon's: an apply refreshes them, and a fake answering `{}`
// there would quietly erase the state under test. Every apply POST is recorded
// in `w.posts`, in arrival order, so "sent" and "not sent" are claims about the
// wire.
/**
 * @param {{ volume?: FormField[] }} [state]
 * @returns {Promise<import("../../support/wire/wire.js").StagingWire>}
 */
async function fixture({ volume = LIVE_VOLUME } = {}) {
  const w = stagingWire({
    routes: (path, opts, wire) => {
      if (path === "/api/config/apply") {
        wire.posts.push(JSON.parse(String(opts.body || "{}")));
        return ok({ report: {} });
      }
      if (path === "/api/config") return ok(readings.value);
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return undefined;
    },
  });
  engineState.value = {};
  enums.value = null;
  metadata.value = { settings: {}, filters: { filters: {}, aliases: {} }, shapers: { sdm_modulators: {} } };
  config.value = { fields: volume.map(({ name }) => ({ name })) };
  matrixConfig.value = { fields: [] };
  seedReadings({
    ...Object.fromEntries(volume.map(({ name, value }) => [name, value])),
    ...Object.fromEntries(
      Object.entries(REMEMBERED_LEVEL).map(([name, v]) => [name, fieldReading(v, { show: "file" })]),
    ),
  });
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
 * @param {import("../../support/wire/wire.js").StagingWire} w
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
 * @param {import("../../support/wire/wire.js").StagingWire} w
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
 * @param {import("../../support/wire/wire.js").StagingWire} w
 * @param {string} key
 * @param {string | boolean} value
 * @returns {Promise<{ held: Promise<unknown> }>}
 */
async function startEdit(w, key, value) {
  const held = edit(key, value);
  await quiesce(w);
  return { held: Promise.resolve(held) };
}

// Fire an apply without awaiting it and let the wire go quiet, so a case can look
// at the question (or its absence) while the apply is still in flight. The held
// promise comes back boxed — an async function returning it bare would adopt it
// and never resolve while the question is open. Every case settles the question
// and awaits the held apply, so a guard that never resolves shows up as a hang
// rather than as a silent leak.
/**
 * @param {import("../../support/wire/wire.js").StagingWire} w
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

// --- the hazard: direct sdm against a volume not fixed at -3 dB --------------

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

// --- one hazard, one warning -------------------------------------------------

test("test_a_direct_sdm_hazard_acknowledged_at_edit_time_opens_no_apply_time_question", async () => {
  const w = await fixture();
  await stageAcknowledged(w, "direct_sdm", "1");
  const { held } = await startApply(w);
  assert.equal(question.value, null);
  cancel();
  await held.catch(() => {});
});

// The acknowledgement lapses with the hazard: staging Direct SDM back off takes
// it out of the staged picture, so turning it on again is a fresh hazard and
// asks again.
test("test_leaving_a_hazard_and_reaching_it_again_asks_again_at_edit_time", async () => {
  const w = await fixture();
  await stageAcknowledged(w, "direct_sdm", "1");
  await stageQuietly(w, "direct_sdm", "0");
  const { held } = await startEdit(w, "direct_sdm", "1");
  assert.equal(question.value?.owner, "direct_sdm");
  cancel();
  await held.catch(() => {});
});

// A discard empties the staged set, so every hazard in it is gone and every
// acknowledgement with it.
test("test_discarding_after_acknowledging_a_hazard_asks_again_when_it_is_reached_again", async () => {
  const w = await fixture();
  await stageAcknowledged(w, "direct_sdm", "1");
  await discardAll();
  await quiesce(w);
  const { held } = await startEdit(w, "direct_sdm", "1");
  assert.equal(question.value?.owner, "direct_sdm");
  cancel();
  await held.catch(() => {});
});
