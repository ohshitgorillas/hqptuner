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
import { fakeClock } from "../../support/clock.js";

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

test("test_a_collapsed_running_range_draws_down_to_the_daemons_full_range_floor", () => {
  run({ at: "-50", ...ZERO });
  assert.equal(volumeGrid().min, -60);
});

test("test_a_collapsed_running_range_pins_the_level_at_0_db", () => {
  assert.equal(levelWith({ at: "-50", ...ZERO }), 0);
});

/** @type {[string, Running, boolean][]} */
const COLLAPSE_READS = [
  ["a_collapsed_running_range_reads_as_fixed", ZERO, true],
  ["the_engine_holding_the_control_over_an_open_running_range_reads_as_free", { report: HELD }, false],
];

for (const [name, r, want] of COLLAPSE_READS) {
  test(`test_${name}`, () => {
    run(r);
    assert.equal(volumeNow().fixed, want);
  });
}

/** @type {[string, string, "down" | "up", boolean][]} */
const RANGE_EDGES = [
  ["the_bottom_of_the_range_disables_the_step_down", "-60", "down", true],
  ["a_step_above_the_bottom_leaves_the_step_down_enabled", "-59.5", "down", false],
  ["the_top_of_the_range_disables_the_step_up", "0", "up", true],
  ["a_step_below_the_top_leaves_the_step_up_enabled", "-0.5", "up", false],
];

for (const [name, at, side, want] of RANGE_EDGES) {
  test(`test_${name}`, () => {
    run({ at });
    assert.equal(volumeNow().off[side], want);
  });
}

// --- the pins ----------------------------------------------------------------------------------------------------

test("test_a_running_fixed_volume_pins_the_level_at_its_own", () => {
  assert.equal(levelWith({ fixed: true, level: "-10" }), -10);
});

/** @type {[string, string, number][]} */
const AUTO_HEADROOM = [
  ["auto_headroom_at_its_first_setting_pins_minus_three", "1", -3],
  ["auto_headroom_at_its_second_setting_pins_minus_six", "2", -6],
];

for (const [name, iso, level] of AUTO_HEADROOM) {
  test(`test_${name}`, () => {
    assert.equal(levelWith({ iso }), level);
  });
}

test("test_auto_headroom_wins_over_the_fixed_level", () => {
  assert.equal(levelWith({ fixed: true, level: "-10", iso: "2" }), -6);
});

test("test_a_running_direct_sdm_pins_the_level_over_a_fixed_volume", () => {
  assert.equal(levelWith({ fixed: true, level: "-10", direct: true }), -3);
});

/** @type {[string, Running, boolean][]} */
const PIN_READS = [
  ["a_running_fixed_volume_reads_as_fixed", { fixed: true }, true],
  ["a_running_direct_sdm_reads_as_fixed", { direct: true }, true],
  ["a_direct_sdm_edited_but_not_applied_reads_as_free", { stagedHttp: { direct_sdm: true } }, false],
];

for (const [name, r, want] of PIN_READS) {
  test(`test_${name}`, () => {
    run(r);
    assert.equal(volumeNow().fixed, want);
  });
}

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

/** @type {[string, Running][]} */
const UNMARKED = [
  ["a_bypassed_matrix_engine_marks_no_loudness_bounds", { ...LOUD, matrix: false }],
  ["loudness_switched_off_marks_no_bounds", { ...LOUD, loudness: false }],
  ["a_pinned_level_marks_no_loudness_bounds", { ...LOUD, fixed: true }],
];

for (const [name, r] of UNMARKED) {
  test(`test_${name}`, () => {
    assert.equal(marksWith(r), null);
  });
}
