// Behavioral suite for the GENERATION row a modulator option's hover tip
// carries: one metadata row keyed `generation`, whose value reads the
// modulator's generation as an ordinal (ASDM7ECv3 -> "6th").
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
// The row's VALUE is asserted because it is derived data, not prose: "6th" is a
// rendering of the number 6, and the ordinal suffix is not uniform across the
// set, so several suffix shapes are covered.
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
// name each also carry a `generation` entry under `shapers.sdm_modulators`, so
// a resolver that looks every option's label up in that overlay with no gate on
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

// The real generation of each shipped modulator, and the ordinal a reader sees.
/** @type {[name: string, generation: number, ordinal: string][]} */
const GENERATIONS = [
  ["DSD5", 1, "1st"],
  ["DSD7", 2, "2nd"],
  ["ASDM5", 3, "3rd"],
  ["ASDM5EC", 4, "4th"],
  ["ASDM7ECv2", 5, "5th"],
  ["ASDM7ECv3", 6, "6th"],
  ["ASDM7EC-super", 7, "7th"],
  ["AHM7EC8B", 8, "8th"],
];

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
  ...Object.fromEntries(GENERATIONS.map(([name, generation]) => [name, { generation }])),
  [UNGENERATIONED]: { description: "Seventh order modulator." },
  [FILTER]: { generation: 6 },
  [DITHER]: { generation: 3 },
};

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
 * @returns {Promise<[key: string, heading: string, value: string, codes: string[]][]>}
 */
async function modulatorRows(label) {
  await reset({ meta: META_GEN });
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

const GENERATION = "generation";

// ============================================================================
// the modulator tip carries the generation row
// ============================================================================

for (const [name, , ordinal] of GENERATIONS) {
  test(`test_the_${name.replace(/[^a-z0-9]/gi, "_")}_tip_reads_its_generation_as_the_ordinal_${ordinal}`, async () => {
    assert.equal(valueOf(await modulatorRows(name), GENERATION), ordinal);
  });
}

test("test_a_modulator_tip_carries_the_generation_row_and_no_other_metadata_row", async () => {
  assert.deepEqual(keysOf(await modulatorRows("ASDM7ECv3")), [GENERATION]);
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
