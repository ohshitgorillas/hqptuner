// Store suite for hqptuner/static/store/faceplate/page/presets.js: `presetRows()`, the Filter presets popover's rows.
// The rows are the Easy Mode table's (store/easy/easy.js) in its own order,
// each subset preset nested under every flagship its version knob names, in that flagship's version; one flagship open
// at a time (`showSubsets`, `foldSubsets`).
//
// Driven at the wire the way the Easy Mode suites are: the LIVE lane is seeded through the shared harness
// (tests/js/support/easy/easytiles.js `resetLive`) with the engine's own enumeration, State and config form. No store
// function is stubbed.
//
// NAMES, NOT WORDS. Preset ids, knob ids and knob positions are wire identifiers; filter names, costs and marks are
// read back through the shipped table (`writeSet`, `filterFor`, `pipsFor`), never typed. Which preset is a subset and
// which a flagship is read off the table too: a subset is a preset with a knob whose every position is another
// preset's id, and the flagships are those positions. The only words asserted are the stand-ins this suite serves as
// metadata.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-page/presets.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

useStorage();

const { resetLive, running } = await import("../../support/easy/easytiles.js");
const { sdmSubject, sdmNames, classedAs } = await import("../../support/easy/easytable.js");
const { presetsFor, filterFor } = await import("../../../../hqptuner/static/store/easy/easy.js");
const { knobsOffered } = await import("../../../../hqptuner/static/store/easy/easyoffer.js");
const { rememberKnobs } = await import("../../../../hqptuner/static/store/easy/easyview.js");
const { metadata, enums } = await import("../../../../hqptuner/static/store/signals.js");
const { presetRows, showSubsets, foldSubsets } =
  await import("../../../../hqptuner/static/store/faceplate/page/presets.js");

/** @typedef {import("../../../../hqptuner/static/store/easy/easy.js").Preset} Preset */
/** @typedef {import("../../../../hqptuner/static/store/easy/easy.js").Knob} Knob */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/page/presets.js").PresetRow} PresetRow */

/** @type {Preset[]} */
const PRESETS = presetsFor();
const IDS = new Set(PRESETS.map((p) => p.id));

/**
 * The knob of a preset whose every position names another preset: its version, when it has one.
 *
 * @param {Preset} preset
 * @returns {Knob | undefined}
 */
const versionKnob = (preset) => preset.knobs.find((k) => k.options.every((o) => IDS.has(o) && o !== preset.id));

const SUBSETS = PRESETS.filter((p) => versionKnob(p) !== undefined);
const FLAGSHIPS = [...new Set(SUBSETS.flatMap((p) => /** @type {Knob} */ (versionKnob(p)).options))];
const TOP = PRESETS.filter((p) => versionKnob(p) === undefined);
const NESTED = FLAGSHIPS.flatMap((under) =>
  SUBSETS.map((sub) => ({ under, sub, vk: String(/** @type {Knob} */ (versionKnob(sub)).id) })),
);

/** The knob positions a preset rests at, each knob at its default. @param {Preset} p */
const resting = (p) => Object.fromEntries(p.knobs.map((k) => [k.id, k.default]));

/** Every row, the nested ones included, keyed by `under>id` (top-level rows by id alone). */
function everyRow() {
  /** @type {Record<string, PresetRow>} */
  const out = {};
  for (const row of presetRows()) {
    out[row.id] = row;
    for (const sub of row.subs || []) out[`${sub.under}>${sub.id}`] = sub;
  }
  return out;
}

/** @param {string} id */
const topRow = (id) => presetRows().find((r) => r.id === id);

/** @param {string} under @param {string} id */
const nestedRow = (under, id) => topRow(under)?.subs.find((s) => s.id === id);

/**
 * One field of every row, keyed as `everyRow` keys them.
 *
 * @template T
 * @param {(row: PresetRow) => T} read
 * @returns {Record<string, T>}
 */
const field = (read) => Object.fromEntries(Object.entries(everyRow()).map(([key, row]) => [key, read(row)]));

/** Every key `everyRow` should produce, each mapped to `value`, `hit` keys to `other`. */
const allKeys = () => [...TOP.map((p) => p.id), ...NESTED.map(({ under, sub }) => `${under}>${sub.id}`)];

/**
 * @param {string[]} hits
 * @returns {Record<string, boolean>}
 */
const litOnly = (hits) => Object.fromEntries(allKeys().map((key) => [key, hits.includes(key)]));

/** @param {Record<string, unknown>} copy */
function serveCopy(copy) {
  const meta = /** @type {Record<string, any>} */ (metadata.value || {});
  metadata.value = /** @type {never} */ ({ ...meta, easy: { ...(meta.easy || {}), ...copy } });
}

// The apodizing class the engine's enumeration states for a filter: its `arg` bit flags (bit 0 apodizing, bit 1
// half-apodizing) and the `apodizing` flag the backend derives from bit 0.
/** @type {Record<string, { arg: string, apodizing: boolean }>} */
const CLASS = {
  full: { arg: "1", apodizing: true },
  half: { arg: "2", apodizing: false },
  none: { arg: "0", apodizing: false },
};

/**
 * Re-serve the running engine's filter enumeration with every filter in class `all`, the names in `except` in theirs.
 *
 * @param {string} all
 * @param {Record<string, string>} [except]
 */
function classify(all, except = {}) {
  const e = /** @type {Record<string, any>} */ (enums.value);
  enums.value = /** @type {never} */ ({
    ...e,
    filters: e.filters.map((/** @type {{ name: string }} */ f) => ({ ...f, ...CLASS[except[f.name] || all] })),
  });
}

/** @param {Parameters<typeof resetLive>[0]} [seams] */
async function live(seams = {}) {
  const w = await resetLive(seams);
  foldSubsets();
  return w;
}

// ============================================================================
// the rows and their nesting
// ============================================================================

test("test_the_top_level_rows_follow_the_table_less_the_nested_presets", async () => {
  await live();
  assert.deepEqual(
    presetRows().map((r) => r.id),
    TOP.map((p) => p.id),
  );
});

test("test_only_the_flagships_carry_nested_rows", async () => {
  await live();
  assert.deepEqual(
    Object.fromEntries(presetRows().map((r) => [r.id, (r.subs || []).length > 0])),
    Object.fromEntries(TOP.map((p) => [p.id, FLAGSHIPS.includes(p.id)])),
  );
});

for (const under of FLAGSHIPS) {
  test(`test_the_${under}_row_nests_every_subset_in_table_order`, async () => {
    await live();
    assert.deepEqual(
      topRow(under)?.subs.map((s) => s.id),
      SUBSETS.map((p) => p.id),
    );
  });
}

// ============================================================================
// what each row names
// ============================================================================

for (const { under, sub, vk } of NESTED) {
  test(`test_${sub.id}_nested_under_${under}_wears_the_mark_its_own_filter_is_stated_with`, async () => {
    await live();
    classify("full", { [filterFor(sub.id, "pcm", { ...resting(sub), [vk]: under })]: "half" });
    assert.equal(nestedRow(under, sub.id)?.mark, "half");
  });
}

// A knob position recorded for a subset reaches its nested rows: the correction setting is per subset, so both copies
// stand where the user last left it, and the row costs what that position costs.
const RECORDED = NESTED.flatMap(({ under, sub, vk }) =>
  knobsOffered(sub, { ...resting(sub), [vk]: under }, "pcm")
    .filter((k) => !k.inert && k.id !== vk && !k.card)
    .flatMap((k) => k.options.filter((o) => o !== k.default).map((o) => ({ under, sub, knob: k.id, at: o }))),
);

for (const { under, sub, knob, at } of RECORDED) {
  test(`test_${sub.id}_recorded_at_${knob}_${at}_stands_that_knob_there_under_${under}`, async () => {
    await live();
    rememberKnobs(sub.id, { [knob]: at });
    assert.equal(nestedRow(under, sub.id)?.knobs.find((k) => k.id === knob)?.value, at);
  });
}

for (const kind of ["half", "none"]) {
  test(`test_every_top_level_row_wears_the_${kind}_mark_when_the_overlay_states_${kind}_for_its_filters`, async () => {
    await live();
    classify(kind);
    assert.deepEqual(
      Object.fromEntries(presetRows().map((r) => [r.id, r.mark])),
      Object.fromEntries(TOP.map((p) => [p.id, kind])),
    );
  });
}

test("test_each_row_takes_its_title_from_the_metadata", async () => {
  await live();
  serveCopy(Object.fromEntries(PRESETS.map((p) => [p.id, { title: `stand-in title ${p.id}` }])));
  assert.deepEqual(
    field((r) => r.title),
    Object.fromEntries(allKeys().map((key) => [key, `stand-in title ${key.split(">").pop()}`])),
  );
});

// ============================================================================
// which row is lit
// ============================================================================

for (const p of TOP) {
  test(`test_running_${p.id}_lights_its_row_and_no_other`, async () => {
    await live({ ...running(p.id, resting(p)) });
    assert.deepEqual(
      field((r) => r.current),
      litOnly([p.id]),
    );
  });
}

for (const { under, sub, vk } of NESTED) {
  test(`test_running_${sub.id}_in_its_${under}_version_lights_the_row_nested_under_${under}_alone`, async () => {
    await live({ ...running(sub.id, { ...resting(sub), [vk]: under }) });
    assert.deepEqual(
      field((r) => r.current),
      litOnly([`${under}>${sub.id}`]),
    );
  });
}

// A top-level row's knob follows the running filters when the row is lit, at every position its knobs offer.
const MOVED = TOP.flatMap((p) =>
  knobsOffered(p, resting(p), "pcm")
    .filter((k) => !k.inert)
    .flatMap((k) => k.options.filter((o) => o !== k.default).map((o) => ({ p, knob: k.id, at: o }))),
);

for (const { p, knob, at } of MOVED) {
  test(`test_running_${p.id}_at_${knob}_${at}_stands_that_knob_there`, async () => {
    await live({ ...running(p.id, { ...resting(p), [knob]: at }) });
    assert.equal(topRow(p.id)?.knobs.find((k) => k.id === knob)?.value, at);
  });
}

// ============================================================================
// offered and grayed
// ============================================================================

const PINNED = { mode: "SDM", output: "sdm", chain: "sdm", engine: { backend: "alsa", anydsd: "0" } };

// A flagship left out takes its nested rows with it: they are drawn under it, and in its version.
test("test_a_preset_reaching_only_2x_filters_at_the_441_base_has_no_row", async () => {
  const subject = sdmSubject();
  await live({ ...PINNED, ratios: classedAs(sdmNames(subject), "2x") });
  assert.deepEqual(
    Object.keys(everyRow()).sort(),
    allKeys()
      .filter((key) => !key.split(">").includes(subject))
      .sort(),
  );
});

test("test_a_preset_reaching_an_unlimited_filter_at_the_441_base_keeps_its_row", async () => {
  const subject = sdmSubject();
  await live({ ...PINNED, ratios: classedAs(sdmNames(subject), "any") });
  assert.equal(
    Object.keys(everyRow()).some((key) => key.split(">").pop() === subject),
    true,
  );
});

// ============================================================================
// one flagship open at a time
// ============================================================================

for (const under of FLAGSHIPS) {
  test(`test_showing_the_${under}_subsets_opens_${under}_alone`, async () => {
    await live();
    for (const other of FLAGSHIPS) showSubsets(other);
    showSubsets(under);
    assert.deepEqual(
      Object.fromEntries(FLAGSHIPS.map((f) => [f, !!topRow(f)?.open])),
      Object.fromEntries(FLAGSHIPS.map((f) => [f, f === under])),
    );
  });
}

test("test_folding_closes_every_flagship", async () => {
  await live();
  showSubsets(FLAGSHIPS[0]);
  foldSubsets();
  assert.deepEqual(
    Object.fromEntries(presetRows().map((r) => [r.id, r.open])),
    Object.fromEntries(TOP.map((p) => [p.id, false])),
  );
});
