import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { inFlight } from "../../../../hqptuner/static/store/core/ops.js";
import {
  BASE,
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

afterEach(resetForm);

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

// Break: explicit refresh raises the form's busy while it reads, or marks an engine write.
test("test_explicit_reload_leaves_the_form_idle_without_marking_an_engine_write", async () => {
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
    [false, false],
    [false, false],
  ]);
});

// Break: the first File read raises the form's busy until it lands.
test("test_first_load_leaves_the_form_idle_while_it_reads", async () => {
  const load = pending();
  const item = await draft({ load: () => load.promise });
  const reading = item.busy.value;
  load.resolve(BASE);
  await settled();
  assert.equal(reading, false);
});

// Break: the read a generation move triggers raises the form's busy until it lands.
test("test_generation_reload_leaves_the_form_idle_while_it_reads", async () => {
  const generation = 111;
  health.value = { phase: "Ready", generation };
  const reload = pending();
  let initial = true;
  const item = await draft({ load: () => (initial ? Promise.resolve(BASE) : reload.promise) });
  initial = false;
  health.value = { phase: "Ready", generation: generation + 1 };
  await settled();
  const reading = item.busy.value;
  reload.resolve(READBACK);
  await settled();
  try {
    assert.equal(reading, false);
  } finally {
    health.value = null;
    await settled();
  }
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

// Break: the first load runs through the draft op, so its failure lands on the alert line.
test("test_failed_first_load_puts_nothing_on_the_alert_line", async () => {
  await draft({
    load: async () => {
      throw new Error("fixture first read refusal");
    },
  });
  assert.deepEqual(lineErrors(), []);
});

// Break: the generation reload runs through the draft op, so its success clears the apply failure showing.
test("test_successful_generation_reload_keeps_the_apply_failure_on_its_line", async () => {
  const generation = 51;
  const error = new Error("fixture apply refusal");
  health.value = { phase: "Ready", generation };
  const item = await draft({
    write: async () => {
      throw error;
    },
  });
  item.set("gain", 4);
  await item.apply();
  health.value = { phase: "Ready", generation: generation + 1 };
  await settled();
  try {
    assert.deepEqual(lineErrors(), [error]);
  } finally {
    health.value = null;
    await settled();
  }
});

// Break: the generation reload runs through the draft op, so its failure lands on the alert line.
test("test_failed_generation_reload_puts_nothing_on_the_alert_line", async () => {
  const generation = 71;
  const reading = failingAfter();
  health.value = { phase: "Ready", generation };
  await draft({ load: reading.load });
  reading.fail();
  health.value = { phase: "Ready", generation: generation + 1 };
  await settled();
  try {
    assert.deepEqual(lineErrors(), []);
  } finally {
    health.value = null;
    await settled();
  }
});

// Break: stale ignores a failed generation reload, or stays raised after the next read lands.
test("test_stale_follows_whether_the_last_generation_reload_landed", async () => {
  const generation = 81;
  let refusing = false;
  health.value = { phase: "Ready", generation };
  const item = await draft({
    load: async () => {
      if (refusing) throw new Error("fixture reload refusal");
      return BASE;
    },
  });
  refusing = true;
  health.value = { phase: "Ready", generation: generation + 1 };
  await settled();
  const seen = [item.stale?.value];
  refusing = false;
  health.value = { phase: "Ready", generation: generation + 2 };
  await settled();
  seen.push(item.stale?.value);
  try {
    assert.deepEqual(seen, [true, false]);
  } finally {
    health.value = null;
    await settled();
  }
});

const EARLIER = { gain: 3, delay: 5 };
const OVERLAP_GENERATION = STANDING_GENERATION - 1;

/** A promise the test settles by hand, either way. */
function deferred() {
  /** @type {(value: Record<string, unknown>) => void} */
  let resolve = () => {};
  /** @type {(error: Error) => void} */
  let reject = () => {};
  /** @type {Promise<Record<string, unknown>>} */
  const promise = new Promise((done, refuse) => {
    resolve = done;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

/**
 * A load whose every call waits on the test: `calls[n]` is the n-th read the draft started, and `asked(n)` resolves
 * once that read has been started.
 */
function heldLoads() {
  /** @type {ReturnType<typeof deferred>[]} */
  const calls = [];
  /** @type {{ index: number, done: () => void }[]} */
  const waiting = [];
  return {
    calls,
    /** @param {number} index */
    asked: (index) =>
      new Promise((done) => {
        if (calls.length > index) done(undefined);
        else waiting.push({ index, done: () => done(undefined) });
      }),
    load: () => {
      const call = deferred();
      calls.push(call);
      for (const waiter of waiting) if (calls.length > waiter.index) waiter.done();
      return call.promise;
    },
  };
}

/** @param {Promise<unknown>} run */
async function landed(run) {
  await run.then(
    () => undefined,
    () => undefined,
  );
  await settled();
}

/**
 * A draft read once at BASE, then reloaded twice so that both reads are in flight: `earlier` was started first and
 * `later` after it, each with the `run` its reload returned.
 */
async function overlappingReloads() {
  const loads = heldLoads();
  const item = await draft({ load: loads.load });
  loads.calls[0].resolve(BASE);
  await settled();
  const earlierRun = item.reload();
  const laterRun = item.reload();
  await loads.asked(2);
  return {
    item,
    earlier: { ...loads.calls[1], run: earlierRun },
    later: { ...loads.calls[2], run: laterRun },
  };
}

// Break: base takes every read that lands, so the earlier read, landing last, overwrites the later one.
test("test_earlier_read_landing_after_the_later_one_leaves_the_later_reading_as_base", async () => {
  const { item, earlier, later } = await overlappingReloads();
  later.resolve(READBACK);
  await landed(later.run);
  earlier.resolve(EARLIER);
  await landed(earlier.run);
  assert.equal(item.base.value, READBACK);
});

// Break: a superseded read that fails raises stale over the later read that landed.
test("test_earlier_read_failing_after_the_later_one_landed_leaves_the_form_fresh", async () => {
  const { item, earlier, later } = await overlappingReloads();
  later.resolve(READBACK);
  await landed(later.run);
  earlier.reject(new Error("fixture superseded read refusal"));
  await landed(earlier.run);
  assert.equal(item.stale?.value, false);
});

// Break: the superseded read is only dropped once a later read has landed, so it lowers stale over a later failure.
test("test_earlier_read_landing_after_the_later_one_failed_leaves_the_form_stale", async () => {
  const { item, earlier, later } = await overlappingReloads();
  later.reject(new Error("fixture later read refusal"));
  await landed(later.run);
  earlier.resolve(EARLIER);
  await landed(earlier.run);
  assert.equal(item.stale?.value, true);
});

// Break: the superseded read is only dropped once a later read has landed, so it replaces base after a later failure.
test("test_earlier_read_landing_after_the_later_one_failed_keeps_the_last_reading_as_base", async () => {
  const { item, earlier, later } = await overlappingReloads();
  later.reject(new Error("fixture later read refusal"));
  await landed(later.run);
  earlier.resolve(EARLIER);
  await landed(earlier.run);
  assert.equal(item.base.value, BASE);
});

// Break: the generation reload and the readback after an apply are guarded apart, so the generation read, started
// first and landing last, overwrites the readback.
test("test_generation_read_landing_after_the_apply_readback_leaves_the_readback_as_base", async () => {
  healthWire([]);
  health.value = { phase: "Ready", generation: OVERLAP_GENERATION };
  const loads = heldLoads();
  const item = await draft({ load: loads.load });
  loads.calls[0].resolve(BASE);
  await settled();
  health.value = { phase: "Ready", generation: STANDING_GENERATION };
  await loads.asked(1);
  item.set("gain", 4);
  const run = item.apply();
  await loads.asked(2);
  loads.calls[2].resolve(READBACK);
  await landed(run);
  loads.calls[1].resolve(EARLIER);
  await settled();
  await settled();
  try {
    assert.equal(item.base.value, READBACK);
  } finally {
    health.value = null;
    await settled();
  }
});
