// Behavioral suite for the matrix profile card's load lane — which of the two
// lanes a profile load takes, and what each one leaves behind.
//
// Two sources answer to the name "profile" and they are not the same thing.
// `matrixConfig.live_profiles` is what the DAEMON read at startup: those names
// reach the 4321 `MatrixSetProfile` lane, which is instant, needs no engine
// reload and plays through playback (docs/matrix-spec.md, "4321 MatrixSetProfile
// — clean live lane"). `matrixConfig.file_profiles` is `{name: rows}` out of the
// config's `<matrix_profile>` elements, each carrying that profile's rows and
// its own post-process chain; the daemon never read those, so no live
// switch can reach one and staging its rows is the only lane it has.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case calls the exported `loadProfile` and reads the result off
// the staging server (`w.staged`, `w.posts`) — never off a module-private
// signal, and no store function is stubbed.
//
// NOT covered: the card's rendered feedback for a load (busy state, note text).
// Those live in module-private signals written only from event handlers, which
// SSR never fires.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrixprofile.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { loadProfile } from "../../../hqptuner/static/components/MatrixProfileCard.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { stagingWire, ok } from "../support/wire.js";

const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

// A stored profile as the config carries it: rows plus its own post-process chain.
const PROF = (rows, post = {}) => ({ rows, post });

// The staging server plus the one endpoint this suite adds: the profile route,
// recorded body-first so a case can say exactly which switch went out.
function wire() {
  return stagingWire({
    routes: (path, opts, w) => {
      if (path !== "/api/matrix/profile") return undefined;
      const body = JSON.parse(opts.body);
      w.posts.push(body);
      return ok({ ok: true, name: body.name });
    },
  });
}

// Full reset every time — every one of these signals outlives a test.
// `profiles` are the names the daemon read at startup; `saved` is what the
// config carries, name -> {rows, post}.
async function reset(rows, { active = "[Default]", profiles = [], saved = {} } = {}) {
  const w = wire();
  matrixConfig.value = {
    fields: [],
    rows: [],
    live_profiles: profiles,
    live_active: active,
    file_profiles: saved,
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
  return w;
}

const NIGHT = [ROW({ gain: "-6" }), ROW({ source: "1", mixdown: "1", gain: "-6" })];
// The backend's own serialization of NIGHT, written out by hand: alphabetical
// keys, compact, every value a string.
const NIGHT_WIRE =
  '[{"gain":"-6","gainunit":"dB","mixdown":"0","process":"","source":"0"},' +
  '{"gain":"-6","gainunit":"dB","mixdown":"1","process":"","source":"1"}]';

// --- a profile the daemon knows: the live lane -------------------------------

test("test_loading_a_profile_the_daemon_knows_posts_the_live_switch", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"] });
  await loadProfile("Night");
  assert.deepEqual(w.posts, [{ action: "switch", name: "Night" }]);
});

test("test_loading_a_profile_the_daemon_knows_stages_nothing", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"] });
  await loadProfile("Night");
  assert.equal("matrix_pipelines" in w.staged.http, false);
});

// --- the overlap: both sources know the name ---------------------------------
// The production-normal case. `live_profiles` are the names the daemon read out
// of this same config, so a saved profile normally appears in BOTH sources.
// Live wins: the switch goes out and nothing is staged.

test("test_loading_a_profile_both_sources_know_posts_the_live_switch", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"], saved: { Night: PROF(NIGHT) } });
  await loadProfile("Night");
  assert.deepEqual(w.posts, [{ action: "switch", name: "Night" }]);
});

test("test_loading_a_profile_both_sources_know_stages_nothing", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"], saved: { Night: PROF(NIGHT) } });
  await loadProfile("Night");
  assert.equal("matrix_pipelines" in w.staged.http, false);
});

// --- [Default]: the empty name, still the live lane ---------------------------
// [Default] is the unnamed profile, not a member of the daemon's profile list;
// it is stated as its own live-lane rule, so these cases keep "" out of
// `live_profiles` rather than smuggling it in as an ordinary name.

test("test_loading_the_default_profile_posts_the_live_switch_with_an_empty_name", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"] });
  await loadProfile("");
  assert.deepEqual(w.posts, [{ action: "switch", name: "" }]);
});

test("test_loading_the_default_profile_stages_nothing", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"] });
  await loadProfile("");
  assert.equal("matrix_pipelines" in w.staged.http, false);
});

// --- a profile only the config carries: the staging lane ----------------------

test("test_loading_a_profile_only_the_config_carries_stages_its_rows", async () => {
  const w = await reset([ROW({})], { profiles: [], saved: { Night: PROF(NIGHT) } });
  await loadProfile("Night");
  assert.equal(w.staged.http.matrix_pipelines, NIGHT_WIRE);
});

test("test_loading_a_profile_only_the_config_carries_posts_no_live_switch", async () => {
  const w = await reset([ROW({})], { profiles: [], saved: { Night: PROF(NIGHT) } });
  await loadProfile("Night");
  assert.deepEqual(w.posts, []);
});

// --- a name neither source knows ---------------------------------------------

test("test_loading_an_unknown_profile_stages_nothing", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"], saved: { Day: PROF(NIGHT) } });
  await loadProfile("Nowhere");
  assert.equal("matrix_pipelines" in w.staged.http, false);
});

test("test_loading_an_unknown_profile_posts_no_live_switch", async () => {
  const w = await reset([ROW({})], { profiles: ["Night"], saved: { Day: PROF(NIGHT) } });
  await loadProfile("Nowhere");
  assert.deepEqual(w.posts, []);
});
