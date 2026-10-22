import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { effect } from "@preact/signals";
import * as ops from "../../../../hqptuner/static/store/core/ops.js";

/** @type {ReturnType<typeof ops.op>[]} */
const opened = [];

/** @param {string} kind @param {{ engine?: boolean, alert?: string | null }} [options] */
function operation(kind, options) {
  const item = ops.op(kind, options);
  opened.push(item);
  return item;
}

function pending() {
  /** @type {(value: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** @param {unknown} error */
function throwing(error) {
  return () => {
    throw error;
  };
}

/** @param {string} area */
function errorsAt(area) {
  return ops.failures.value.filter((entry) => entry.area === area).map((entry) => entry.error);
}

afterEach(() => {
  for (const item of opened.splice(0)) item.clear();
});

// Break: resolving run discards the callback's result.
for (const result of [undefined, null, 37, { saved: "fixture" }]) {
  test(`test_run_preserves_successful_result_${JSON.stringify(result)}`, async () => {
    const item = operation("fixture-result");
    assert.equal(await item.run(async () => result), result);
  });
}

// Break: busy stays false until the callback settles, or never resets.
test("test_busy_signal_covers_only_the_pending_run", async () => {
  const item = operation("fixture-busy");
  const deferred = pending();
  const states = [item.busy.value];
  const run = item.run(() => deferred.promise);
  states.push(item.busy.value);
  deferred.resolve(17);
  await run;
  states.push(item.busy.value);
  assert.deepEqual(states, [false, true, false]);
});

// Break: busy is a plain value holder that cannot notify subscribers.
test("test_busy_notifies_signal_consumers", async () => {
  const item = operation("fixture-reactive-busy");
  const deferred = pending();
  /** @type {boolean[]} */
  const seen = [];
  const dispose = effect(() => {
    seen.push(item.busy.value);
  });
  try {
    const run = item.run(() => deferred.promise);
    deferred.resolve(9);
    await run;
    assert.deepEqual(seen, [false, true, false]);
  } finally {
    dispose();
  }
});

// Break: run lets a callback exception escape or resolves to its error.
for (const mode of ["throw", "reject"]) {
  test(`test_${mode}_resolves_failed_without_rejection`, async () => {
    const item = operation("fixture-failed");
    const error = new Error("fixture failure");
    const fn =
      mode === "throw"
        ? throwing(error)
        : async () => {
            throw error;
          };
    const success = 61;
    const outcomes = [await item.run(async () => success), await item.run(fn)];
    assert.deepEqual(outcomes, [success, ops.FAILED]);
  });
}

// Break: failures stringify the thrown value rather than retain it.
for (const error of [new Error("fixture object"), { code: "fixture-refusal" }, 0]) {
  test(`test_error_signal_retains_thrown_value_${String(error)}`, async () => {
    const item = operation("fixture-error");
    await item.run(throwing(error));
    assert.equal(item.error.value, error);
  });
}

// Break: error changes fail to notify subscribers, or success leaves it set.
test("test_error_signal_notifies_failure_and_success", async () => {
  const item = operation("fixture-reactive-error");
  const error = new Error("fixture reactive failure");
  /** @type {unknown[]} */
  const seen = [];
  const dispose = effect(() => {
    seen.push(item.error.value);
  });
  try {
    await item.run(throwing(error));
    await item.run(async () => 12);
    assert.deepEqual(seen, [null, error, null]);
  } finally {
    dispose();
  }
});

// Break: clear removes the alert but retains the local error signal.
test("test_clear_removes_local_error", async () => {
  const item = operation("fixture-clear");
  const error = new Error("fixture clear failure");
  await item.run(throwing(error));
  const seen = [item.error.value];
  item.clear();
  seen.push(item.error.value);
  assert.deepEqual(seen, [error, null]);
});

// Break: the default alert area is omitted or uses a fixed area.
test("test_failure_defaults_to_its_kind_as_alert_area", async () => {
  const kind = "fixture-default-area";
  const error = new Error("fixture default area failure");
  await operation(kind).run(throwing(error));
  assert.deepEqual(errorsAt(kind), [error]);
});

// Break: two ops targeting one area create duplicate alert lines.
test("test_shared_area_has_one_failure_line", async () => {
  const first = new Error("fixture first");
  const second = new Error("fixture second");
  await operation("fixture-area-a", { alert: "apply" }).run(throwing(first));
  await operation("fixture-area-b", { alert: "apply" }).run(throwing(second));
  assert.deepEqual(
    ops.failures.value.map((entry) => entry.area),
    ["apply"],
  );
});

// Break: success clears only its own op, leaving its shared area's failure.
test("test_success_clears_other_ops_failure_in_same_area", async () => {
  const error = new Error("fixture shared failure");
  await operation("fixture-shared-a", { alert: "live" }).run(throwing(error));
  const seen = [errorsAt("live")];
  await operation("fixture-shared-b", { alert: "live" }).run(async () => 8);
  seen.push(errorsAt("live"));
  assert.deepEqual(seen, [[error], []]);
});

// Break: tapping clear only clears the op that received the tap.
test("test_clear_clears_other_ops_failure_in_same_area", async () => {
  const error = new Error("fixture tapped failure");
  await operation("fixture-tap-a", { alert: "snapshot" }).run(throwing(error));
  const seen = [errorsAt("snapshot")];
  operation("fixture-tap-b", { alert: "snapshot" }).clear();
  seen.push(errorsAt("snapshot"));
  assert.deepEqual(seen, [[error], []]);
});

// Break: a success wipes failures belonging to unrelated areas.
test("test_success_preserves_another_areas_failure", async () => {
  const error = new Error("fixture unrelated failure");
  await operation("fixture-unrelated", { alert: "favorite" }).run(throwing(error));
  await operation("fixture-success", { alert: "description" }).run(async () => 1);
  assert.deepEqual(errorsAt("favorite"), [error]);
});

// Break: alert null is replaced with the kind and leaks onto alert lines.
test("test_alert_null_keeps_failure_off_alert_lines", async () => {
  const error = new Error("fixture visible failure");
  await operation("fixture-visible", { alert: "narrowing" }).run(throwing(error));
  await operation("fixture-local", { alert: null }).run(throwing(new Error("fixture local failure")));
  assert.deepEqual(
    ops.failures.value.map((entry) => entry.error),
    [error],
  );
});

// Break: a non-engine op marks inFlight, or an engine op fails to mark it.
test("test_inflight_tracks_engine_writes_only", async () => {
  const local = pending();
  const engine = pending();
  const localRun = operation("fixture-local-flight").run(() => local.promise);
  const seen = [ops.inFlight.value];
  const engineRun = operation("fixture-engine-flight", { engine: true }).run(() => engine.promise);
  seen.push(ops.inFlight.value);
  engine.resolve(10);
  await engineRun;
  seen.push(ops.inFlight.value);
  local.resolve(20);
  await localRun;
  assert.deepEqual(seen, [false, true, false]);
});

// Break: a per-call override is ignored or persists into the next default run.
for (const { engine, override, expected } of [
  { engine: true, override: false, expected: [false, true, false] },
  { engine: false, override: true, expected: [true, false, false] },
]) {
  test(`test_per_call_engine_override_preserves_op_default_${engine}`, async () => {
    const item = operation("fixture-per-call", { engine });
    const overridden = pending();
    const first = item.run(() => overridden.promise, { engine: override });
    const seen = [ops.inFlight.value];
    overridden.resolve(null);
    await first;
    const defaulted = pending();
    const second = item.run(() => defaulted.promise);
    seen.push(ops.inFlight.value);
    defaulted.resolve(null);
    await second;
    seen.push(ops.inFlight.value);
    assert.deepEqual(seen, expected);
  });
}

// Break: a read override enters engine flight while its callback rejects.
test("test_failed_read_does_not_enter_engine_flight", async () => {
  const item = operation("fixture-read-failure", { engine: true });
  const deferred = pending();
  const run = item.run(
    async () => {
      await deferred.promise;
      throw new Error("fixture read failure");
    },
    { engine: false },
  );
  const seen = [ops.inFlight.value];
  deferred.resolve(null);
  await run;
  seen.push(ops.inFlight.value);
  assert.deepEqual(seen, [false, false]);
});

// Break: settling one engine op hides another engine op still in flight.
test("test_inflight_stays_set_until_all_engine_ops_settle", async () => {
  const first = pending();
  const second = pending();
  const a = operation("fixture-flight-a", { engine: true }).run(() => first.promise);
  const b = operation("fixture-flight-b", { engine: true }).run(() => second.promise);
  first.resolve(1);
  await a;
  const seen = [ops.inFlight.value];
  second.resolve(2);
  await b;
  seen.push(ops.inFlight.value);
  assert.deepEqual(seen, [true, false]);
});

// Break: an exception leaves the engine busy forever.
test("test_failed_engine_write_releases_inflight", async () => {
  const item = operation("fixture-failed-flight", { engine: true });
  const deferred = pending();
  const run = item.run(async () => {
    await deferred.promise;
    throw new Error("fixture flight failure");
  });
  const seen = [ops.inFlight.value];
  deferred.resolve(null);
  await run;
  seen.push(ops.inFlight.value);
  assert.deepEqual(seen, [true, false]);
});

// Break: latest discards the newest result or never discards an older one.
for (const olderFinishesFirst of [true, false]) {
  test(`test_latest_suppresses_older_result_${olderFinishesFirst}`, async () => {
    const accept = ops.latest();
    const older = pending();
    const newer = pending();
    const first = accept(older.promise);
    const second = accept(newer.promise);
    if (olderFinishesFirst) {
      older.resolve(13);
      await first;
      newer.resolve(29);
    } else {
      newer.resolve(29);
      await second;
      older.resolve(13);
    }
    assert.deepEqual(await Promise.all([first, second]), [ops.STALE, 29]);
  });
}

// Break: latest factories share a sequence and invalidate unrelated writes.
test("test_latest_instances_are_independent", async () => {
  const first = ops.latest();
  const second = ops.latest();
  const deferred = pending();
  const run = first(deferred.promise);
  await second(Promise.resolve(44));
  deferred.resolve(73);
  assert.equal(await run, 73);
});

// Break: op ignores the LEADS table or uses one fixed lead for every kind.
for (const [kind, lead] of [
  ["fixture-lead-a", "fixture lead alpha"],
  ["fixture-lead-b", "fixture lead beta"],
]) {
  test(`test_lead_comes_from_kind_lookup_${kind}`, () => {
    ops.LEADS[kind] = lead;
    try {
      assert.equal(operation(kind).lead, lead);
    } finally {
      delete ops.LEADS[kind];
    }
  });
}

// Break: a missing kind inherits a lead from another table entry.
test("test_missing_kind_has_no_lead", () => {
  const kind = "fixture-known-lead";
  ops.LEADS[kind] = "fixture known lead";
  try {
    assert.equal(operation("fixture-absent-lead").lead, null);
  } finally {
    delete ops.LEADS[kind];
  }
});
