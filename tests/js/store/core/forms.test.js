import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { inFlight } from "../../../../hqptuner/static/store/core/ops.js";
import { engineRestarting } from "../../../../hqptuner/static/store/enginewrite.js";
import {
  BASE,
  HEALTH_PATH,
  READBACK,
  STANDING_GENERATION,
  draft,
  failingAfter,
  healthWire,
  lineErrors,
  pending,
  resetForm,
  settled,
} from "../../support/forms/formdraft.js";

const WRITE_DONE = "write done";

afterEach(resetForm);

// Break: apply posts before the form is read, or never posts after it is read.
test("test_apply_only_writes_after_a_base_has_loaded", async () => {
  const load = pending();
  /** @type {unknown[]} */
  const writes = [];
  const item = await draft({
    load: () => load.promise,
    write: async (values) => {
      writes.push(values.gain);
    },
  });
  item.set("gain", 4);
  await item.apply();
  const before = [...writes];
  load.resolve(BASE);
  await settled();
  await item.apply();
  assert.deepEqual([before, writes], [[], [4]]);
});

// Break: differs uses strict identity, ignores keys, or stops reacting to set.
test("test_differs_uses_posted_text_and_the_requested_keys", async () => {
  const item = await draft();
  item.set("gain", "2");
  item.set("delay", 9);
  item.set("outside", 10);
  const seen = [item.differs.value];
  item.set("gain", "4");
  seen.push(item.differs.value);
  assert.deepEqual(seen, [["delay"], ["gain", "delay"]]);
});

// Break: discard leaves the user's edits active.
test("test_discard_abandons_the_entered_edits", async () => {
  const item = await draft();
  item.set("gain", 4);
  const seen = [item.values.value.gain];
  item.discard();
  seen.push(item.values.value.gain);
  assert.deepEqual(seen, [4, undefined]);
});

// Break: successful apply keeps the pre-write File reading as base.
test("test_successful_apply_reloads_the_file_base", async () => {
  let reading = BASE;
  const item = await draft({
    load: async () => reading,
    write: async () => {
      reading = READBACK;
    },
  });
  const seen = [item.base.value];
  item.set("gain", 4);
  await item.apply();
  seen.push(item.base.value);
  assert.deepEqual(seen, [BASE, READBACK]);
});

// Break: busy drops when write finishes before the readback has landed.
test("test_busy_covers_write_and_readback", async () => {
  const readback = pending();
  let loadingReadback = false;
  const item = await draft({
    load: () => (loadingReadback ? readback.promise : Promise.resolve(BASE)),
    write: async () => {
      loadingReadback = true;
    },
  });
  item.set("gain", 4);
  const seen = [item.busy.value];
  const run = item.apply();
  await settled();
  seen.push(item.busy.value);
  readback.resolve(READBACK);
  await run;
  seen.push(item.busy.value);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: the form uses a local busy flag without registering an engine op.
test("test_form_apply_marks_the_engine_inflight", async () => {
  const write = pending();
  const item = await draft({ write: () => write.promise });
  item.set("gain", 4);
  const seen = [inFlight.value];
  const run = item.apply();
  seen.push(inFlight.value);
  write.resolve({});
  await run;
  seen.push(inFlight.value);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: a write failure clears edits or rejects instead of settling.
test("test_failed_apply_keeps_every_edit", async () => {
  const item = await draft({
    write: async () => {
      throw new Error("fixture write refusal");
    },
  });
  item.set("gain", 4);
  item.set("delay", 9);
  await item.apply();
  assert.deepEqual(item.values.value, { gain: 4, delay: 9 });
});

// Break: a failed write reloads the File despite the failure.
test("test_failed_apply_keeps_the_previous_file_reading", async () => {
  let reading = BASE;
  const item = await draft({
    load: async () => reading,
    write: async () => {
      throw new Error("fixture refused");
    },
  });
  reading = READBACK;
  item.set("gain", 4);
  await item.apply();
  assert.equal(item.base.value, BASE);
});

// Break: the draft error is disconnected from its operation's failure.
test("test_draft_error_follows_failure_and_recovery", async () => {
  const error = new Error("fixture failed apply");
  let refuse = true;
  const item = await draft({
    write: async () => {
      if (refuse) throw error;
    },
  });
  item.set("gain", 4);
  await item.apply();
  const seen = [item.error.value];
  refuse = false;
  await item.apply();
  seen.push(item.error.value);
  assert.deepEqual(seen, [error, null]);
});

// Break: a draft's failure never reaches its alert area.
test("test_failed_apply_reaches_its_alert_area", async () => {
  const error = new Error("fixture alert failure");
  const item = await draft({
    write: async () => {
      throw error;
    },
  });
  item.set("gain", 4);
  await item.apply();
  assert.deepEqual(lineErrors(), [error]);
});

// Break: success retains submitted edits, or clears a newer edit too.
test("test_success_clears_only_edits_still_equal_to_the_submission", async () => {
  const write = pending();
  const item = await draft({ write: () => write.promise });
  item.set("gain", 4);
  item.set("delay", 9);
  const run = item.apply();
  item.set("gain", "4");
  item.set("delay", 13);
  write.resolve({});
  await run;
  assert.deepEqual(item.values.value, { delay: 13 });
});

// Break: later edits mutate the object already handed to write.
test("test_write_receives_a_snapshot_of_the_submitted_edits", async () => {
  const write = pending();
  /** @type {Record<string, unknown> | undefined} */
  let submitted;
  const item = await draft({
    write: (values) => {
      submitted = values;
      return write.promise;
    },
  });
  item.set("gain", 4);
  const run = item.apply();
  item.set("gain", 8);
  write.resolve({});
  await run;
  assert.equal(submitted?.gain, 4);
});

// Break: apply calls write directly instead of inside enginewrite.js duringEngineWrite, so the page never dims.
test("test_form_apply_dims_the_page_for_the_engine_restart", async () => {
  healthWire([]);
  const item = await draft();
  item.set("gain", 4);
  /** @type {boolean[]} */
  const seen = [];
  const stop = engineRestarting.subscribe((/** @type {unknown} */ v) => seen.push(Boolean(v)));
  await item.apply();
  stop();
  assert.ok(seen.includes(true), JSON.stringify(seen));
});

// Break: apply skips duringEngineWrite, so no health read follows the form's write.
test("test_form_apply_reads_health_back_after_the_write", async () => {
  /** @type {string[]} */
  const log = [];
  healthWire(log);
  health.value = { phase: "Ready", generation: STANDING_GENERATION };
  const item = await draft({
    write: async () => {
      log.push(WRITE_DONE);
    },
  });
  item.set("gain", 4);
  await item.apply();
  try {
    assert.ok(log.lastIndexOf(HEALTH_PATH) > log.indexOf(WRITE_DONE), JSON.stringify(log));
  } finally {
    health.value = null;
    await settled();
  }
});

// Break: the readback runs inside the apply's op run, so a refused readback after a confirmed write lands on the line.
test("test_failed_readback_after_a_successful_write_puts_nothing_on_the_alert_line", async () => {
  const reading = failingAfter();
  const item = await draft({ load: reading.load, write: async () => reading.fail() });
  item.set("gain", 4);
  await item.apply();
  assert.deepEqual(lineErrors(), []);
});

/**
 * A draft whose readback after a write waits on the test: `asked` resolves when the readback is requested, and
 * `answer` lands it.
 */
async function heldReadback() {
  const readback = pending();
  /** @type {() => void} */
  let markAsked = () => {};
  const asked = new Promise((done) => {
    markAsked = () => done(undefined);
  });
  let written = false;
  const item = await draft({
    load: () => {
      if (!written) return Promise.resolve(BASE);
      markAsked();
      return readback.promise;
    },
    write: async () => {
      written = true;
    },
  });
  return { item, asked, answer: readback.resolve };
}

// Break: stale is never raised after a write, or is not lowered when the readback lands.
test("test_stale_marks_the_values_from_write_success_until_the_readback_lands", async () => {
  const { item, asked, answer } = await heldReadback();
  item.set("gain", 4);
  const seen = [item.stale?.value];
  const run = item.apply();
  await asked;
  await settled();
  seen.push(item.stale?.value);
  answer(READBACK);
  await run;
  seen.push(item.stale?.value);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: a write clears base, so the form shows nothing while the readback is outstanding.
test("test_base_keeps_the_last_reading_while_the_readback_is_outstanding", async () => {
  const { item, asked, answer } = await heldReadback();
  item.set("gain", 4);
  const run = item.apply();
  await asked;
  await settled();
  const shown = item.base.value;
  answer(READBACK);
  await run;
  assert.equal(shown, BASE);
});

// Break: a failed readback clears base instead of leaving the last reading shown.
test("test_failed_readback_keeps_the_last_reading_as_base", async () => {
  const reading = failingAfter();
  const item = await draft({ load: reading.load, write: async () => reading.fail() });
  item.set("gain", 4);
  await item.apply();
  assert.equal(item.base.value, BASE);
});

// Break: a failed readback lowers stale, presenting the pre-write reading as current.
test("test_failed_readback_leaves_the_values_marked_stale", async () => {
  const reading = failingAfter();
  const item = await draft({ load: reading.load, write: async () => reading.fail() });
  item.set("gain", 4);
  await item.apply();
  assert.equal(item.stale?.value, true);
});

// Break: apply resolves to nothing, or to the write's own result, instead of reporting that the write landed.
test("test_apply_resolves_true_when_the_write_lands", async () => {
  const item = await draft();
  item.set("gain", 4);
  assert.equal(await item.apply(), true);
});

// Break: apply reports the readback's outcome instead of the write's, so a refused readback reads as a failed write.
test("test_apply_resolves_true_when_the_write_lands_but_its_readback_fails", async () => {
  const reading = failingAfter();
  const item = await draft({ load: reading.load, write: async () => reading.fail() });
  item.set("gain", 4);
  assert.equal(await item.apply(), true);
});

// Break: apply resolves to nothing, or to the op's FAILED sentinel, when the write is refused.
test("test_apply_resolves_false_when_the_write_fails", async () => {
  const item = await draft({
    write: async () => {
      throw new Error("fixture write refusal");
    },
  });
  item.set("gain", 4);
  assert.equal(await item.apply(), false);
});

// Break: apply returns without a verdict when no File reading has landed to apply against.
test("test_apply_resolves_false_before_the_form_has_been_read", async () => {
  const load = pending();
  const item = await draft({ load: () => load.promise });
  item.set("gain", 4);
  const result = await item.apply();
  load.resolve(BASE);
  await settled();
  assert.equal(result, false);
});
