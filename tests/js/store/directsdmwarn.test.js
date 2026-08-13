// Behavioral suite for the Direct SDM guard on edit().
//
// `direct_sdm` disables volume control and pins the PCM chain at a fixed -3
// dBFS (HQPlayer manual §4.5, hqplayerd-readme.txt §1.2), so staging it ON
// opens a warn question first — unless the user is ALREADY sitting at a fixed
// -3 dB, in which case the setting costs them nothing and stages straight
// through.
//
// "Already at a fixed -3 dB" has two independent spellings, because HQPlayer
// has two independent fixed-volume mechanisms:
//   * `fixed_volume_enabled` (a bool, readme §1.13) gating `fixed_volume`, the
//     dBFS level. BOTH have to line up: the gate on AND the level at -3. The
//     level is read from config-file truth, since the daemon's own form reports
//     its remembered level while the feature is off.
//   * `optimal_iso` — wire field `volume_fixed`, readme §1.2, NOT gated by
//     `fixed_volume_enabled` — whose XML domain is 0=off / 1=-3 dB / 2=-6 dB
//     (manual §4.2). The /config form renders it as a bare checkbox that cannot
//     express 2, so it reaches the UI as one of those strings or as a bare
//     bool, and bool `true` means the same as "1".
// -6 dB in either mechanism is NOT -3 dB, and so still warns.
//
// Everything is driven through the real edit() against a staging wire
// (docs/testing.md rule 4); the question is driven through the public ask
// surface (question / answer / cancel), never by poking store internals. A
// guarded edit() does not resolve until its question is answered, so these
// tests hold the promise, drive the question, then await — never the reverse.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/directsdmwarn.test.js
//
// Rule-8 exemption, stated rather than assumed: the two askWarn default-label
// tests at the bottom of this file characterize behaviour that predates the
// Direct SDM guard, so they cannot fail against the pre-change tree. Every other
// test here bites on the guard.

import test from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { applyAll, discardAll, edit, lastApply } from "../../../hqptuner/static/store/actions.js";
import { question, askWarn, askConfirm, answer, cancel } from "../../../hqptuner/static/store/ask.js";
import { atFixedMinusThree } from "../../../hqptuner/static/store/schema.js";
import { ok, stagingWire, quiesce } from "../support/wire.js";

/**
 * One /config form field: the form answers a checkbox with a real bool and
 * everything else with a string.
 *
 * @typedef {{ name: string, value: string | boolean }} FormField
 */

/**
 * A volume state as the two config trees carry it — `fields` is the /config
 * form, `file` is config-file truth, and file truth wins where both speak.
 *
 * @typedef {{ fields: FormField[], file: Record<string, string> }} VolumeState
 */

// Total reset: module-level signals outlive a test file, so a partial reset
// makes cases pass alone and fail in sequence.
/**
 * @param {VolumeState} volume
 * @returns {Promise<import("../support/wire.js").StagingWire>}
 */
async function reset(volume) {
  // The read endpoints answer with the trees this suite set, the way the real
  // ones answer with the daemon's: an apply refreshes them, and a fake that
  // answered `{}` there would quietly erase the volume state under test.
  const w = stagingWire({
    routes: (path) => {
      if (path === "/api/config") return ok({ data: config.value });
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return undefined;
    },
  });
  engineState.value = {};
  config.value = { fields: volume.fields, file: volume.file, active: "", profiles: null };
  matrixConfig.value = { fields: [], active: "[Default]" };
  lastApply.value = null;
  cancel();
  await discardAll();
  return w;
}

// Put a real apply result in `lastApply` by applying for real over the wire, so
// "untouched" is a claim about a value something actually wrote. Throws rather
// than asserting: a seed that failed to seed makes the test that follows
// vacuous, which is a broken fixture and not a broken behaviour.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @returns {Promise<unknown>}
 */
async function seedApply(w) {
  await applyAll();
  await quiesce(w);
  if (lastApply.value === null || lastApply.value === undefined) {
    throw new Error("apply recorded no result: lastApply is still empty, so the test below cannot bite");
  }
  return lastApply.value;
}

// Fire an edit without awaiting it and let the wire go quiet, so the suite can
// look at the question (or its absence) while the edit is still in flight. The
// held promise comes back boxed — an async function returning it bare would
// adopt it and never resolve while the question is open. Every test awaits the
// held edit after closing its question, so a guard that never resolves shows up
// as a hang rather than as a silent leak.
/**
 * @param {import("../support/wire.js").StagingWire} w
 * @param {string | boolean} value
 */
async function stage(w, value) {
  const held = edit("direct_sdm", value);
  await quiesce(w);
  return { held };
}

// The volume is free: nothing pinned, and a remembered fixed level that is not
// -3 to prove the level alone does not count.
/** @type {VolumeState} */
const FREE = {
  fields: [
    { name: "fixed_volume_enabled", value: false },
    { name: "volume_fixed", value: false },
  ],
  file: { fixed_volume: "-20" },
};

// The same free volume, with Direct SDM already ON in the baseline. Turning it
// OFF is a real edit against this tree — where the baseline has it off, an
// off-staging is back on its baseline and the store reports it clean rather
// than pending, which is not what a "stages nothing" test wants to measure.
/** @type {VolumeState} */
const FREE_WITH_DIRECT_SDM_ON = {
  fields: [...FREE.fields, { name: "direct_sdm", value: true }],
  file: FREE.file,
};

const MESSAGE =
  "Enabling this setting will force a -3dB fixed volume on the PCM chain as well. " +
  "Are you sure you want to proceed?";

// --- the guard opens ---------------------------------------------------------

test("staging direct sdm on with a free volume opens a warn question", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, "1");
  assert.equal(question.value?.kind, "warn");
  cancel();
  await held;
});

test("the direct sdm warning names direct_sdm as owner", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, "1");
  assert.equal(question.value?.owner, "direct_sdm");
  cancel();
  await held;
});

test("the direct sdm warning states the forced -3dB fixed volume", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, "1");
  assert.equal(question.value?.message, MESSAGE);
  cancel();
  await held;
});

test("the direct sdm warning confirms with Yes", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, "1");
  assert.equal(question.value?.confirm, "Yes");
  cancel();
  await held;
});

test("the direct sdm warning declines with No", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, "1");
  assert.equal(question.value?.decline, "No");
  cancel();
  await held;
});

// The /config form spells a checkbox with a real bool (see FormField above, and
// the baseline in FREE_WITH_DIRECT_SDM_ON), so the value reaching edit() from a
// form-driven control is `true`, not the string "1". A guard keyed on the string
// alone would wave the real form path straight through.
test("staging direct sdm on as a bare bool opens a warn question", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, true);
  assert.equal(question.value?.kind, "warn");
  cancel();
  await held;
});

test("staging direct sdm off as a bare bool opens no question", async () => {
  const w = await reset(FREE_WITH_DIRECT_SDM_ON);
  const { held } = await stage(w, false);
  assert.equal(question.value, null);
  cancel();
  await held;
});

test("direct sdm does not stage while its question is open", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, "1");
  assert.equal("direct_sdm" in w.staged.http, false);
  cancel();
  await held;
});

test("confirming the direct sdm warning stages the edit", async () => {
  const w = await reset(FREE);
  const { held } = await stage(w, "1");
  answer();
  await held;
  await quiesce(w);
  assert.equal(w.staged.http.direct_sdm, "1");
});

// "Stages nothing" means the pending set is UNCHANGED, not emptied: a safe
// value of the same key is staged first, and after the cancel it must still be
// there — neither overwritten by the dangerous value nor swept out with it.
test("cancelling the direct sdm warning leaves the staged set unchanged", async () => {
  const w = await reset(FREE_WITH_DIRECT_SDM_ON);
  const { held: pre } = await stage(w, "0");
  await pre;
  const { held } = await stage(w, "1");
  cancel();
  await held;
  await quiesce(w);
  assert.equal(w.staged.http.direct_sdm, "0");
});

// The apply comes first so `before` is a result the store itself wrote: against
// an empty `lastApply` this reads null === null and passes on an implementation
// that never touches the signal at all.
test("a cancelled direct sdm warning leaves lastApply untouched", async () => {
  const w = await reset(FREE);
  const before = await seedApply(w);
  const { held } = await stage(w, "1");
  cancel();
  await held;
  await quiesce(w);
  assert.equal(lastApply.value, before);
});

// --- already at a fixed -3 dB: no warning to give ----------------------------

/** @type {{ what: string, volume: VolumeState }[]} */
const PINNED_AT_MINUS_THREE = [
  {
    what: "fixed volume on at -3",
    volume: {
      fields: [
        { name: "fixed_volume_enabled", value: true },
        { name: "volume_fixed", value: false },
      ],
      file: { fixed_volume: "-3" },
    },
  },
  {
    what: "optimal iso at its -3 dB setting",
    volume: {
      fields: [{ name: "fixed_volume_enabled", value: false }],
      file: { volume_fixed: "1", fixed_volume: "-20" },
    },
  },
  {
    what: "an optimal iso checkbox the form could only render as a bool",
    volume: {
      fields: [
        { name: "fixed_volume_enabled", value: false },
        { name: "volume_fixed", value: true },
      ],
      file: { fixed_volume: "-20" },
    },
  },
];

for (const { what, volume } of PINNED_AT_MINUS_THREE) {
  test(`direct sdm on with ${what} stages immediately`, async () => {
    const w = await reset(volume);
    const { held } = await stage(w, "1");
    assert.equal(w.staged.http.direct_sdm, "1");
    cancel();
    await held;
  });
}

// Deliberate overlap with the loop above: both drive the same edit, and each
// watches a different half of it. A failure here says the guard asked a question
// it had no business asking; a failure above says it swallowed the edit. Only
// one of those is diagnosed by either loop alone, so both stay.
for (const { what, volume } of PINNED_AT_MINUS_THREE) {
  test(`direct sdm on with ${what} opens no question`, async () => {
    const w = await reset(volume);
    const { held } = await stage(w, "1");
    assert.equal(question.value, null);
    cancel();
    await held;
  });
}

// The bool the /config form hands over for optimal_iso is that same -3 dB
// setting, and only the schema predicate ever sees it unnormalized.
test("a bare bool optimal iso reads as a fixed -3 dB", () => {
  assert.equal(
    atFixedMinusThree((key) => (key === "optimal_iso" ? true : undefined)),
    true,
  );
});

// --- pinned somewhere else, or not pinned at all: still dangerous ------------

/** @type {{ what: string, volume: VolumeState }[]} */
const STILL_DANGEROUS = [
  {
    what: "optimal iso at its -6 dB setting",
    volume: {
      fields: [{ name: "fixed_volume_enabled", value: false }],
      file: { volume_fixed: "2", fixed_volume: "-20" },
    },
  },
  {
    what: "fixed volume on at -6",
    volume: {
      fields: [
        { name: "fixed_volume_enabled", value: true },
        { name: "volume_fixed", value: false },
      ],
      file: { fixed_volume: "-6" },
    },
  },
  {
    what: "a remembered -3 level with fixed volume off",
    volume: {
      fields: [
        { name: "fixed_volume_enabled", value: false },
        { name: "volume_fixed", value: false },
      ],
      file: { fixed_volume: "-3" },
    },
  },
];

for (const { what, volume } of STILL_DANGEROUS) {
  test(`direct sdm on with ${what} opens a warn question`, async () => {
    const w = await reset(volume);
    const { held } = await stage(w, "1");
    assert.equal(question.value?.kind, "warn");
    cancel();
    await held;
  });
}

for (const { what, volume } of STILL_DANGEROUS) {
  test(`direct sdm on with ${what} does not stage while its question is open`, async () => {
    const w = await reset(volume);
    const { held } = await stage(w, "1");
    assert.equal("direct_sdm" in w.staged.http, false);
    cancel();
    await held;
  });
}

// --- turning it OFF is never dangerous ---------------------------------------
// Whatever the volume state: switching the setting off cannot force anything.
// "0" is the trap — a guard that tests the raw value for truthiness warns on
// the string zero the form spells "off" with.
//
// Every state here is one the guard WOULD warn about on an on-staging, so the
// off-value is the only thing that can account for the silence. A volume state
// that suppresses the guard by itself would make these pass against a guard
// that never looks at the staged value at all.
const OFF_STATES = [
  { what: "a free volume", volume: FREE },
  { what: "optimal iso at -6 dB", volume: STILL_DANGEROUS[0].volume },
  { what: "fixed volume on at -6", volume: STILL_DANGEROUS[1].volume },
];

for (const { what, volume } of OFF_STATES) {
  test(`turning direct sdm off with ${what} opens no question`, async () => {
    const w = await reset(volume);
    const { held } = await stage(w, "0");
    assert.equal(question.value, null);
    cancel();
    await held;
  });
}

test("turning direct sdm off stages immediately", async () => {
  const w = await reset(FREE_WITH_DIRECT_SDM_ON);
  const { held } = await stage(w, "0");
  assert.equal(w.staged.http.direct_sdm, "0");
  cancel();
  await held;
});

// The one-question-at-a-time contract, end to end: a question opened over a
// pending Direct SDM warning declines the guard, so the dangerous edit never
// lands — and, as with an explicit cancel, what was already staged stays staged.
test("a question opened over a pending direct sdm warning stages nothing", async () => {
  const w = await reset(FREE_WITH_DIRECT_SDM_ON);
  const { held: pre } = await stage(w, "0");
  await pre;
  const { held } = await stage(w, "1");
  askConfirm("pending", "Replace the staged set?");
  await held;
  await quiesce(w);
  cancel();
  assert.equal(w.staged.http.direct_sdm, "0");
});

// --- the askWarn defaults are the buffer warning's, unchanged ----------------

test("askWarn with no labels confirms with the buffer warning's own wording", async () => {
  await reset(FREE);
  const p = askWarn("short_buffer", "minimum short buffer");
  const label = question.value?.confirm;
  cancel();
  await p;
  assert.equal(label, "Yes, I know what I'm doing, set it");
});

test("askWarn with no labels declines with the buffer warning's own wording", async () => {
  await reset(FREE);
  const p = askWarn("short_buffer", "minimum short buffer");
  const label = question.value?.decline;
  cancel();
  await p;
  assert.equal(label, "Revert the change");
});
