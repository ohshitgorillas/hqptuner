// Behavioral suite for hqptuner/static/store/faceplate/alerts.js: the alerts the faceplate raises and where they land.
// Each of v1's alerts arrives under its faceplate kind with its v1 severity, the shaper pair names the chain it judges,
// the junk advice carries the backend's reason, and the credentials and Roon lines are not v1's. The plan over them
// blinks the home each kind lives on, and a header home's popover holds only the alerts homed there.
//
// Driven at the wire: the /api/health reading, the /api/status frame (playing state, health counters, the metadata
// child, the junk advisor's object) and the state, enumerations, config and metadata payloads the shaper fit reads,
// through the exported signals and the shared shaper-fit scenario builder. Every simulated poll is a fresh object, and
// each case starts on a fresh track with a healthy speed, which zeroes the health module's streak and counter baseline.
// The sentences are owner copy and are nowhere in this file.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/alerts.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { health, engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { initHealth } from "../../../../hqptuner/static/store/health.js";
import { faceplateAlerts, alertsNow, alertNotes } from "../../../../hqptuner/static/store/faceplate/alerts.js";
import { reset, DSD512, DSD1024, PCM_4X, PCM_8X } from "../../support/shaperfit-fixtures.js";

/** @typedef {import("../../../../hqptuner/static/model/shell/alerts.js").Alert} Alert */
/** @typedef {import("../../support/shaperfit-fixtures.js").Scenario} Scenario */

initHealth();

const SUSTAIN = 3;

/** A /api/health reading whose credentials the daemon accepted. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true };

/** The junk advisor's object as /api/status carries it. */
const ADVICE = { filter: "30k", reason: "Ultrasonic junk above 30 kHz suggests the 30k filter", ceiling_khz: 30 };

let serial = 0;

/**
 * One /api/status poll on the current track: playing at a healthy speed on a non-apodizing filter the enumeration
 * carries, with the fields a case names laid over it.
 *
 * @param {Record<string, string>} [fields]  Status frame attributes
 * @param {Record<string, unknown>} [extra]  the payload's other keys: `metadata`, `junk`
 */
function poll(fields = {}, extra = {}) {
  engineStatus.value = {
    status: {
      state: "2",
      track_serial: String(serial),
      process_speed: "1.5",
      output_fill: "0.9",
      clips: "0",
      apod: "0",
      active_filter: "sinc-M",
      ...fields,
    },
    ...extra,
  };
}

/**
 * Start a case with nothing wrong: the engine running SDM at DSD1024, past its modulator's floor, accepted
 * credentials, and a fresh track at a healthy speed. A scenario overrides the shaper fit's half.
 *
 * @param {Scenario} [scenario]
 */
async function quiet(scenario = {}) {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_8X, ...scenario });
  health.value = { ...HEALTHY };
  serial += 1;
  poll();
}

/** @param {Record<string, string>} fields */
const sustain = (fields) => {
  for (let i = 0; i < SUSTAIN; i += 1) poll(fields);
};

const refuse = () => {
  health.value = { ...HEALTHY, credentials_ok: false };
};

/** @param {Alert[]} list */
const kindsOf = (list) => list.map((a) => a.kind);
const kinds = () => kindsOf(faceplateAlerts());
const sevs = () => faceplateAlerts().map((a) => a.sev);
/** @param {string} kind */
const find = (kind) => faceplateAlerts().find((a) => a.kind === kind);

// --- each v1 alert under its faceplate kind -------------------------------------

test("test_refused_credentials_raise_the_credentials_kind", async () => {
  await quiet();
  refuse();
  assert.deepEqual(kinds(), ["credentials"]);
});

test("test_a_sustained_below_realtime_speed_raises_the_speed_kind", async () => {
  await quiet();
  sustain({ process_speed: "0.5" });
  assert.deepEqual(kinds(), ["speed"]);
});

test("test_a_below_realtime_speed_is_critical", async () => {
  await quiet();
  sustain({ process_speed: "0.5" });
  assert.deepEqual(sevs(), ["crit"]);
});

test("test_a_slow_speed_above_realtime_is_a_warning", async () => {
  await quiet();
  sustain({ process_speed: "1.02" });
  assert.deepEqual(sevs(), ["warn"]);
});

test("test_clipping_this_track_raises_the_clip_kind", async () => {
  await quiet();
  poll({ clips: "12" });
  assert.deepEqual(kinds(), ["clip"]);
});

test("test_apodizing_events_on_a_non_apodizing_filter_raise_the_apod_kind", async () => {
  await quiet();
  poll({ apod: "12" });
  assert.deepEqual(kinds(), ["apod"]);
});

test("test_a_modulator_below_its_floor_raises_the_shaper_sdm_kind", async () => {
  await quiet({ sdmRate: DSD512 });
  assert.deepEqual(kinds(), ["shaperSdm"]);
});

test("test_a_modulator_below_its_floor_names_the_sdm_chain", async () => {
  await quiet({ sdmRate: DSD512 });
  assert.equal(find("shaperSdm")?.chain, "sdm");
});

test("test_a_ditherer_below_its_floor_raises_the_shaper_pcm_kind", async () => {
  await quiet({ chain: "pcm", mode: "1", pcmRate: PCM_4X });
  assert.deepEqual(kinds(), ["shaperPcm"]);
});

test("test_a_ditherer_below_its_floor_names_the_pcm_chain", async () => {
  await quiet({ chain: "pcm", mode: "1", pcmRate: PCM_4X });
  assert.equal(find("shaperPcm")?.chain, "pcm");
});

test("test_roon_at_default_idle_time_raises_the_roon_kind", async () => {
  await quiet();
  poll({}, { metadata: { song: "Roon" } });
  assert.deepEqual(kinds(), ["roon"]);
});

test("test_the_junk_advisor_raises_the_junk_kind", async () => {
  await quiet();
  poll({}, { junk: { ...ADVICE } });
  assert.deepEqual(kinds(), ["junk"]);
});

test("test_the_junk_advice_is_advice", async () => {
  await quiet();
  poll({}, { junk: { ...ADVICE } });
  assert.deepEqual(sevs(), ["advice"]);
});

test("test_the_junk_line_is_the_backends_reason", async () => {
  await quiet();
  poll({}, { junk: { ...ADVICE } });
  assert.equal(find("junk")?.text, ADVICE.reason);
});

// --- where the plan lands them ---------------------------------------------------

test("test_refused_credentials_blink_the_knob_red", async () => {
  await quiet();
  refuse();
  assert.equal(alertsNow.value.blinks.el.get("conn"), "crit");
});

test("test_a_slow_speed_blinks_the_gauge", async () => {
  await quiet();
  sustain({ process_speed: "1.02" });
  assert.equal(alertsNow.value.blinks.el.get("gauge"), "warn");
});

test("test_clipping_blinks_the_volume_stage", async () => {
  await quiet();
  poll({ clips: "12" });
  assert.equal(alertsNow.value.blinks.stage.get("volume"), "warn");
});

test("test_apodizing_pins_its_line_on_the_resampling_section", async () => {
  await quiet();
  poll({ apod: "12" });
  assert.deepEqual(
    alertsNow.value.sections.get("resampling")?.map((a) => a.kind),
    ["apod"],
  );
});

test("test_a_ditherer_below_its_floor_pins_its_line_on_the_shaping_section", async () => {
  await quiet({ chain: "pcm", mode: "1", pcmRate: PCM_4X });
  assert.deepEqual(
    alertsNow.value.sections.get("shaping")?.map((a) => a.kind),
    ["shaperPcm"],
  );
});

test("test_a_modulator_below_its_floor_darkens_speakers_and_output", async () => {
  await quiet({ sdmRate: DSD512 });
  assert.deepEqual(alertsNow.value.dark, ["speakers", "output"]);
});

test("test_roon_blinks_the_gear", async () => {
  await quiet();
  poll({}, { metadata: { song: "Roon" } });
  assert.equal(alertsNow.value.blinks.el.get("gear"), "warn");
});

test("test_roon_lights_the_idle_time_row_in_the_timing_drawer", async () => {
  await quiet();
  poll({}, { metadata: { song: "Roon" } });
  assert.deepEqual(
    alertsNow.value.drawers.get("timing")?.rows.map((r) => r.label),
    ["idle_time"],
  );
});

test("test_junk_advice_blinks_the_hf_stage", async () => {
  await quiet();
  poll({}, { junk: { ...ADVICE } });
  assert.equal(alertsNow.value.blinks.stage.get("hf"), "warn");
});

test("test_junk_advice_lights_the_junk_filter_row_in_the_hf_drawer", async () => {
  await quiet();
  poll({}, { junk: { ...ADVICE } });
  assert.deepEqual(
    alertsNow.value.drawers.get("hf")?.rows.map((r) => r.label),
    ["junk_filter"],
  );
});

// --- a header home's popover -----------------------------------------------------

test("test_the_knobs_popover_holds_the_credentials_alert", async () => {
  await quiet();
  refuse();
  assert.deepEqual(kindsOf(alertNotes("conn")), ["credentials"]);
});

test("test_the_gauges_popover_holds_only_the_alerts_homed_on_it", async () => {
  await quiet();
  refuse();
  sustain({ process_speed: "0.5" });
  assert.deepEqual(kindsOf(alertNotes("gauge")), ["speed"]);
});
