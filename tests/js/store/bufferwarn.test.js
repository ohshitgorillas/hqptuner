// Behavioral suite for the buffer-warning guard on edit().
//
// Three http-lane settings can starve the engine's buffers: short_buffer at 2
// (Minimum — hqplayerd-readme.txt, engine attribute 0=Normal/1=Short/2=Minimum)
// and the per-backend buffer times alsa_period / net_period at a negative value
// (−1 = minimum, docs/settings-classification.md). Staging one of those does not
// go straight to the pending buffer: a question of kind "warn" opens on the ask
// signal, the edit stages only on explicit confirm, and cancel stages nothing at
// all. Safe values of the same keys stage immediately, question-free. The
// one-question-at-a-time ask contract holds for the new kind: any question
// opened over a pending warn supersedes it, resolving the guard as declined.
//
// Everything is driven through the real edit() against a staging wire
// (docs/testing.md rule 4); the question is driven through the public ask
// surface (question / answer / cancel), never by poking store internals. A
// dangerous edit() does not resolve until its question is answered, so these
// tests hold the promise, drive the question, then await — never the reverse.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/bufferwarn.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit, lastApply } from "../../../hqptuner/static/store/actions.js";
import { question, askWarn, askConfirm, answer, cancel } from "../../../hqptuner/static/store/ask.js";
import { stagingWire, quiesce } from "../support/wire.js";

async function reset() {
  const w = stagingWire();
  engineState.value = { filter_junk: 0 };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  cancel();
  await discardAll();
  return w;
}

// Fire an edit without awaiting it and let the wire go quiet, so the suite can
// look at the question (or its absence) while the edit is still in flight. The
// held promise comes back boxed — an async function returning it bare would
// adopt it and never resolve while the question is open. Every test awaits the
// held edit after closing its question, so a guard that never resolves shows up
// as a hang rather than as a silent leak.
async function stage(w, key, value) {
  const held = edit(key, value);
  await quiesce(w);
  return { held };
}

// The dangerous stagings: each opens a warn question naming its own key, and
// each carries the phrase the caption is built from — "minimum short buffer"
// for the engine attribute, "minimum buffer time" for the per-backend times.
const DANGEROUS = [
  { key: "short_buffer", value: "2", phrase: "minimum short buffer" },
  { key: "alsa_period", value: -1, phrase: "minimum buffer time" },
  { key: "net_period", value: -5, phrase: "minimum buffer time" },
];

for (const { key, value } of DANGEROUS) {
  test(`a dangerous ${key.replaceAll("_", " ")} opens a warn question`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    assert.equal(question.value?.kind, "warn");
    cancel();
    await held;
  });
}

for (const { key, value } of DANGEROUS) {
  test(`the ${key.replaceAll("_", " ")} warning names its own key as owner`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    assert.equal(question.value?.owner, key);
    cancel();
    await held;
  });
}

for (const { key, value, phrase } of DANGEROUS) {
  test(`the ${key.replaceAll("_", " ")} warning says "${phrase}"`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    assert.ok(String(question.value?.message).includes(phrase));
    cancel();
    await held;
  });
}

for (const { key, value } of DANGEROUS) {
  test(`a dangerous ${key.replaceAll("_", " ")} does not stage while its question is open`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    assert.equal(key in w.staged.http, false);
    cancel();
    await held;
  });
}

for (const { key, value } of DANGEROUS) {
  test(`confirming the ${key.replaceAll("_", " ")} warning stages the edit`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    answer();
    await held;
    await quiesce(w);
    assert.equal(String(w.staged.http[key]), String(value));
  });
}

for (const { key, value } of DANGEROUS) {
  test(`cancelling the ${key.replaceAll("_", " ")} warning stages nothing`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    cancel();
    await held;
    await quiesce(w);
    assert.deepEqual(w.staged, { live: {}, http: {} });
  });
}

test("a cancelled buffer warning leaves lastApply untouched", async () => {
  const w = await reset();
  const before = lastApply.value;
  const { held } = await stage(w, "short_buffer", "2");
  cancel();
  await held;
  await quiesce(w);
  assert.equal(lastApply.value, before);
});

// The safe values of the same keys: short_buffer at Normal or Short, buffer
// time at default (0) or any positive milliseconds, stage straight through.
const SAFE = [
  { key: "short_buffer", value: "0" },
  { key: "short_buffer", value: "1" },
  { key: "alsa_period", value: 0 },
  { key: "alsa_period", value: 250 },
  { key: "net_period", value: 0 },
  { key: "net_period", value: 120 },
];

for (const { key, value } of SAFE) {
  test(`a safe ${key.replaceAll("_", " ")} of ${value} stages immediately`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    assert.equal(key in w.staged.http, true);
    cancel();
    await held;
  });
}

for (const { key, value } of SAFE) {
  test(`a safe ${key.replaceAll("_", " ")} of ${value} opens no question`, async () => {
    const w = await reset();
    const { held } = await stage(w, key, value);
    assert.equal(question.value, null);
    cancel();
    await held;
  });
}

// --- the askWarn primitive itself ----------------------------------------------
// True only on explicit confirm; cancel and supersession both read as declined.

test("askWarn resolves confirmed on an explicit answer", async () => {
  await reset();
  const p = askWarn("short_buffer", "minimum short buffer");
  answer();
  assert.ok(await p);
});

test("askWarn resolves declined on cancel", async () => {
  await reset();
  const p = askWarn("short_buffer", "minimum short buffer");
  cancel();
  assert.ok(!(await p));
});

test("a superseding question resolves a pending askWarn as declined", async () => {
  await reset();
  const p = askWarn("short_buffer", "minimum short buffer");
  askConfirm("pending", "Replace the staged set?");
  const verdict = await p;
  cancel();
  assert.ok(!verdict);
});

// The one-question-at-a-time contract, end to end: a question opened over a
// pending buffer warning declines the guard, so the dangerous edit never lands.
test("a question opened over a pending buffer warning stages nothing", async () => {
  const w = await reset();
  const { held } = await stage(w, "short_buffer", "2");
  askConfirm("pending", "Replace the staged set?");
  await held;
  await quiesce(w);
  cancel();
  assert.deepEqual(w.staged, { live: {}, http: {} });
});
