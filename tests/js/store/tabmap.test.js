// Behavioral suite for store/tabmap.js — which tab a staged edit lights up.
//
// The mapping is hand-maintained (schema `group` is not the tab), and its
// failure mode is silent: a key nobody listed falls through to the DSP tab, so a
// change made on Output or Volume accents a tab the control isn't on. Three
// things are pinned here. Named controls that moved between tabs and must land
// where they are rendered; the VolumeRangeBar trio (volume_min, volume_max,
// startup_volume), which is the reported defect — a volume edit accenting DSP;
// and a sweep of the whole schema that pins the DSP tab's membership literally,
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
  stagingWire();
  engineState.value = { filter_junk: 0 };
  config.value = { fields: [{ name: "pre_before_meter", value: false }], file: {}, active: "", profiles: null };
  await discardAll();
}

test("a staged high-frequency filter lights the output tab", async () => {
  await reset();
  await edit("junk_filter", "3");
  assert.deepEqual([...dirtyTabs.value], ["output"]);
});

test("a staged pre-process before metering lights the output tab", async () => {
  await reset();
  await edit("pre_before_meter", "1");
  assert.deepEqual([...dirtyTabs.value], ["output"]);
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

test("a staged minimum volume does not light the DSP tab", async () => {
  await reset();
  await edit("volume_min", "-60");
  assert.equal(dirtyTabs.value.has("matrix"), false);
});

// The anti-recurrence guard for the whole schema. The mapping's fallback is
// silent: a key no tab set claims lands on the DSP tab, so a control that lives
// on Output or Volume under a name nobody enumerated accents "matrix" with
// nothing failing. A name prefix is not the test for DSP membership — `pipelines`
// is a genuine DSP control carrying no prefix — so the DSP set is pinned
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
// in a non-DSP key's list.
const DSP_KEYS = [
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

test("exactly the DSP controls light the DSP tab", async () => {
  const lit = await sweepSchema();
  const observed = [...lit].filter(([, tabs]) => tabs.length === 1 && tabs[0] === "matrix").map(([key]) => key);
  assert.deepEqual(observed.sort(), [...DSP_KEYS].sort());
});

// The other direction: no key outside the DSP set may put "matrix" anywhere in
// its tab list, whether alone or alongside another tab through coupling.
test("no non-DSP control lights the DSP tab", async () => {
  const dsp = new Set(DSP_KEYS);
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
