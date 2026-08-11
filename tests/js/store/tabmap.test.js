// Behavioral suite for store/tabmap.js — which tab a staged edit lights up.
//
// The mapping is hand-maintained (schema `group` is not the tab), and its
// failure mode is silent: a key nobody listed falls through to the Matrix tab, so a
// change made on Output or Volume accents a tab the control isn't on. Three
// things are pinned here. Named controls that moved between tabs and must land
// where they are rendered; the VolumeRangeBar trio (volume_min, volume_max,
// startup_volume), which is the reported defect — a volume edit accenting Matrix;
// and a sweep of the whole schema that pins the Matrix tab's membership literally,
// so any future fallthrough shows up as a changed set rather than as nothing.
// Everything is driven through the real `edit()` against a staging wire
// (docs/testing.md rule 4) rather than by assigning to the staged buffer.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/tabmap.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { dirtyTabs } from "../../../hqptuner/static/store/tabmap.js";
import { config, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { stagingWire } from "../support/wire.js";

async function reset() {
  const w = stagingWire();
  engineState.value = { filter_junk: 0 };
  config.value = { fields: [{ name: "pre_before_meter", value: false }], file: {}, active: "", profiles: null };
  await discardAll();
  return w;
}

// The reorganization moved the old Output-tab residents to the tabs that now
// render them: the pre-process pair to Conversion (id `resampling`), gain
// compensation to Volume, the engine timing knobs and UPnP freewheel to System,
// the channel count to Matrix. The accent follows the control.

test("a staged high-frequency filter lights the conversion tab", async () => {
  await reset();
  await edit("junk_filter", "3");
  assert.deepEqual([...dirtyTabs.value], ["resampling"]);
});

test("a staged pre-process before metering lights the conversion tab", async () => {
  await reset();
  await edit("pre_before_meter", "1");
  assert.deepEqual([...dirtyTabs.value], ["resampling"]);
});

test("a staged gain compensation lights the volume tab", async () => {
  await reset();
  await edit("gain_comp", "-0.5");
  assert.deepEqual([...dirtyTabs.value], ["volume"]);
});

test("a staged engine idle time lights the system tab", async () => {
  await reset();
  await edit("idle_time", "10000");
  assert.deepEqual([...dirtyTabs.value], ["system"]);
});

test("a staged quick pause lights the system tab", async () => {
  await reset();
  await edit("quick_pause", "1");
  assert.deepEqual([...dirtyTabs.value], ["system"]);
});

test("a staged short buffer lights the system tab", async () => {
  await reset();
  await edit("short_buffer", "1");
  assert.deepEqual([...dirtyTabs.value], ["system"]);
});

test("a staged upnp freewheel lights the system tab", async () => {
  await reset();
  await edit("upnp_freewheel", "1");
  assert.deepEqual([...dirtyTabs.value], ["system"]);
});

test("a staged channel count lights the matrix tab", async () => {
  await reset();
  await edit("channels", "4");
  assert.deepEqual([...dirtyTabs.value], ["matrix"]);
});

test("a staged minimum volume lights the volume tab", async () => {
  await reset();
  await edit("volume_min", "-60");
  assert.deepEqual([...dirtyTabs.value], ["volume"]);
});

test("a staged maximum volume lights the volume tab", async () => {
  await reset();
  await edit("volume_max", "0");
  assert.deepEqual([...dirtyTabs.value], ["volume"]);
});

test("a staged startup volume lights the volume tab", async () => {
  await reset();
  await edit("startup_volume", "-30");
  assert.deepEqual([...dirtyTabs.value], ["volume"]);
});

test("a staged minimum volume does not light the Matrix tab", async () => {
  await reset();
  await edit("volume_min", "-60");
  assert.equal(dirtyTabs.value.has("matrix"), false);
});

// The anti-recurrence guard for the whole schema. The mapping's fallback is
// silent: a key no tab set claims lands on the Matrix tab, so a control that lives
// on Output or Volume under a name nobody enumerated accents "matrix" with
// nothing failing. A name prefix is not the test for Matrix membership — `pipelines`
// is a genuine Matrix control carrying no prefix — so the Matrix set is pinned
// literally: any new fallthrough, prefixed or not, changes the observed set.
//
// Each key is driven through the real `edit()` with "1", a value that reads dirty
// against every seeded baseline ("1" differs from undefined and from the seeded
// live 0, and is truthy so it is dirty in the boolean domain too). Coupled keys
// (crossfeed_*, fixed_volume_enabled / optimal_iso) stage extra fields alongside
// the primary edit, so an edit could in principle light more than one tab. That
// is why membership is the key's whole tab list being exactly ["matrix"] and not
// merely containing it: a crossfeed key mis-mapped elsewhere would still show
// "matrix" through its Bauer coupling partner and slip past a containment test.
// The companion below catches the other direction — "matrix" turning up anywhere
// in a non-Matrix key's list.
const MATRIX_KEYS = [
  "channels",
  "crossfeed_enabled",
  "crossfeed_frequency",
  "crossfeed_level",
  "crossfeed_preset",
  "matrix_enabled",
  "matrix_engine",
  "matrix_expand_hf",
  "matrix_iir2fir",
  "matrix_pipelines",
  "matrix_profile_delete",
  "matrix_profile_save",
  "pipelines",
];

// Sweep the schema once: which tabs each key's staged edit lights.
async function sweepSchema() {
  const lit = new Map();
  for (const key of Object.keys(schema)) {
    await reset();
    await edit(key, "1");
    lit.set(key, [...dirtyTabs.value]);
  }
  return lit;
}

test("exactly the Matrix controls light the Matrix tab", async () => {
  const lit = await sweepSchema();
  const observed = [...lit].filter(([, tabs]) => tabs.length === 1 && tabs[0] === "matrix").map(([key]) => key);
  assert.deepEqual(observed.sort(), [...MATRIX_KEYS].sort());
});

// The other direction: no key outside the Matrix set may put "matrix" anywhere in
// its tab list, whether alone or alongside another tab through coupling.
test("no non-Matrix control lights the Matrix tab", async () => {
  const dsp = new Set(MATRIX_KEYS);
  const lit = await sweepSchema();
  const strays = [...lit].filter(([key, tabs]) => tabs.includes("matrix") && !dsp.has(key)).map(([key]) => key);
  assert.deepEqual(strays, []);
});

// Companion to the guard above: a key whose staged edit reads clean lights no
// tab at all, so it would drop out of the observed set silently rather than
// landing in the wrong place. Nothing may stage clean under this sweep's value.
test("every schema key stages an edit that lights a tab", async () => {
  const lit = await sweepSchema();
  const silent = [...lit].filter(([, tabs]) => tabs.length === 0).map(([key]) => key);
  assert.deepEqual(silent, []);
});

// --- the wire under the moved controls ----------------------------------------
// Moving a control to another tab is pure presentation: each one still stages
// on the lane and wire field it always had (docs/settings-classification.md —
// idle_time, upnp_freewheel, quick_pause, short_buffer, channels, gain_comp and
// pre_before_meter are http-lane form fields under their own names; the
// high-frequency filter has the live SetJunkFilter setter). These pin today's
// wire, so a tab move that also rewired a field fails here.

const HTTP_MOVED = [
  "channels",
  "gain_comp",
  "idle_time",
  "quick_pause",
  "short_buffer",
  "upnp_freewheel",
  "pre_before_meter",
];

for (const key of HTTP_MOVED) {
  test(`a staged ${key.replaceAll("_", " ")} still rides the http lane under its own field name`, async () => {
    const w = await reset();
    await edit(key, "1");
    assert.ok(key in w.staged.http && !(key in w.staged.live));
  });
}

test("a staged high-frequency filter still rides the live lane under its own key", async () => {
  const w = await reset();
  await edit("junk_filter", "3");
  assert.ok("junk_filter" in w.staged.live && !("junk_filter" in w.staged.http));
});
