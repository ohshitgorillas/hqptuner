// Once a form's write has landed, the edits that write sent stop showing as pending as soon as any reading of the
// form lands after it: the apply's own readback, a reload that overtakes it, or a generation reload. An edit made
// after the submit is kept.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { formDraft } from "../../../../hqptuner/static/store/core/forms.js";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { op } from "../../../../hqptuner/static/store/core/ops.js";
import { engineRestarting } from "../../../../hqptuner/static/store/enginewrite.js";
import { ok, stagingWire } from "../../support/wire/wire.js";

const FIRST_READING = { gain: 2, delay: 7 };
const SENT_GAIN = 4;
const LATER_DELAY = 13;
const NEWER_READING = { gain: 6, delay: 7 };
const OVERTAKEN_READING = { gain: 5, delay: 7 };
const KEPT = { delay: LATER_DELAY };
const AREA = "apply";
const HEALTH_PATH = "/api/health";
const GENERATION = 91;
const unwired = globalThis.fetch;

/** The generation the health wire answers with; a case moves it with `health.value`. */
let wireGeneration = GENERATION;

/** @param {number} generation */
function standAt(generation) {
  wireGeneration = generation;
  health.value = { phase: "Ready", generation };
}

/** A wire answering GET /api/health with a Ready reading at `wireGeneration`. */
function healthWire() {
  stagingWire({
    routes: (path) =>
      path.split("?")[0] === HEALTH_PATH
        ? ok({
            phase: "Ready",
            generation: wireGeneration,
            connected_at: "2026-10-25T10:00:00Z",
            credentials_ok: true,
            address_found: true,
          })
        : undefined,
  });
}

async function settled() {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

/**
 * Every read the form starts, held until the case answers it: `reads[n]` is the n-th read, `started(n)` resolves once
 * it has been asked for.
 */
function heldReads() {
  /** @type {{ answer: (value: Record<string, unknown>) => void, refuse: (error: Error) => void }[]} */
  const reads = [];
  /** @type {(() => void)[]} */
  const wakers = [];
  /** @returns {Promise<Record<string, unknown>>} */
  const load = () =>
    new Promise((answer, refuse) => {
      reads.push({ answer, refuse });
      for (const wake of wakers.splice(0)) wake();
    });
  /**
   * @param {number} index
   * @returns {Promise<void>}
   */
  const started = async (index) => {
    while (reads.length <= index) await new Promise((wake) => wakers.push(() => wake(undefined)));
  };
  return { reads, load, started };
}

/** @param {Promise<unknown>} run */
async function finished(run) {
  await run.catch(() => undefined);
  await settled();
}

/**
 * A form read once at FIRST_READING, with SENT_GAIN applied and LATER_DELAY entered after the submit; resolves once
 * the write has landed and the apply's own readback has been asked for, still unanswered.
 */
async function appliedForm() {
  healthWire();
  standAt(GENERATION);
  const held = heldReads();
  const item = formDraft({ load: held.load, write: async () => undefined, keys: ["gain", "delay"], area: AREA });
  await held.started(0);
  held.reads[0].answer(FIRST_READING);
  await settled();
  item.set("gain", SENT_GAIN);
  const run = item.apply();
  item.set("delay", LATER_DELAY);
  await held.started(1);
  return { item, run, held, readback: held.reads[1] };
}

afterEach(async () => {
  op(AREA).clear();
  engineRestarting.value = false;
  globalThis.fetch = unwired;
  health.value = null;
  await settled();
});

// Break: the sent edits are cleared only where the apply's own readback lands, so a reload landing first leaves them.
test("test_reload_overtaking_the_apply_readback_drops_the_sent_edit", async () => {
  const { item, run, held, readback } = await appliedForm();
  const reload = item.reload();
  await held.started(2);
  held.reads[2].answer(NEWER_READING);
  await finished(reload);
  const shown = { ...item.values.value };
  readback.answer(OVERTAKEN_READING);
  await finished(run);
  assert.deepEqual(shown, KEPT);
});

// Break: the sent edits are held aside while the readback is out and put back when the superseded readback is dropped.
test("test_overtaken_apply_readback_landing_late_does_not_bring_the_sent_edit_back", async () => {
  const { item, run, held, readback } = await appliedForm();
  const reload = item.reload();
  await held.started(2);
  held.reads[2].answer(NEWER_READING);
  await finished(reload);
  readback.answer(OVERTAKEN_READING);
  await finished(run);
  assert.deepEqual(item.values.value, KEPT);
});

// Break: the sent edits are cleared only where the apply's own readback lands, so a generation reload landing first
// leaves them.
test("test_generation_reload_overtaking_the_apply_readback_drops_the_sent_edit", async () => {
  const { item, run, held, readback } = await appliedForm();
  standAt(GENERATION + 1);
  await held.started(2);
  held.reads[2].answer(NEWER_READING);
  await settled();
  const shown = { ...item.values.value };
  readback.answer(OVERTAKEN_READING);
  await finished(run);
  assert.deepEqual(shown, KEPT);
});

// Break: a refused readback forgets which edits the write sent, so the next reload treats them as waiting to apply.
test("test_reload_after_a_refused_apply_readback_drops_the_sent_edit", async () => {
  const { item, run, held, readback } = await appliedForm();
  readback.refuse(new Error("fixture readback refusal"));
  await finished(run);
  const reload = item.reload();
  await held.started(2);
  held.reads[2].answer(NEWER_READING);
  await finished(reload);
  assert.deepEqual(item.values.value, KEPT);
});

// Break: a refused readback forgets which edits the write sent, so the next generation reload treats them as waiting
// to apply.
test("test_generation_reload_after_a_refused_apply_readback_drops_the_sent_edit", async () => {
  const { item, run, held, readback } = await appliedForm();
  readback.refuse(new Error("fixture readback refusal"));
  await finished(run);
  standAt(GENERATION + 1);
  await held.started(2);
  held.reads[2].answer(NEWER_READING);
  await settled();
  assert.deepEqual(item.values.value, KEPT);
});
