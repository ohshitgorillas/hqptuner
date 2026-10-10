// Store suite for hqptuner/static/store/faceplate/page/presets.js: `presetRows()`, the Filter presets popover's rows,
// and `pickPreset`, what a row's press writes. The rows are the Easy Mode table's (store/easy/easy.js) in its own order,
// each subset preset nested under every flagship its version knob names, in that flagship's version; one flagship open
// at a time (`showSubsets`, `foldSubsets`).
//
// Driven at the wire the way the Easy Mode suites are: the LIVE lane is seeded through the shared harness
// (tests/js/support/easy/easytiles.js `resetLive`) with the engine's own enumeration, State and config form, and a
// press leaves over a faked `globalThis.fetch` on `POST /api/config/live`. No store function is stubbed.
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

const { resetLive, running, flush, postedFields, liveExpected } = await import("../../support/easy/easytiles.js");
const { writesHiresFamily, facetless } = await import("../../support/easy/easygray.js");
const { sdmSubject, sdmNames, classedAs } = await import("../../support/easy/easytable.js");
const { presetsFor, filterFor } = await import("../../../../hqptuner/static/store/easy/easy.js");
const { knobsOffered } = await import("../../../../hqptuner/static/store/easy/easyoffer.js");
const { pipsFor } = await import("../../../../hqptuner/static/store/easy/easycost.js");
const { rememberKnobs, setEasyMaterial } = await import("../../../../hqptuner/static/store/easy/easyview.js");
const { metadata, enums } = await import("../../../../hqptuner/static/store/signals.js");
const { presetRows, pickPreset, showSubsets, foldSubsets } =
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

/** @param {string[]} names */
const uniq = (names) => [...new Set(names.filter(Boolean))];

/**
 * The PCM filters a preset names at a set of knob positions, 1x then Nx, one when the two agree.
 *
 * @param {string} id
 * @param {Record<string, string>} knobs
 */
const named = (id, knobs) => uniq([filterFor(id, "pcm", knobs, false), filterFor(id, "pcm", knobs, true)]);

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

for (const p of TOP) {
  test(`test_the_${p.id}_row_names_the_filters_its_resting_positions_write`, async () => {
    await live();
    assert.deepEqual(
      topRow(p.id)?.filters.map((f) => f.name),
      named(p.id, resting(p)),
    );
  });
}

for (const { under, sub, vk } of NESTED) {
  test(`test_${sub.id}_nested_under_${under}_names_the_filters_its_${under}_version_writes`, async () => {
    await live();
    assert.deepEqual(
      nestedRow(under, sub.id)?.filters.map((f) => f.name),
      named(sub.id, { ...resting(sub), [vk]: under }),
    );
  });

  test(`test_${sub.id}_nested_under_${under}_offers_the_knobs_that_version_takes_less_the_version`, async () => {
    await live();
    assert.deepEqual(
      nestedRow(under, sub.id)?.knobs.map((k) => k.id),
      knobsOffered(sub, { ...resting(sub), [vk]: under }, "pcm")
        .filter((k) => !k.inert && k.id !== vk)
        .map((k) => k.id),
    );
  });

  test(`test_${sub.id}_nested_under_${under}_counts_the_pips_that_version_costs`, async () => {
    await live();
    assert.equal(nestedRow(under, sub.id)?.pips, pipsFor(sub.id, "pcm", { ...resting(sub), [vk]: under }));
  });

  test(`test_${sub.id}_nested_under_${under}_wears_the_mark_its_own_filter_is_stated_with`, async () => {
    await live();
    classify("full", { [filterFor(sub.id, "pcm", { ...resting(sub), [vk]: under })]: "half" });
    assert.equal(nestedRow(under, sub.id)?.mark, "half");
  });

  test(`test_${sub.id}_nested_under_${under}_writes_its_${under}_version_when_picked`, async () => {
    const w = await live();
    const row = nestedRow(under, sub.id);
    await pickPreset(sub.id, row?.at || {});
    await flush(w);
    assert.deepEqual(postedFields(w), liveExpected(sub.id, { ...resting(sub), [vk]: under }));
  });
}

// A knob position recorded for a subset reaches its nested rows: the correction setting is per subset, so both copies
// stand where the user last left it, and the row costs what that position costs.
const RECORDED = NESTED.flatMap(({ under, sub, vk }) =>
  knobsOffered(sub, { ...resting(sub), [vk]: under }, "pcm")
    .filter((k) => !k.inert && k.id !== vk && !k.card)
    .flatMap((k) => k.options.filter((o) => o !== k.default).map((o) => ({ under, sub, vk, knob: k.id, at: o }))),
);

for (const { under, sub, vk, knob, at } of RECORDED) {
  test(`test_${sub.id}_recorded_at_${knob}_${at}_stands_that_knob_there_under_${under}`, async () => {
    await live();
    rememberKnobs(sub.id, { [knob]: at });
    assert.equal(nestedRow(under, sub.id)?.knobs.find((k) => k.id === knob)?.value, at);
  });

  test(`test_${sub.id}_recorded_at_${knob}_${at}_under_${under}_counts_the_pips_that_position_costs`, async () => {
    await live();
    rememberKnobs(sub.id, { [knob]: at });
    assert.equal(nestedRow(under, sub.id)?.pips, pipsFor(sub.id, "pcm", { ...resting(sub), [vk]: under, [knob]: at }));
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

test("test_a_row_whose_cost_ranks_against_nothing_reads_the_caption_the_metadata_serves", async () => {
  await live();
  serveCopy(Object.fromEntries(PRESETS.map((p) => [p.id, { cost: `stand-in cost ${p.id}` }])));
  const captioned = NESTED.filter(
    ({ under, sub, vk }) => sub.costText && pipsFor(sub.id, "pcm", { ...resting(sub), [vk]: under }) === 0,
  ).map(({ under, sub }) => [`${under}>${sub.id}`, `stand-in cost ${sub.id}`]);
  const top = TOP.filter((p) => p.costText && pipsFor(p.id, "pcm", resting(p)) === 0).map((p) => [
    p.id,
    `stand-in cost ${p.id}`,
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(field((r) => r.costWord)).filter(([, word]) => word !== "")),
    Object.fromEntries([...top, ...captioned]),
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

test("test_with_the_card_off_its_default_material_the_rows_writing_no_hi_res_filter_gray", async () => {
  await live();
  const card = PRESETS.flatMap((p) => p.knobs).find((k) => k.card);
  setEasyMaterial(String(card?.options.find((o) => o !== card.default)));
  assert.deepEqual(
    Object.fromEntries(presetRows().map((r) => [r.id, r.grayed])),
    Object.fromEntries(TOP.map((p) => [p.id, !writesHiresFamily(p, "pcm") && !facetless(p, "pcm")])),
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

// ============================================================================
// a press writes the preset
// ============================================================================

for (const p of TOP) {
  test(`test_picking_the_${p.id}_row_posts_its_resting_filters_to_the_live_lane`, async () => {
    const w = await live();
    await pickPreset(p.id, topRow(p.id)?.at || {});
    await flush(w);
    assert.deepEqual(postedFields(w), liveExpected(p.id, resting(p)));
  });
}
