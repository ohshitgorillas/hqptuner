// Behavioral suite for hqptuner/static/store/faceplate/page/profile.js, the page's Matrix profile section: the choices
// its select offers (the daemon's unnamed profile first, then every saved name, the running one picked and a name the
// engine did not load disabled), the live switch, and the running profile's description.
//
// Driven at the wire: the /matrix form is assigned into `matrixConfig` as the poll writes it, and a fetch fake answers
// the real REST paths in their real shapes and records every request: POST /api/matrix/profile for the switch, the
// four reads the config refresh after it makes, and PUT /api/descriptions for a description. No store function is
// stubbed. Profile names are the fixture's own wire data.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-page/profile.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, enums } from "../../../../hqptuner/static/store/signals.js";
import { descriptions, flushDescriptions } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import {
  profileChoices,
  switchProfile,
  profileDescription,
  editDescription,
  leaveDescription,
} from "../../../../hqptuner/static/store/faceplate/page/profile.js";
import { ok, bad } from "../../support/wire/wire.js";
import { settle } from "../../support/wire/livepresetwire.js";

/** @typedef {import("../../support/wire/wire.js").FakeResponse} FakeResponse */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

/** What the next GET /api/matrix answers with: the /matrix form as the engine reports it after a switch. */
let nextForm = {};
/** The answer to a switch, or undefined for the route's success shape. */
/** @type {FakeResponse | undefined} */
let switchAnswer;
/** A switch held in flight until released. */
/** @type {Promise<void> | null} */
let held = null;

/**
 * A /matrix form as GET /api/matrix carries it: the daemon's startup list and the profile running live.
 *
 * @param {string[]} live  MatrixListProfiles
 * @param {string} active  MatrixGetProfile, "" for the unnamed one
 */
const form = (live, active) => ({ fields: [], rows: [], live_profiles: live, live_active: active });

/** The four reads the config refresh after a switch makes, each in its real shape. */
/** @type {Record<string, () => FakeResponse>} */
const READS = {
  "/api/matrix": () => ok({ data: nextForm }),
  "/api/config": () => ok({ data: config.value }),
  "/api/enumerations": () => ok({ data: enums.value }),
  "/api/config/pending": () => ok({ live: {}, http: {} }),
};

/**
 * The answer to one request.
 *
 * @param {string} path
 * @param {string} method
 * @param {Record<string, unknown> | null} body
 * @returns {Promise<FakeResponse>}
 */
async function answer(path, method, body) {
  if (path === "/api/matrix/profile") {
    if (held) await held;
    return switchAnswer || ok({ ok: true });
  }
  if (READS[path]) return READS[path]();
  if (path === "/api/descriptions" && method === "PUT" && body) {
    const name = String(body.name);
    return ok({ profiles: { [name]: { text: String(body.text), updated: "2026-10-04T00:00:00+00:00" } } });
  }
  return ok({});
}

beforeEach(async () => {
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    CALLS.push({ path, method: opts.method || "GET", body });
    return answer(path, opts.method || "GET", body);
  };
  config.value = { fields: [], file: {}, active: "" };
  matrixConfig.value = form(["Desk", "Lounge"], "Lounge");
  nextForm = matrixConfig.value;
  descriptions.value = {};
  switchAnswer = undefined;
  held = null;
  CALLS.length = 0;
});

// An edit a case leaves is written against the fake, as the well's blur writes it, before the real fetch returns: no
// drain timer outlives the case and no typed copy carries into the next.
afterEach(async () => {
  await leaveDescription();
  env.fetch = REAL_FETCH;
});

/** The requests the wire saw for a method and a path. */
const sent = (/** @type {string} */ method, /** @type {string} */ path) =>
  CALLS.filter((c) => c.method === method && c.path === path);

test("test_the_choices_offer_the_unnamed_profile_then_every_saved_name", () => {
  matrixConfig.value = { ...form(["Lounge"], "Lounge"), file_profiles: { Desk: { rows: [] } } };
  assert.deepEqual(
    profileChoices().options.map((o) => [o.value, o.label]),
    [
      ["", "[Default]"],
      ["Desk", "Desk"],
      ["Lounge", "Lounge"],
    ],
  );
});

test("test_the_running_profile_is_the_picked_choice", () => {
  assert.equal(profileChoices().value, "Lounge");
});

test("test_under_the_unnamed_profile_the_unnamed_choice_is_picked", () => {
  matrixConfig.value = form(["Desk", "Lounge"], "");
  const { value, options } = profileChoices();
  assert.equal(options.find((o) => o.value === value)?.label, "[Default]");
});

test("test_a_saved_name_the_engine_did_not_load_is_disabled", () => {
  matrixConfig.value = { ...form(["Lounge"], "Lounge"), file_profiles: { Desk: { rows: [] } } };
  assert.deepEqual(
    profileChoices()
      .options.filter((o) => o.disabled)
      .map((o) => o.value),
    ["Desk"],
  );
});

test("test_a_switch_posts_the_name_to_the_profile_route", async () => {
  await switchProfile("Desk");
  assert.deepEqual(
    sent("POST", "/api/matrix/profile").map((c) => c.body),
    [{ action: "switch", name: "Desk" }],
  );
});

test("test_after_a_switch_the_picked_choice_follows_the_form_the_engine_reports", async () => {
  nextForm = form(["Desk", "Lounge"], "Desk");
  await switchProfile("Desk");
  assert.equal(profileChoices().value, "Desk");
});

test("test_the_choices_are_busy_while_a_switch_is_in_flight", async () => {
  /** @type {() => void} */
  let release = () => {};
  held = new Promise((r) => (release = r));
  const pending = switchProfile("Desk");
  await settle();
  const busy = profileChoices().busy;
  release();
  await pending;
  assert.equal(busy, true);
});

test("test_a_finished_switch_is_no_longer_busy", async () => {
  /** @type {() => void} */
  let release = () => {};
  held = new Promise((r) => (release = r));
  const pending = switchProfile("Desk");
  await settle();
  const during = profileChoices().busy;
  release();
  await pending;
  assert.deepEqual([during, profileChoices().busy], [true, false]);
});

test("test_a_refused_switch_carries_the_servers_sentence", async () => {
  switchAnswer = bad(502, "MatrixSetProfile failed");
  await switchProfile("Desk");
  assert.equal(profileChoices().error, "MatrixSetProfile failed");
});

test("test_the_next_switch_clears_a_refusal", async () => {
  switchAnswer = bad(502, "MatrixSetProfile failed");
  await switchProfile("Desk");
  const refused = profileChoices().error;
  switchAnswer = undefined;
  await switchProfile("Desk");
  assert.deepEqual([refused, profileChoices().error], ["MatrixSetProfile failed", ""]);
});

test("test_the_description_is_the_running_profiles", () => {
  descriptions.value = {
    Lounge: { text: "Mains at the sofa.", updated: "2026-10-01T00:00:00+00:00" },
    Desk: { text: "Nearfield.", updated: "2026-10-01T00:00:00+00:00" },
  };
  assert.deepEqual(profileDescription(), { name: "Lounge", text: "Mains at the sofa." });
});

test("test_a_running_profile_with_no_description_reads_empty", () => {
  assert.deepEqual(profileDescription(), { name: "Lounge", text: "" });
});

test("test_an_edit_shows_before_it_is_written", () => {
  editDescription("Mains, late night.");
  assert.equal(profileDescription().text, "Mains, late night.");
});

test("test_an_edit_reaches_the_wire_under_the_running_profiles_name", async () => {
  editDescription("Mains, late night.");
  await flushDescriptions();
  assert.deepEqual(
    sent("PUT", "/api/descriptions").map((c) => c.body),
    [{ name: "Lounge", text: "Mains, late night." }],
  );
});

test("test_an_edit_does_not_follow_a_switch_to_another_profile", () => {
  descriptions.value = { Desk: { text: "Nearfield.", updated: "2026-10-01T00:00:00+00:00" } };
  editDescription("Mains, late night.");
  matrixConfig.value = form(["Desk", "Lounge"], "Desk");
  assert.equal(profileDescription().text, "Nearfield.");
});

test("test_leaving_the_well_writes_what_was_typed", async () => {
  editDescription("Mains, late night.");
  await leaveDescription();
  assert.deepEqual(
    sent("PUT", "/api/descriptions").map((c) => c.body),
    [{ name: "Lounge", text: "Mains, late night." }],
  );
});

test("test_once_written_the_typed_copy_gives_way_to_the_stored_one", async () => {
  editDescription("Mains, late night.");
  await leaveDescription();
  descriptions.value = { Lounge: { text: "Mains, edited elsewhere.", updated: "2026-10-04T01:00:00+00:00" } };
  assert.equal(profileDescription().text, "Mains, edited elsewhere.");
});

test("test_a_refused_write_keeps_the_typed_copy", async () => {
  editDescription("Mains, late night.");
  const pass = env.fetch;
  env.fetch = async () => bad(500, "description store unavailable");
  await leaveDescription();
  env.fetch = pass;
  descriptions.value = {};
  assert.equal(profileDescription().text, "Mains, late night.");
});
