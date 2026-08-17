// Behavioral suite for the post-process half of a matrix profile load.
//
// `<post_process>` (correction / Bauer crossfeed / loudness) nests INSIDE
// `<matrix>` (hqplayerd-readme.txt §1.11.2), so the chain is a property of a
// matrix profile, not a global. A load therefore has to return the profile's
// whole matrix context — its pipeline rows AND its post-process chain.
//
// Which lane a load takes decides who installs the chain. A profile the daemon
// read at startup goes out over the live 4321 switch, and the switch installs
// the chain itself, so nothing is staged. A profile the daemon does not know —
// saved to the config this session, absent from the in-memory registry until a
// restart — has only the staging lane, so the rows and every post-process
// setting have to be staged as pending config edits.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case calls the exported `loadProfile` / `profilePost` and
// reads the result off the staging server (`w.staged`, `w.posts`) — never off a
// module-private signal, and no store function is stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/profile-post.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadProfile } from "../../../hqptuner/static/components/MatrixProfileCard.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { profilePost, profileRows, stageProfileSave } from "../../../hqptuner/static/store/matrix/profiles.js";
import { stagingWire, ok } from "../support/wire.js";

/**
 * @typedef {import("../support/wire.js").StagingWire} StagingWire
 */

/**
 * One pipeline row, every value a string.
 *
 * @typedef {{ source: string, gain: string, gainunit: string, mixdown: string, process: string }} PipelineRow
 */

// The globals a fake wire installs a `fetch` on, viewed as an optional member:
// the DOM lib declares it returning a real `Response`, which these fakes do
// not build.
/** @type {{ fetch?: unknown }} */
const env = globalThis;

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * @param {Partial<PipelineRow>} [patch]
 * @returns {PipelineRow}
 */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

const NIGHT_ROWS = [ROW({ gain: "-6" }), ROW({ source: "1", mixdown: "1", gain: "-6" })];

// A full chain, one value per form field the profile's <post_process> can
// carry: DAC correction on, Bauer crossfeed on, loudness on. Every value a
// string, the way the form and the config both carry them.
const NIGHT_POST = {
  post_correction_enabled: "1",
  post_correction_dac0: "Holo Audio Cyan 2",
  post_bauer_enabled: "1",
  post_bauer_preset: "jmeier",
  post_bauer_frequency: "700",
  post_bauer_level: "4.5",
  post_loudness_enabled: "1",
  post_loudness_lowfreq: "120",
  post_loudness_lowlevel: "3.0",
  post_loudness_lowsteep: "1.0",
  post_loudness_lowtype: "0",
  post_loudness_highfreq: "8000",
  post_loudness_highlevel: "2.0",
  post_loudness_highsteep: "1.0",
  post_loudness_hightype: "0",
  post_loudness_rangelow: "-40",
  post_loudness_rangehigh: "0",
};

// The staging server plus the live profile route, recorded body-first so a case
// can say exactly which switch went out.
function wire() {
  return stagingWire({
    routes: (path, opts, w) => {
      if (path !== "/api/matrix/profile") return undefined;
      const body = JSON.parse(String(opts.body));
      w.posts.push(body);
      return ok({ ok: true, name: body.name });
    },
  });
}

// `profiles` are the names the daemon read at startup; `saved` is what the
// config file carries, name -> {rows, post}.
/**
 * @param {{
 *   profiles?: string[],
 *   saved?: Record<string, { rows: PipelineRow[], post: Record<string, string> }>,
 * }} [fixture]
 */
async function reset({ profiles = [], saved = {} } = {}) {
  const w = wire();
  matrixConfig.value = {
    fields: [],
    rows: [],
    live_profiles: profiles,
    live_active: "[Default]",
    file_profiles: saved,
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify([ROW({})]) } };
  await discardAll();
  return w;
}

// Every post-process field staged by a load, whatever its lane.
/** @param {StagingWire} w */
const stagedPost = (w) => Object.keys(w.staged.http).filter((k) => k.startsWith("post_"));

// --- the staging lane installs the chain --------------------------------------

test("test_loading_a_profile_the_daemon_does_not_know_stages_its_rows", async () => {
  const w = await reset({ saved: { Night: { rows: NIGHT_ROWS, post: NIGHT_POST } } });
  await loadProfile("Night");
  assert.deepEqual(JSON.parse(String(w.staged.http.matrix_pipelines)), NIGHT_ROWS);
});

for (const [field, value] of Object.entries(NIGHT_POST)) {
  test(`test_loading_a_profile_the_daemon_does_not_know_stages_its_${field}`, async () => {
    const w = await reset({ saved: { Night: { rows: NIGHT_ROWS, post: NIGHT_POST } } });
    await loadProfile("Night");
    assert.equal(w.staged.http[field], value);
  });
}

// --- a profile carrying no chain ----------------------------------------------

test("test_loading_a_profile_with_an_empty_chain_still_stages_its_rows", async () => {
  const w = await reset({ saved: { Bare: { rows: NIGHT_ROWS, post: {} } } });
  await loadProfile("Bare");
  assert.deepEqual(JSON.parse(String(w.staged.http.matrix_pipelines)), NIGHT_ROWS);
});

test("test_loading_a_profile_with_an_empty_chain_stages_no_post_process_edits", async () => {
  const w = await reset({ saved: { Bare: { rows: NIGHT_ROWS, post: {} } } });
  await loadProfile("Bare");
  assert.deepEqual(stagedPost(w), []);
});

// --- the live lane stages nothing ---------------------------------------------
// The 4321 MatrixSetProfile switch installs the profile's post-process chain
// itself (docs/matrix-spec.md, "Profiles"), so there is nothing to stage.

test("test_loading_a_profile_the_daemon_knows_stages_no_post_process_edits", async () => {
  const w = await reset({
    profiles: ["Night"],
    saved: { Night: { rows: NIGHT_ROWS, post: NIGHT_POST } },
  });
  await loadProfile("Night");
  assert.deepEqual(stagedPost(w), []);
});

test("test_loading_a_name_only_the_daemon_knows_posts_the_live_switch", async () => {
  const w = await reset({ profiles: ["DaemonOnly"] });
  await loadProfile("DaemonOnly");
  assert.deepEqual(w.posts, [{ action: "switch", name: "DaemonOnly" }]);
});

test("test_loading_a_name_only_the_daemon_knows_stages_no_post_process_edits", async () => {
  const w = await reset({ profiles: ["DaemonOnly"] });
  await loadProfile("DaemonOnly");
  assert.deepEqual(stagedPost(w), []);
});

// --- a save staged this session, not yet applied ------------------------------
// The rows come from the staged save itself; the live chain at that moment is
// already the one the save is capturing, so there is nothing to re-stage.

test("test_loading_a_profile_staged_for_save_stages_the_staged_saves_rows", async () => {
  const w = await reset({ saved: { Night: { rows: NIGHT_ROWS, post: NIGHT_POST } } });
  await stageProfileSave("Night", [ROW({ gain: "-1" })]);
  await loadProfile("Night");
  assert.deepEqual(JSON.parse(String(w.staged.http.matrix_pipelines)), [ROW({ gain: "-1" })]);
});

test("test_loading_a_profile_staged_for_save_stages_no_post_process_edits", async () => {
  const w = await reset({ saved: { Night: { rows: NIGHT_ROWS, post: NIGHT_POST } } });
  await stageProfileSave("Night", [ROW({ gain: "-1" })]);
  await loadProfile("Night");
  assert.deepEqual(stagedPost(w), []);
});

// --- the accessors ------------------------------------------------------------

test("test_the_rows_accessor_returns_the_profiles_pipeline_rows", async () => {
  await reset({ saved: { Night: { rows: NIGHT_ROWS, post: NIGHT_POST } } });
  assert.deepEqual(profileRows("Night"), NIGHT_ROWS);
});

test("test_the_post_accessor_returns_the_profiles_post_process_mapping", async () => {
  await reset({ saved: { Night: { rows: NIGHT_ROWS, post: NIGHT_POST } } });
  assert.deepEqual(profilePost("Night"), NIGHT_POST);
});

test("test_the_post_accessor_returns_an_empty_mapping_for_a_profile_carrying_no_chain", async () => {
  await reset({ saved: { Bare: { rows: NIGHT_ROWS, post: {} } } });
  assert.deepEqual(profilePost("Bare"), {});
});

test("test_the_post_accessor_returns_null_for_a_name_only_the_daemon_knows", async () => {
  await reset({ profiles: ["DaemonOnly"] });
  assert.equal(profilePost("DaemonOnly"), null);
});
