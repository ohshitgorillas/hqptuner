// Behavioral suite for the GENERATION row a modulator option's hover tip
// carries: one metadata row keyed `generation`, whose heading is non-empty and
// whose value reads the modulator's generation as an ordinal (ASDM7ECv3 -> the
// ordinal of whatever number the overlay states for it).
//
// The fact is the static shaper overlay's `generation`, joined to the engine's
// own modulator name (docs/architecture.md §2) and reaching the client through
// /api/metadata under `shapers.sdm_modulators` — the same record whose
// `min_rate_hz` already grays and badges a row. Tips are resolved through
// `tipsFor(entry, meta)` (components/binder.js), the per-option resolver the
// dropdown calls, and a row is the 4-tuple `[key, heading, value, codes]`.
//
// A filter's facet rows are stated the way facettip.test.js states them: the
// engine's own `<GetFilters/>` description for quality, focus and ratio
// (docs/protocol.md:226), the filter's NAME for phase and length, and the
// static filters overlay for genre. Both source signals are assigned together —
// module-level signals outlive a test, and a partial seed makes cases pass
// alone and fail in sequence.
//
// Rows are addressed by their KEY, the machine identity, and never by the
// heading beside them, which is the owner's wording (docs/testing.md rule 9).
// The heading is therefore pinned only as a non-empty string; the row's VALUE
// is asserted because it is derived data, not prose: "6th" is a rendering of
// the number 6. One case per ordinal suffix branch — 1st, 2nd, 3rd and one of
// the `th` run, which 4 through 8 share.
//
// The join itself is pinned by the CONTRADICTING case: one modulator seeded
// with a generation its name does not imply, whose row must read the seeded
// number. Without it a resolver that renders an ordinal from a hardcoded
// name-to-generation table, gated only on the overlay entry existing, passes
// every positive case while never reading the overlay datum.
//
// Readings taken where the spec left room:
//   - the overlay carries `generation` as a NUMBER, alongside the numeric
//     `order` / `min_rate_hz` keys it sits with, and the ordinal is built for
//     display.
//   - the row's `codes` member is not pinned: the spec states the key, the
//     heading and the value, and says nothing about what a generation row's
//     codes are.
//
// The fixtures make the negative cases bite: the filter name and the dither
// name each also carry a `generation` entry under `shapers.sdm_modulators`,
// keyed through the same GENERATION constant the assertions read, so a
// resolver that looks every option's label up in that overlay with no gate on
// which dropdown it is decorating grows a row here and fails, rather than
// passing on a fixture with nothing to find.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/modulator-generation.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { tipsFor } from "../../../hqptuner/static/components/binder.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { enums } from "../../../hqptuner/static/store/signals.js";
import { reset, META } from "../support/field-harness.js";

// --- fixtures ---------------------------------------------------------------

/** The overlay key the row is keyed by, and the key the row is keyed under. */
const GENERATION = "generation";

// One shipped modulator per ordinal suffix branch, and the ordinal a reader
// sees. 4 through 8 all take `th`, so one of them stands for the run.
/** @type {[name: string, generation: number, ordinal: string][]} */
const GENERATIONS = [
  ["DSD5", 1, "1st"],
  ["DSD7", 2, "2nd"],
  ["ASDM5", 3, "3rd"],
  ["ASDM7ECv3", 6, "6th"],
];

// The modulator the whole-row and join cases speak about.
const MODULATOR = "ASDM7ECv3";

// A modulator whose overlay record exists but states no generation, and a
// modulator with no overlay record at all.
const UNGENERATIONED = "ASDM7";
const UNKNOWN_MODULATOR = "made-up-modulator";

// The filter and the dither the negative cases read, both planted in the
// modulator overlay with a generation of their own. The filter's name carries a
// phase token (-lp) and a length token (-long).
const FILTER = "poly-sinc-lp-long";
const DITHER = "TPDF";

/** The modulator overlay every case is served. */
const MODULATOR_OVERLAY = {
  ...Object.fromEntries(GENERATIONS.map(([name, generation]) => [name, { [GENERATION]: generation }])),
  [UNGENERATIONED]: { description: "Seventh order modulator." },
  [FILTER]: { [GENERATION]: 6 },
  [DITHER]: { [GENERATION]: 3 },
};

// The same overlay with one modulator's generation replaced by a number its
// name does not imply.
const CONTRADICTED = 2;
const CONTRADICTED_ORDINAL = "2nd";
const CONTRADICTING_OVERLAY = { ...MODULATOR_OVERLAY, [MODULATOR]: { [GENERATION]: CONTRADICTED } };

/**
 * The /api/metadata payload, restated over the harness fixture with a
 * name-keyed overlay for each of the two maps these tips read. Both are LOOSE
 * records: a filter's facet keys (`genre` here) are overlay facts an
 * OverlayEntry does not declare, and facettip.test.js seeds them the same way.
 * A fresh object every call — writing the same object reference to a signal
 * does not notify.
 *
 * @param {Record<string, Record<string, unknown>>} filters
 * @param {Record<string, Record<string, unknown>>} modulators
 */
const metaWith = (filters, modulators) => ({
  ...META,
  filters: { ...META.filters, filters },
  shapers: { ...META.shapers, sdm_modulators: modulators },
});

// The modulator cases need no filter facts; the filters overlay carries the
// planted filter as an ordinary described entry.
const META_GEN = metaWith(
  { ...META.filters.filters, [FILTER]: { description: "A planted filter." } },
  MODULATOR_OVERLAY,
);

const META_CONTRADICTING = metaWith(
  { ...META.filters.filters, [FILTER]: { description: "A planted filter." } },
  CONTRADICTING_OVERLAY,
);

// The filter cases add the one facet the engine's description and the filter's
// name cannot state.
const META_FILTER_FACETS = metaWith({ ...META.filters.filters, [FILTER]: { genre: ["jazz"] } }, MODULATOR_OVERLAY);

const SHAPER_META = META.settings.dsp.shaper;
const FILTER_META = META.settings.dsp.filter_1x;

/**
 * One `<FiltersItem/>` as `<GetFilters/>` serves it (docs/protocol.md:226) —
 * every attribute a string, `arg` the flags bitfield. This description states a
 * quality, a focus and an integer ratio.
 */
const FILTER_ITEM = {
  index: "0",
  name: FILTER,
  value: "0",
  arg: "0",
  description: "4/5 timbre ⥮ Int",
  apodizing: false,
};

// --- helpers ----------------------------------------------------------------

/**
 * The tip resolver for a desc-carrying entry — throws (not an assertion)
 * rather than returning undefined, so tests can invoke it directly under
 * strict checkJs.
 *
 * @param {Parameters<typeof tipsFor>[0]} entry
 * @param {Parameters<typeof tipsFor>[1]} meta
 */
function resolver(entry, meta) {
  const fn = tipsFor(entry, meta);
  if (!fn) throw new Error("expected a tip resolver for this entry");
  return fn;
}

/**
 * Seed every signal the tip reads, then hand back the modulator tip's rows.
 *
 * @param {string} label
 * @param {import("../../../hqptuner/static/store/prose.js").Metadata} [meta]
 * @returns {Promise<[key: string, heading: string, value: string, codes: string[]][]>}
 */
async function modulatorRows(label, meta = META_GEN) {
  await reset({ meta });
  return resolver(schema.sdm_modulator, SHAPER_META)({ value: "0", label }).rows;
}

/**
 * @param {[key: string, heading: string, value: string, codes: string[]][]} rows
 * @returns {string[]}
 */
const keysOf = (rows) => rows.map((r) => r[0]);

/**
 * The value of the row keyed `key`, or undefined when no such row exists —
 * which fails an assertion rather than passing as an empty string.
 *
 * @param {[key: string, heading: string, value: string, codes: string[]][]} rows
 * @param {string} key
 * @returns {string | undefined}
 */
const valueOf = (rows, key) => (rows.find((r) => r[0] === key) || [])[2];

/**
 * Whether the row keyed `key` states a non-empty heading, with the reason it
 * does not — the heading's wording is the owner's, so only its presence and
 * kind are pinned (docs/testing.md rule 9).
 *
 * @param {[key: string, heading: string, value: string, codes: string[]][]} rows
 * @param {string} key
 * @returns {[boolean, string]}
 */
function headingIsNonEmpty(rows, key) {
  const row = rows.find((r) => r[0] === key);
  if (!row) return [false, `no row keyed ${key}`];
  const heading = row[1];
  return [typeof heading === "string" && heading.trim() !== "", `heading of ${key} is ${JSON.stringify(heading)}`];
}

// ============================================================================
// the modulator tip carries the generation row
// ============================================================================

for (const [name, generation, ordinal] of GENERATIONS) {
  test(`test_generation_${generation}_reads_${ordinal}`, async () => {
    assert.equal(valueOf(await modulatorRows(name), GENERATION), ordinal);
  });
}

test("test_a_modulator_tip_reads_the_generation_its_overlay_entry_states_rather_than_one_implied_by_its_name", async () => {
  assert.equal(valueOf(await modulatorRows(MODULATOR, META_CONTRADICTING), GENERATION), CONTRADICTED_ORDINAL);
});

test("test_the_generation_row_states_a_non_empty_heading", async () => {
  assert.ok(...headingIsNonEmpty(await modulatorRows(MODULATOR), GENERATION));
});

test("test_a_modulator_tip_carries_the_generation_row_and_no_other_metadata_row", async () => {
  assert.deepEqual(keysOf(await modulatorRows(MODULATOR)), [GENERATION]);
});

// ============================================================================
// a modulator with nothing to say carries no generation row
// ============================================================================

test("test_a_modulator_with_no_overlay_entry_carries_no_generation_row", async () => {
  assert.equal(keysOf(await modulatorRows(UNKNOWN_MODULATOR)).includes(GENERATION), false);
});

test("test_a_modulator_whose_overlay_entry_states_no_generation_carries_no_generation_row", async () => {
  assert.equal(keysOf(await modulatorRows(UNGENERATIONED)).includes(GENERATION), false);
});

// ============================================================================
// the filter tip is unaffected
// ============================================================================

/**
 * Serve the filter as the engine enumerates it AND as the overlay describes it,
 * then hand back its tip's rows.
 *
 * @param {typeof schema.pcm_filter_1x} entry
 * @returns {Promise<[key: string, heading: string, value: string, codes: string[]][]>}
 */
async function filterRows(entry) {
  await reset({ meta: META_FILTER_FACETS });
  enums.value = { filters: [FILTER_ITEM] };
  return resolver(entry, FILTER_META)({ value: "0", label: FILTER }).rows;
}

for (const facet of ["quality", "genre", "focus", "phase", "length", "ratio"]) {
  test(`test_a_filter_tip_still_carries_its_${facet}_row`, async () => {
    assert.equal(keysOf(await filterRows(schema.pcm_filter_1x)).includes(facet), true);
  });
}

test("test_a_filter_tip_carries_no_generation_row", async () => {
  assert.equal(keysOf(await filterRows(schema.pcm_filter_1x)).includes(GENERATION), false);
});

test("test_an_sdm_filter_tip_carries_no_generation_row", async () => {
  assert.equal(keysOf(await filterRows(schema.sdm_filter_1x)).includes(GENERATION), false);
});

// ============================================================================
// the dither tip is unaffected
// ============================================================================

test("test_a_dither_tip_carries_no_metadata_rows_at_all", async () => {
  await reset({ meta: META_GEN });
  assert.deepEqual(resolver(schema.pcm_dither, SHAPER_META)({ value: "0", label: DITHER }).rows, []);
});
