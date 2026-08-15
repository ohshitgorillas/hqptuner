// Behavioral suite for store/roonidle.js — the Roon idle-time advisory.
//
// hqplayerd restarts the engine between tracks when `idle_time` is at its
// default ("0" on the wire = Default, settings-classification.md:31), which is
// wasteful under Roon's track-by-track feeding. The daemon's Status frame
// carries a metadata child only while a track is loaded (protocol.md §6), and
// during Roon playback that child says song="Roon" — so the advisory fires
// exactly when Roon is playing AND the RUNNING daemon's idle_time — the loaded
// config value, staged edits ignored — is "0" or unset.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the staged edits the advisory must IGNORE are driven through the
// real /api/config/stage path via a staging server, never by poking store
// internals. Every simulated frame is a FRESH object (writing the same
// reference to a signal does not notify).
//
// Ordering matters and is deliberate: the store's staged buffer is
// module-private with no reset export, so the cases that stage an edit run
// AFTER every case that needs an empty buffer, and the strip cases reset
// through the shared fixture, which clears the buffer over the wire.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/roonidle.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { roonIdleAlert } from "../../../hqptuner/static/store/roonidle.js";
import { AlertStrip } from "../../../hqptuner/static/components/AlertStrip.js";
import { engineStatus, config } from "../../../hqptuner/static/store/signals.js";
import { edit } from "../../../hqptuner/static/store/actions.js";
import { stagingWire, quiesce } from "../support/wire.js";
import { reset, DSD512, DSD1024, PCM_8X, MODULATOR } from "../support/shaperfit-fixtures.js";

// The advisory, byte-exact — the whole row object, so severity and copy are
// pinned together and a drifted word or a re-severitied row both fail.
const ROON_TEXT =
  "Recommend setting Engine idle time (System tab) to 10 or longer; " +
  "at default idle time, Roon inefficiently restarts the engine between tracks.";
const ROON_ROW = { sev: "warn", text: ROON_TEXT };

let serial = 0;

// One playing status frame, optionally carrying the metadata child. Always a
// fresh object, always a fresh track_serial, so no health counter baseline
// leaks between cases.
/** @param {Record<string, string> | null} metadata */
function frame(metadata) {
  serial += 1;
  const status = { state: "2", track_serial: String(serial), process_speed: "1.5", clips: "0" };
  return metadata === null ? { status } : { status, metadata };
}

// State the loaded config's idle_time (or leave it out entirely) and the
// playing frame in one move.
/**
 * @param {string | null} idleTime  the loaded `idle_time` field value, null for absent
 * @param {Record<string, string> | null} metadata
 */
function scene(idleTime, metadata) {
  config.value = {
    fields: idleTime === null ? [] : [{ name: "idle_time", value: idleTime }],
    file: {},
    active: "",
    profiles: null,
  };
  engineStatus.value = frame(metadata);
}

// --- the advisory fires -------------------------------------------------------

test("test_roon_playback_at_default_idle_time_raises_the_advisory_verbatim", () => {
  scene("0", { song: "Roon" });
  assert.deepEqual(roonIdleAlert.value, ROON_ROW);
});

test("test_roon_playback_with_idle_time_unset_raises_the_advisory_verbatim", () => {
  scene(null, { song: "Roon" });
  assert.deepEqual(roonIdleAlert.value, ROON_ROW);
});

// --- a configured idle time silences it ---------------------------------------

for (const idle of ["10000", "30000"]) {
  test(`test_roon_playback_with_a_configured_idle_time_stays_silent: ${idle}`, () => {
    scene(idle, { song: "Roon" });
    assert.equal(roonIdleAlert.value, null);
  });
}

// --- no metadata, no advisory --------------------------------------------------
// The daemon sends the metadata child only while a track is loaded; a stopped
// engine must not nag about a player that is not playing.

test("test_an_absent_metadata_child_stays_silent_at_default_idle_time", () => {
  scene("0", null);
  assert.equal(roonIdleAlert.value, null);
});

test("test_a_null_engine_status_stays_silent_at_default_idle_time", () => {
  config.value = { fields: [{ name: "idle_time", value: "0" }], file: {}, active: "", profiles: null };
  engineStatus.value = null;
  assert.equal(roonIdleAlert.value, null);
});

// --- only Roon is Roon ----------------------------------------------------------

test("test_a_non_roon_song_stays_silent_at_default_idle_time", () => {
  scene("0", { song: "Some Local Track" });
  assert.equal(roonIdleAlert.value, null);
});

test("test_metadata_without_a_song_stays_silent_at_default_idle_time", () => {
  scene("0", { artist: "Someone" });
  assert.equal(roonIdleAlert.value, null);
});

// --- staged edits do NOT count: the advisory tracks the running daemon ---------
// The engine keeps restarting between tracks until an edit is APPLIED, so a
// staged-but-pending idle_time changes nothing on the daemon and must change
// nothing here — the advisory reads the loaded config value alone, and clears
// only when apply refetches a config whose own value is non-"0". These cases
// run through the real staging wire and sit after every empty-buffer case above.

test("test_staging_a_nonzero_idle_time_does_not_clear_the_advisory_before_apply", async () => {
  scene("0", { song: "Roon" });
  const w = stagingWire();
  await edit("idle_time", "10000");
  await quiesce(w);
  assert.deepEqual(roonIdleAlert.value, ROON_ROW);
});

test("test_a_staged_default_over_a_loaded_nonzero_does_not_raise_the_advisory", async () => {
  scene("30000", { song: "Roon" });
  const w = stagingWire();
  await edit("idle_time", "0");
  await quiesce(w);
  assert.equal(roonIdleAlert.value, null);
});

// --- the strip renders it -------------------------------------------------------
// The fixture reset() restates every signal and clears the staged buffer over
// the wire; its config carries no idle_time field, which is the unset case and
// keeps the advisory live. NEITHER pins nothing else in the strip; CONFLICT adds
// the critical modulator row.

/** @typedef {import("../support/shaperfit-fixtures.js").Scenario} Scenario */

/** @type {Scenario} */
const NEITHER = { chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_8X };
/** @type {Scenario} */
const CONFLICT = {
  chain: "sdm",
  mode: "2",
  sdmRate: DSD512,
  pcmRate: PCM_8X,
  floors: { sdm: { [MODULATOR]: 40960000 } },
};
const SHAPER_TEXT =
  "The current settings are invalid: modulator ASDM7EC is incompatible with DSD512 output. " +
  "HQPlayer cannot produce output.";

const strip = () => render(html`<${AlertStrip} />`);

test("test_the_strip_renders_the_roon_idle_advisory", async () => {
  await reset({ ...NEITHER, status: frame({ song: "Roon" }) });
  assert.ok(strip().includes(ROON_TEXT));
});

test("test_the_roon_idle_row_renders_at_warning_severity", async () => {
  // the advisory is the only alert on screen, so the warn row is its row
  await reset({ ...NEITHER, status: frame({ song: "Roon" }) });
  assert.ok(strip().includes('class="alert alert-warn"'));
});

test("test_the_strip_omits_the_roon_row_when_the_song_is_not_roon", async () => {
  // same harness, alert condition broken on the song side: a strip rendering
  // the row unconditionally fails here
  await reset({ ...NEITHER, status: frame({ song: "Some Local Track" }) });
  assert.ok(!strip().includes(ROON_TEXT));
});

test("test_the_roon_row_does_not_displace_a_health_alert", async () => {
  const status = frame({ song: "Roon" });
  status.status.clips = "13";
  await reset({ ...NEITHER, status });
  assert.ok(strip().includes("Clipping ×13 this track"));
});

test("test_a_health_alert_does_not_displace_the_roon_row", async () => {
  const status = frame({ song: "Roon" });
  status.status.clips = "13";
  await reset({ ...NEITHER, status });
  assert.ok(strip().includes(ROON_TEXT));
});

test("test_the_roon_row_does_not_displace_a_shaper_alert", async () => {
  await reset({ ...CONFLICT, status: frame({ song: "Roon" }) });
  assert.ok(strip().includes(SHAPER_TEXT));
});

test("test_a_shaper_alert_does_not_displace_the_roon_row", async () => {
  await reset({ ...CONFLICT, status: frame({ song: "Roon" }) });
  assert.ok(strip().includes(ROON_TEXT));
});
