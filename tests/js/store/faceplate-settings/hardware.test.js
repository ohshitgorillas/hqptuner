// Behavioral suite for hqptuner/static/store/faceplate/settings/hardware.js: the hardware settings' own form. The six
// engine attributes are read from the daemon into a base and a draft, edited in the draft, read back as whether the
// draft differs from the base, sent through the engine's own POST and re-based only on a verified apply, and put back by
// a discard. The all-stations switch rides the POST and never stages.
//
// The wire is the seam: `GET /api/engine` answers the engine table a case hands the fake, and `POST /api/engine`
// records the body it was handed and answers the report the case chose. The draft is reset through `discardHardware`,
// the switch through `setAllStations`, and the base through a fresh load on every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-settings/hardware.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  HARDWARE_KEYS,
  allStations,
  applyHardware,
  discardHardware,
  hardwareDraft,
  loadHardware,
  setAllStations,
  setHardware,
  staged,
} from "../../../../hqptuner/static/store/faceplate/settings/hardware.js";
import { failures, inFlight, op } from "../../../../hqptuner/static/store/core/ops.js";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { heldReadbackWire, turn, until } from "../../support/rendered/stalemark.js";
import { bad, ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/**
 * @typedef {Record<string, string | number>} EngineTable  the engine attributes as `GET /api/engine` carries them
 * @typedef {{ overrides: Record<string, unknown>, all_presets: unknown }} ApplyBody  a `POST /api/engine` body
 */

//: The engine as the daemon reports it, every attribute off the daemon's default.
const ENGINE = { cuda: "1", multicore: "0", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

//: The same engine with `multicore` absent from its config.
const NO_MULTICORE = { cuda: "1", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

//: The same engine with `nblocks` carried as a JSON number.
const NUMERIC_NBLOCKS = { ...ENGINE, nblocks: 4 };

//: The engine as read back after a write that landed `ecores: "filter"`, the restore having also moved `cuda_cdev`.
const READBACK = { ...ENGINE, ecores: "filter", cuda_cdev: "-1" };

//: The engine as read after a restart, every attribute but `ecores` and `cuda` as before.
const RESTARTED = { ...ENGINE, cuda: "0", ecores: "default" };

//: The alert line a failed hardware apply reports on.
const APPLY_LINE = "apply";

/**
 * A daemon answering the engine's read with `engine` and its write with `report`; returns the write bodies it was
 * handed and the wire, to wait on.
 *
 * @param {{ engine?: EngineTable, report?: unknown }} [d]
 */
function daemon({ engine = ENGINE, report = { verified: { applied: true } } } = {}) {
  /** @type {ApplyBody[]} */
  const bodies = [];
  const wire = stagingWire({
    routes: (path, opts) => {
      if (path !== "/api/engine") return undefined;
      if (opts.method !== "POST") return ok({ engine });
      bodies.push(JSON.parse(String(opts.body)));
      return ok({ report });
    },
  });
  return { bodies, wire };
}

/**
 * Load the engine a daemon reports, over a draft and switch already reset.
 *
 * @param {{ engine?: EngineTable, report?: unknown }} [d]
 */
async function load(d) {
  const w = daemon(d);
  await loadHardware();
  return w;
}

/**
 * Apply the draft against a daemon answering `report`; returns the bodies it was handed.
 *
 * @param {unknown} report
 */
async function apply(report) {
  const { bodies, wire } = daemon({ report });
  await applyHardware();
  await quiesce(wire);
  return bodies;
}

beforeEach(async () => {
  daemon();
  discardHardware();
  setAllStations(false);
  await loadHardware();
  op(APPLY_LINE).clear();
});

// --- the keys and the daemon's defaults --------------------------------------------------------------------------

test("test_the_hardware_keys_are_the_six_engine_attributes", () => {
  assert.deepEqual([...HARDWARE_KEYS].sort(), ["cuda", "cuda_cdev", "cuda_dev", "ecores", "multicore", "nblocks"]);
});

// --- the load ----------------------------------------------------------------------------------------------------

test("test_the_draft_reads_loaded_once_the_engine_is_read", () => {
  assert.equal(hardwareDraft().loaded, true);
});

//: A second instance of the store, so its first read has not landed; the instance the other cases share is loaded by
//: `beforeEach`.
const UNREAD_STORE = new URL(
  "../../../../hqptuner/static/store/faceplate/settings/hardware.js?unread",
  import.meta.url,
);

// Break: the draft reads loaded with the empty base it holds before its first read.
test("test_the_draft_reads_unloaded_before_the_engine_is_read", async () => {
  const unread = await import(UNREAD_STORE.href);
  assert.equal(unread.hardwareDraft().loaded, false);
});

test("test_a_load_reads_the_engines_attributes_into_the_draft", () => {
  assert.deepEqual(hardwareDraft().values, ENGINE);
});

test("test_a_load_reads_the_engines_attributes_into_the_base", () => {
  assert.deepEqual(hardwareDraft().base, ENGINE);
});

test("test_an_attribute_the_engine_omits_loads_at_the_daemons_default", async () => {
  await load({ engine: NO_MULTICORE });
  assert.equal(hardwareDraft().values.multicore, "auto");
});

test("test_an_attribute_the_engine_omits_is_based_at_the_daemons_default", async () => {
  await load({ engine: NO_MULTICORE });
  assert.equal(hardwareDraft().base.multicore, "auto");
});

test("test_a_fresh_load_drops_the_drafts_edits", async () => {
  setHardware("cuda", "convolution");
  await load();
  assert.deepEqual(hardwareDraft().values, ENGINE);
});

// --- the draft over the base -------------------------------------------------------------------------------------

test("test_an_edit_lands_on_its_own_key_only", () => {
  setHardware("ecores", "filter");
  assert.deepEqual(hardwareDraft().values, { ...ENGINE, ecores: "filter" });
});

test("test_an_edit_leaves_the_base_where_the_engine_put_it", () => {
  setHardware("ecores", "filter");
  assert.deepEqual(hardwareDraft().base, ENGINE);
});

test("test_an_edit_off_the_base_value_differs", () => {
  setHardware("cuda_dev", "2");
  assert.equal(hardwareDraft().differs, true);
});

test("test_a_value_off_a_numeric_base_differs", async () => {
  await load({ engine: NUMERIC_NBLOCKS });
  setHardware("nblocks", "4");
  setHardware("nblocks", "5");
  assert.equal(hardwareDraft().differs, true);
});

// Break: the differ list keeps every key the draft was ever given an edit for.
test("test_an_edit_set_back_to_the_base_value_stops_differing", () => {
  setHardware("cuda_dev", "2");
  setHardware("cuda_dev", ENGINE.cuda_dev);
  assert.equal(hardwareDraft().differs, false);
});

test("test_staged_reads_true_once_the_draft_differs", () => {
  setHardware("multicore", "1");
  assert.equal(staged.value, true);
});

// Break: staged reads whether any edit is set, not whether the differ list holds one.
test("test_staged_reads_false_while_every_edit_matches_the_base", () => {
  setHardware("cuda_dev", "2");
  setHardware("cuda_dev", ENGINE.cuda_dev);
  assert.equal(staged.value, false);
});

// --- the all-stations switch -------------------------------------------------------------------------------------

test("test_setting_all_stations_turns_it_on", () => {
  setAllStations(true);
  assert.equal(allStations.value, true);
});

// Break: the differ list counts the all-stations switch as an edit.
test("test_all_stations_alone_does_not_differ", () => {
  setAllStations(true);
  assert.equal(hardwareDraft().differs, false);
});

test("test_an_edit_with_all_stations_on_differs", () => {
  setAllStations(true);
  setHardware("cuda_cdev", "3");
  assert.equal(hardwareDraft().differs, true);
});

// --- discard -----------------------------------------------------------------------------------------------------

test("test_a_discard_puts_every_edited_value_back_to_the_base", () => {
  setHardware("cuda", "convolution");
  setHardware("nblocks", "16");
  discardHardware();
  assert.deepEqual(hardwareDraft().values, ENGINE);
});

// --- apply -------------------------------------------------------------------------------------------------------

test("test_an_apply_sends_the_draft_as_its_overrides", async () => {
  setHardware("cuda", "convolution");
  const bodies = await apply({ verified: { applied: true } });
  assert.deepEqual(
    bodies.map((b) => b.overrides),
    [{ ...ENGINE, cuda: "convolution" }],
  );
});

// Break: the apply sends all_presets true whatever the switch holds.
test("test_an_apply_with_all_stations_off_sends_all_presets_false", async () => {
  const off = (await apply({ verified: { applied: true } })).map((b) => b.all_presets);
  assert.deepEqual(off, [false]);
});

test("test_an_apply_with_all_stations_on_sends_all_presets_true", async () => {
  await apply({ verified: { applied: true } });
  setAllStations(true);
  const on = (await apply({ verified: { applied: true } })).map((b) => b.all_presets);
  assert.deepEqual(on, [true]);
});

test("test_an_apply_the_daemon_did_not_verify_keeps_the_base", async () => {
  setHardware("ecores", "filter");
  await apply({ verified: { applied: false } });
  assert.deepEqual(hardwareDraft().base, ENGINE);
});

test("test_an_apply_the_daemon_did_not_verify_stays_staged", async () => {
  setHardware("ecores", "filter");
  await apply({ verified: { applied: false } });
  assert.equal(staged.value, true);
});

test("test_an_applied_flag_outside_the_verified_report_does_not_rebase", async () => {
  setHardware("ecores", "filter");
  await apply({ applied: true });
  assert.deepEqual(hardwareDraft().base, ENGINE);
});

// --- apply through the shared form draft -------------------------------------------------------------------------

/**
 * A `POST /api/engine` report: the daemon's readback, confirmed or not.
 *
 * @param {boolean} applied
 * @param {EngineTable} engine
 */
const report = (applied, engine) => ({ report: { verified: { applied, engine }, members: [], backup_bytes: 0 } });

/**
 * A daemon whose engine reads `before` until a write has been answered and `after` from then on; each write is
 * answered with `answer`, or with what the promise `answer` resolves to.
 *
 * @param {{
 *   before?: EngineTable,
 *   after?: EngineTable,
 *   answer: ReturnType<typeof ok> | Promise<ReturnType<typeof ok>>,
 * }} d
 */
function restoringDaemon({ before = ENGINE, after = before, answer }) {
  let written = false;
  return stagingWire({
    routes: (path, opts) => {
      if (path !== "/api/engine") return undefined;
      if (opts.method !== "POST") return ok({ engine: written ? after : before, active_config: null });
      return Promise.resolve(answer).then((response) => {
        written = true;
        return response;
      });
    },
  });
}

/** The alert areas failing now. */
const failingAreas = () => failures.value.map((entry) => entry.area);

// Break: the apply runs on a busy flag of its own instead of an engine op, so the engine never reads as in flight.
test("test_the_engine_is_in_flight_exactly_while_an_apply_runs", async () => {
  /** @type {(response: ReturnType<typeof ok>) => void} */
  let answer = () => {};
  const answered = new Promise(
    /** @param {(response: ReturnType<typeof ok>) => void} resolve */ (resolve) => {
      answer = resolve;
    },
  );
  const wire = restoringDaemon({ after: READBACK, answer: answered });
  setHardware("ecores", "filter");
  const seen = [inFlight.value];
  const applying = applyHardware();
  await turn();
  seen.push(inFlight.value);
  answer(ok(report(true, READBACK)));
  await applying;
  await quiesce(wire);
  seen.push(inFlight.value);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: a confirmed apply re-bases on the values it sent instead of reading the engine back.
test("test_a_confirmed_apply_shows_the_engines_readback", async () => {
  const wire = restoringDaemon({ after: READBACK, answer: ok(report(true, READBACK)) });
  setHardware("ecores", "filter");
  await applyHardware();
  await quiesce(wire);
  assert.deepEqual(hardwareDraft().values, READBACK);
});

// Break: the apply lets the daemon's refusal reach the caller as a throw.
test("test_a_refused_apply_throws_nothing_at_the_caller", async () => {
  const wire = restoringDaemon({ answer: bad(502, "fixture restore refused") });
  setHardware("ecores", "filter");
  await assert.doesNotReject(() => applyHardware());
  await quiesce(wire);
});

/** The two answers an apply does not land on: a readback the daemon did not confirm, and a refusal. */
const UNLANDED = /** @type {const} */ ([
  ["an_unconfirmed", () => ok(report(false, ENGINE))],
  ["a_refused", () => bad(502, "fixture restore refused")],
]);

for (const [outcome, answer] of UNLANDED) {
  // Break: the apply keeps its failure to itself, so the apply alert line never shows it.
  test(`test_${outcome}_apply_reports_on_the_apply_alert_line`, async () => {
    const wire = restoringDaemon({ answer: answer() });
    setHardware("ecores", "filter");
    const seen = [failingAreas()];
    await applyHardware().catch(() => undefined);
    await quiesce(wire);
    seen.push(failingAreas());
    assert.deepEqual(seen, [[], [APPLY_LINE]]);
  });
}

// Break: a generation move leaves the form on the reading from before the restart, or its re-read drops the edit.
test("test_an_engine_restart_rereads_the_engine_under_an_edit_in_progress", async () => {
  health.value = { phase: "Ready", generation: 7 };
  await quiesce(daemon().wire);
  setHardware("ecores", "filter");
  const wire = restoringDaemon({ before: RESTARTED, answer: ok(report(true, RESTARTED)) });
  health.value = { phase: "Ready", generation: 8 };
  await quiesce(wire);
  const shown = hardwareDraft().values;
  health.value = null;
  await quiesce(wire);
  assert.deepEqual(shown, { ...RESTARTED, ecores: "filter" });
});

// --- the stale mark ----------------------------------------------------------------------------------------------

//: The refusal a daemon answers an engine read with.
const READ_REFUSED = "fixture engine read refused";

/**
 * A daemon that reads `ENGINE` until a write, confirms the write with `READBACK`, and answers the read after it with
 * `readback`, held until `release()` is called; `asked()` reads whether that read has been requested.
 *
 * @param {import("../../support/wire/wire.js").FakeResponse} readback
 */
const heldReadbackDaemon = (readback) =>
  heldReadbackWire({
    path: "/api/engine",
    before: ok({ engine: ENGINE, active_config: null }),
    written: ok(report(true, READBACK)),
    after: readback,
  });

/** A daemon refusing every engine read; returns the wire, to wait on. */
const refusingDaemon = () =>
  stagingWire({
    routes: (path) => (path === "/api/engine" ? bad(502, READ_REFUSED) : undefined),
  });

// Break: hardwareDraft() does not carry the form's stale mark, or the apply never raises it or never lowers it.
test("test_the_values_read_stale_from_a_confirmed_apply_until_its_readback_lands", async () => {
  const { wire, release, asked } = heldReadbackDaemon(ok({ engine: READBACK, active_config: null }));
  setHardware("ecores", "filter");
  const seen = [hardwareDraft().stale];
  const applying = applyHardware();
  await until(asked);
  await turn();
  seen.push(hardwareDraft().stale);
  release();
  await applying;
  await quiesce(wire);
  seen.push(hardwareDraft().stale);
  assert.deepEqual(seen, [false, true, false]);
});

// Break: a refused readback after a confirmed apply lowers the stale mark, presenting the pre-write reading as current.
test("test_a_refused_readback_after_a_confirmed_apply_leaves_the_values_stale", async () => {
  const { wire, release, asked } = heldReadbackDaemon(bad(502, READ_REFUSED));
  setHardware("ecores", "filter");
  const applying = applyHardware();
  await until(asked);
  release();
  await applying.catch(() => undefined);
  await quiesce(wire);
  assert.equal(hardwareDraft().stale, true);
});

// Break: a failed engine read leaves the stale mark down, or the next read that lands does not lower it.
test("test_the_values_read_stale_exactly_while_the_last_engine_read_failed", async () => {
  await quiesce(refusingDaemon());
  await loadHardware().catch(() => undefined);
  const seen = [hardwareDraft().stale];
  await load();
  seen.push(hardwareDraft().stale);
  assert.deepEqual(seen, [true, false]);
});
