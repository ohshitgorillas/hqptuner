import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { formDraft } from "../../../../hqptuner/static/store/core/forms.js";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { failures, inFlight, op } from "../../../../hqptuner/static/store/core/ops.js";

const BASE = { gain: 2, delay: 7 };
const READBACK = { gain: 4, delay: 11 };
const KEYS = ["gain", "delay"];
const AREA = "apply";

function pending() {
  /** @type {(value: Record<string, unknown>) => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settled() {
  await Promise.resolve();
  await Promise.resolve();
}

/** @param {Partial<Parameters<typeof formDraft>[0]>} [options] */
async function draft(options = {}) {
  const item = formDraft({
    load: async () => BASE,
    write: async () => undefined,
    keys: KEYS,
    area: AREA,
    ...options,
  });
  await settled();
  return item;
}

afterEach(() => {
  op(AREA).clear();
});

// Break: removing one edit leaves it held or discards another field's edit.
test("test_removed_edit_follows_reload_without_discarding_other_edits", async () => {
  let reading = BASE;
  const item = await draft({ load: async () => reading });
  item.set("gain", 4);
  item.set("delay", 13);
  const seen = [item.differs.value];
  item.remove("gain");
  reading = READBACK;
  await item.reload();
  seen.push(item.differs.value);
  reading = { gain: 6, delay: 13 };
  await item.reload();
  seen.push(item.differs.value);
  assert.deepEqual(seen, [["gain", "delay"], ["delay"], []]);
});

// Break: explicit refresh retains the old base or discards the user's edits.
test("test_explicit_reload_preserves_edits_against_each_new_file_reading", async () => {
  let reading = BASE;
  const item = await draft({ load: async () => reading });
  item.set("gain", 4);
  const seen = [item.differs.value];
  reading = READBACK;
  await item.reload();
  seen.push(item.differs.value);
  reading = { gain: 6, delay: 11 };
  await item.reload();
  seen.push(item.differs.value);
  assert.deepEqual(seen, [["gain"], [], ["gain"]]);
});

// Break: explicit refresh bypasses the form's read lifecycle or marks an engine write.
test("test_explicit_reload_is_busy_without_marking_an_engine_write", async () => {
  const refreshed = pending();
  let initial = true;
  const item = await draft({ load: () => (initial ? Promise.resolve(BASE) : refreshed.promise) });
  initial = false;
  const seen = [[item.busy.value, inFlight.value]];
  const run = item.reload();
  seen.push([item.busy.value, inFlight.value]);
  refreshed.resolve(READBACK);
  await run;
  seen.push([item.busy.value, inFlight.value]);
  assert.deepEqual(seen, [
    [false, false],
    [true, false],
    [false, false],
  ]);
});

// Break: the first load is skipped or base is populated before it resolves.
test("test_base_becomes_the_first_completed_file_read", async () => {
  const load = pending();
  const item = await draft({ load: () => load.promise });
  const seen = [item.base.value];
  load.resolve(BASE);
  await settled();
  seen.push(item.base.value);
  assert.deepEqual(seen, [null, BASE]);
});

// Break: set drops edits made before the first File reading.
test("test_initial_read_preserves_edits_already_entered", async () => {
  const load = pending();
  const item = await draft({ load: () => load.promise });
  item.set("gain", 4);
  load.resolve(BASE);
  await settled();
  assert.equal(item.values.value.gain, 4);
});

// Break: a draft reports differences against an absent base.
test("test_differs_waits_for_a_base_then_observes_the_edit", async () => {
  const load = pending();
  const item = await draft({ load: () => load.promise });
  item.set("gain", 4);
  const seen = [item.differs.value];
  load.resolve(BASE);
  await settled();
  seen.push(item.differs.value);
  assert.deepEqual(seen, [[], ["gain"]]);
});

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

// Break: the initial standalone load participates in engine flight.
test("test_initial_load_keeps_engine_inflight_clear", async () => {
  const load = pending();
  await draft({ load: () => load.promise });
  const seen = [inFlight.value];
  load.resolve(BASE);
  await settled();
  seen.push(inFlight.value);
  assert.deepEqual(seen, [false, false]);
});

// Break: a generation-triggered standalone load participates in engine flight.
test("test_generation_load_keeps_engine_inflight_clear", async () => {
  const generation = 101;
  health.value = { phase: "Ready", generation };
  const reload = pending();
  let initial = true;
  await draft({ load: () => (initial ? Promise.resolve(BASE) : reload.promise) });
  initial = false;
  health.value = { phase: "Ready", generation: generation + 1 };
  await settled();
  const seen = [inFlight.value];
  reload.resolve(READBACK);
  await settled();
  seen.push(inFlight.value);
  try {
    assert.deepEqual(seen, [false, false]);
  } finally {
    health.value = null;
    await settled();
  }
});

// Break: an initial load failure is swallowed without reaching the draft error.
test("test_initial_load_failure_is_exposed_by_the_draft", async () => {
  const error = new Error("fixture load refusal");
  const item = await draft({
    load: async () => {
      throw error;
    },
  });
  assert.equal(item.error.value, error);
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
  assert.deepEqual(
    failures.value.filter((entry) => entry.area === AREA).map((entry) => entry.error),
    [error],
  );
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

// Break: generation moves leave the old base in place or overwrite user edits.
test("test_generation_reload_preserves_edits_against_the_new_file_base", async () => {
  health.value = { phase: "Ready", generation: 41 };
  let reading = BASE;
  const item = await draft({ load: async () => reading });
  item.set("gain", 4);
  const seen = [item.differs.value];
  reading = { gain: 4, delay: 11 };
  health.value = { phase: "Ready", generation: 42 };
  await settled();
  seen.push(item.differs.value);
  reading = { gain: 6, delay: 11 };
  health.value = { phase: "Ready", generation: 43 };
  await settled();
  seen.push(item.differs.value);
  try {
    assert.deepEqual(seen, [["gain"], [], ["gain"]]);
  } finally {
    health.value = null;
    await settled();
  }
});
