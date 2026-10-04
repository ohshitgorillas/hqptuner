// Behavioral suite for hqptuner/static/store/faceplate/volume.js: the engine-row volume's level, range and pins read off
// what the engine reports and what the daemon is running, the write that moves it, and the loudness bounds its slider
// marks.
//
// The wire is the seam: each case writes the engine's reported level and VolumeRange into `volume` and `volumeRange`,
// the daemon's /config and /matrix form fields (and the config file's values) into `config` and `matrixConfig`, and a
// knob drag into `volumeDrag`. Writes ride the real `POST /api/volume`, answered by a fake echoing the level it set,
// and pace on a fake Clock that moves only when a case advances it, so nothing waits on the wall. Every source signal
// is reset on every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/volume.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  config,
  matrixConfig,
  staged,
  volume,
  volumeDrag,
  volumeRange,
} from "../../../../hqptuner/static/store/signals.js";
import {
  volumeGrid,
  volumeNow,
  writeVolume,
  loudnessMarks,
} from "../../../../hqptuner/static/store/faceplate/volume.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */

/**
 * @typedef {object} Running
 * @property {string} [at]          the engine's reported level, dB
 * @property {number | null} [drag] a knob drag in flight, dB
 * @property {Record<string, string>} [report]  VolumeRange as the engine reports it
 * @property {string} [min]         running volume_min
 * @property {string} [max]         running volume_max
 * @property {boolean} [fixed]      running fixed_volume_enabled
 * @property {string} [level]       running fixed_volume, dBFS
 * @property {string} [iso]         running volume_fixed (Auto headroom), 0 | 1 | 2
 * @property {boolean} [direct]     running direct_sdm
 * @property {Record<string, unknown>} [stagedHttp]  edits staged but not applied, by form field
 * @property {boolean} [matrix]     running matrix engine
 * @property {boolean} [loudness]   running loudness
 */

/** An adjustable −60…0 dB volume at −12.5 dB, nothing pinned, loudness −45…−15 dB but the matrix engine bypassed. */
const FREE = {
  at: "-12.5",
  drag: null,
  report: { enabled: "1", min: "-60", max: "0" },
  min: "-60",
  max: "0",
  fixed: false,
  level: "-10",
  iso: "0",
  direct: false,
  stagedHttp: {},
  matrix: false,
  loudness: false,
};

/** The engine holding the control: it reports a range of its own, not the configured one. */
const HELD = { enabled: "0", min: "-12", max: "0" };

/** The running range collapsed to 0 / 0, which bypasses the volume control, the engine holding it. */
const ZERO = { report: HELD, min: "0", max: "0" };

/** A clock that moves only on `advance`: each timer a row with its deadline, run in deadline order. */
function fakeClock() {
  let now = 0;
  let next = 0;
  /** @type {Map<number, { fn: () => void, at: number }>} */
  const rows = new Map();
  const arm = (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
    next += 1;
    rows.set(next, { fn, at: now + ms });
    return next;
  };
  const drop = (/** @type {unknown} */ handle) => void rows.delete(Number(handle));
  /** @type {Clock} */
  const clock = {
    setTimeout: arm,
    clearTimeout: drop,
    setInterval: arm,
    clearInterval: drop,
    requestAnimationFrame: (fn) => arm(() => fn(now), 16),
    queueMicrotask: (fn) => void arm(fn, 0),
    now: () => now,
  };
  /** @param {number} ms */
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = [...rows].filter(([, r]) => r.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      rows.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  return { clock, advance };
}

/** @param {Running} r */
function run(r = {}) {
  const s = { ...FREE, ...r };
  volume.value = s.at;
  volumeDrag.value = s.drag;
  volumeRange.value = s.report;
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: s.fixed },
      { name: "fixed_volume", value: s.level },
      { name: "volume_fixed", value: s.iso !== "0" },
      { name: "direct_sdm", value: s.direct },
      { name: "volume_min", value: s.min },
      { name: "volume_max", value: s.max },
    ],
    file: { volume_fixed: s.iso, fixed_volume: s.level },
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: s.matrix },
      { name: "post_loudness_enabled", value: s.loudness },
      { name: "post_loudness_rangelow", value: "-45" },
      { name: "post_loudness_rangehigh", value: "-15" },
    ],
  };
  staged.value = { live: {}, http: s.stagedHttp };
}

/**
 * The shown level for one running state.
 *
 * @param {Running} r
 */
function levelWith(r) {
  run(r);
  return volumeNow().level;
}

/** A wire answering the live volume write with the level it set; returns the bodies it was handed. */
function volumeWire() {
  return stagingWire({
    routes: (path, opts, w) => {
      if (path !== "/api/volume" || opts.method !== "POST") return undefined;
      const body = JSON.parse(String(opts.body));
      w.posts.push(body);
      return ok({ volume: body.level });
    },
  });
}

/**
 * The levels sent for one write from one running state.
 *
 * @param {Running} r
 * @param {number} request  dB
 */
async function sent(r, request) {
  run(r);
  const w = volumeWire();
  writeVolume(request, fakeClock().clock);
  await quiesce(w);
  return w.posts.map((p) => /** @type {{ level: string }} */ (p).level);
}

/**
 * The loudness marks for one running state, as their bounds.
 *
 * @param {Running} r
 */
function marksWith(r) {
  run(r);
  const m = loudnessMarks();
  return m ? [m.lo, m.hi] : null;
}

const LOUD = { matrix: true, loudness: true };

// --- the level ---------------------------------------------------------------------------------------------------

test("test_the_level_is_the_engines_reported_volume", () => {
  assert.equal(levelWith({ at: "-12.5" }), -12.5);
});

test("test_a_knob_drag_in_flight_wins_over_the_reported_volume", () => {
  assert.equal(levelWith({ drag: -30 }), -30);
});

test("test_the_level_lands_on_the_half_db_step", () => {
  assert.equal(levelWith({ at: "-12.3" }), -12.5);
});

// --- the range ---------------------------------------------------------------------------------------------------

test("test_the_engines_own_range_bounds_the_level_while_it_reports_the_control_enabled", () => {
  assert.equal(levelWith({ at: "-50", report: { enabled: "1", min: "-40", max: "-3" } }), -40);
});

test("test_the_running_config_range_bounds_the_level_while_the_engine_holds_the_control", () => {
  assert.equal(levelWith({ at: "-50", report: HELD, min: "-60", max: "-3" }), -50);
});

test("test_the_engines_range_stands_when_the_running_config_has_none", () => {
  assert.equal(levelWith({ at: "-50", report: HELD, min: "" }), -12);
});

test("test_a_collapsed_running_range_draws_on_the_daemons_full_range", () => {
  run({ at: "-50", ...ZERO });
  assert.deepEqual([volumeGrid().min, volumeGrid().max], [-60, 0]);
});

test("test_a_collapsed_running_range_pins_the_level_at_0_db", () => {
  assert.equal(levelWith({ at: "-50", ...ZERO }), 0);
});

test("test_a_collapsed_running_range_reads_as_fixed", () => {
  const fixed = (/** @type {Running} */ r) => (run(r), volumeNow().fixed);
  assert.deepEqual([fixed({ report: HELD }), fixed(ZERO)], [false, true]);
});

test("test_the_bottom_of_the_range_disables_the_step_down", () => {
  const off = (/** @type {string} */ at) => (run({ at }), volumeNow().off.down);
  assert.deepEqual([off("-60"), off("-59.5")], [true, false]);
});

test("test_the_top_of_the_range_disables_the_step_up", () => {
  const off = (/** @type {string} */ at) => (run({ at }), volumeNow().off.up);
  assert.deepEqual([off("0"), off("-0.5")], [true, false]);
});

// --- the pins ----------------------------------------------------------------------------------------------------

test("test_a_running_fixed_volume_pins_the_level_at_its_own", () => {
  assert.equal(levelWith({ fixed: true, level: "-10" }), -10);
});

test("test_auto_headroom_pins_minus_three_or_minus_six_by_its_setting", () => {
  assert.deepEqual([levelWith({ iso: "1" }), levelWith({ iso: "2" })], [-3, -6]);
});

test("test_auto_headroom_wins_over_the_fixed_level", () => {
  assert.equal(levelWith({ fixed: true, level: "-10", iso: "2" }), -6);
});

test("test_a_running_direct_sdm_pins_the_level_over_a_fixed_volume", () => {
  assert.equal(levelWith({ fixed: true, level: "-10", direct: true }), -3);
});

test("test_a_pinned_level_reads_as_fixed", () => {
  const fixed = (/** @type {Running} */ r) => (run(r), volumeNow().fixed);
  assert.deepEqual([fixed({}), fixed({ fixed: true }), fixed({ direct: true })], [false, true, true]);
});

test("test_a_direct_sdm_edited_but_not_applied_pins_nothing", () => {
  const fixed = (/** @type {Running} */ r) => (run(r), volumeNow().fixed);
  assert.deepEqual([fixed({ direct: true }), fixed({ stagedHttp: { direct_sdm: true } })], [true, false]);
});

test("test_direct_sdm_carries_a_reason_and_a_free_level_none", () => {
  const why = (/** @type {Running} */ r) => (run(r), volumeNow().why);
  assert.deepEqual([why({ direct: true }) === "", why({}) === ""], [false, true]);
});

// --- the write ---------------------------------------------------------------------------------------------------

test("test_a_write_sends_the_level_on_the_half_db_step", async () => {
  assert.deepEqual(await sent({}, -13.2), ["-13"]);
});

test("test_a_write_past_the_top_sends_the_top", async () => {
  assert.deepEqual(await sent({}, 5), ["0"]);
});

test("test_a_write_shows_its_level_before_the_engine_answers", async () => {
  run({});
  const w = volumeWire();
  writeVolume(-20, fakeClock().clock);
  const level = volumeNow().level;
  await quiesce(w);
  assert.equal(level, -20);
});

test("test_a_write_while_the_level_is_pinned_is_not_sent", async () => {
  const counts = [(await sent({}, -20)).length, (await sent({ direct: true }, -20)).length];
  assert.deepEqual(counts, [1, 0]);
});

test("test_a_write_landing_on_the_shown_level_is_not_sent", async () => {
  const counts = [(await sent({}, -12.5)).length, (await sent({}, -13)).length];
  assert.deepEqual(counts, [0, 1]);
});

test("test_a_write_under_a_collapsed_running_range_is_not_sent", async () => {
  const counts = [(await sent({ report: HELD }, -20)).length, (await sent(ZERO, -20)).length];
  assert.deepEqual(counts, [1, 0]);
});

// --- the write's pace --------------------------------------------------------------------------------------------

/**
 * The levels sent for a run of writes from the free state, `advance` moving the clock between them where a step is a
 * number of ms rather than a level.
 *
 * @param {({ level: number } | { ms: number })[]} steps
 */
async function paced(steps) {
  run({});
  const w = volumeWire();
  const { clock, advance } = fakeClock();
  for (const step of steps) {
    if ("level" in step) writeVolume(step.level, clock);
    else advance(step.ms);
    await quiesce(w);
  }
  return w.posts.map((p) => /** @type {{ level: string }} */ (p).level);
}

test("test_writes_inside_100_ms_of_a_send_are_held", async () => {
  assert.deepEqual(await paced([{ level: -20 }, { level: -21 }, { level: -22 }]), ["-20"]);
});

test("test_the_newest_held_write_is_sent_when_the_100_ms_pass", async () => {
  const sends = await paced([{ level: -20 }, { level: -21 }, { level: -22 }, { ms: 100 }]);
  assert.deepEqual(sends, ["-20", "-22"]);
});

test("test_a_write_after_a_quiet_window_is_sent_at_once", async () => {
  const sends = await paced([{ level: -20 }, { level: -21 }, { level: -22 }, { ms: 100 }, { ms: 100 }, { level: -25 }]);
  assert.deepEqual(sends, ["-20", "-22", "-25"]);
});

test("test_a_held_write_shows_its_level_while_the_first_is_answered", async () => {
  run({});
  const w = volumeWire();
  const { clock } = fakeClock();
  writeVolume(-20, clock);
  writeVolume(-21, clock);
  await quiesce(w);
  assert.equal(volumeNow().level, -21);
});

// --- the loudness bounds -----------------------------------------------------------------------------------------

test("test_the_loudness_bounds_sit_along_the_range_while_matrix_and_loudness_run", () => {
  assert.deepEqual(marksWith(LOUD), [25, 75]);
});

test("test_a_bypassed_matrix_engine_marks_no_loudness_bounds", () => {
  assert.deepEqual([marksWith(LOUD), marksWith({ ...LOUD, matrix: false })], [[25, 75], null]);
});

test("test_loudness_switched_off_marks_no_bounds", () => {
  assert.deepEqual([marksWith(LOUD), marksWith({ ...LOUD, loudness: false })], [[25, 75], null]);
});

test("test_a_pinned_level_marks_no_loudness_bounds", () => {
  assert.deepEqual([marksWith(LOUD), marksWith({ ...LOUD, fixed: true })], [[25, 75], null]);
});
