// Behavioral suite for the filter hover tip's facet block: filterTipFacets
// (components/facettip.js) — the rows and boolean chips one filter's tip
// carries — and the changed tipsFor (components/Field.js), whose resolver now
// returns { text, rows, chips } instead of bare prose.
//
// Policy (docs/testing.md): public API only, one assertion per test, state
// driven through the exported source signals with wire-shaped payloads.
// `enums.filters` is the engine's `<GetFilters/>` enumeration
// ({index, name, value, arg, description}, protocol.md:226) with descriptions
// hand-written in the engine's own format, `"<q>/5 [focus, ...] <glyph>
// <ratio>"`, PCM glyph `⥮`, abbreviated ratio tails (`Int`, `Any`).
// `metadata.filters.filters` is the static name-keyed overlay served by
// /api/metadata; the running engine is enumeration authority, so the overlay
// only fills filters the live enum lacks (architecture §2).
//
// tipsFor cases ride the field-harness reset(), whose META payload carries the
// worked filters overlay (alias, notes, two_stage_note), dithers and
// modulators — the same fixtures the prose suites pin "today's" tip text with.
//
// Rows are looked up by their label, never by position: the spec fixes which
// rows exist and what they say, not their order. Spec ambiguity, readings
// taken: multi-value genre/focus row values are compared case-insensitively —
// the spec fixes the ", " join and the member order, not the casing. And
// behaviour 10's "static fills only filters the live enum lacks" is read
// PER-FACET, not per-filter — a live-enumerated filter still takes its Genre
// (and other static-only facets) from the overlay, since live items never
// carry genre.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/facettip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterTipFacets } from "../../../hqptuner/static/components/facettip.js";
import { tipsFor } from "../../../hqptuner/static/components/Field.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";
import { reset, META } from "../support/field-harness.js";

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

const FILTER_META = META.settings.dsp.filter_1x;
const SHAPER_META = META.settings.dsp.shaper;
const INTEGRATOR_META = META.settings.dsp.sdm_integrator;

// --- fixtures -----------------------------------------------------------------

/**
 * One `<FiltersItem/>` as the enumeration serves it — all-string attributes
 * (every daemon attribute arrives as a string), `arg` the flags bitfield
 * (bit 0 = apodizing, bit 1 = half-apodizing; protocol.md:226). The
 * pre-derived `apodizing` boolean is the backend-merged shape the frontend
 * receives: the backend adds it from bit 0 during the overlay merge, so the
 * two always agree.
 *
 * @param {string} name
 * @param {string} description
 * @param {number} index
 * @param {number} [arg]
 */
const item = (name, description, index, arg = 0) => ({
  index: String(index),
  name,
  value: String(index),
  arg: String(arg),
  description,
  apodizing: Boolean(arg & 1),
});

/**
 * Reassign BOTH facet source signals — module-level signals outlive a test,
 * and a partial seed makes tests pass alone and fail in sequence.
 *
 * @param {{ name: string, description: string, arg?: number }[]} live
 * @param {Record<string, Record<string, unknown>>} [overlay]
 */
function seed(live, overlay = {}) {
  enums.value = { filters: live.map((f, i) => item(f.name, f.description, i, f.arg ?? 0)) };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
}

/**
 * The named row of one filter's facet block, or undefined.
 *
 * @param {string} name
 * @param {string} key
 * @returns {[string, string] | undefined}
 */
const row = (name, key) => filterTipFacets(name).rows.find((r) => r[0] === key);

/**
 * The row labels of one filter's facet block.
 *
 * @param {string} name
 * @returns {string[]}
 */
const rowKeys = (name) => filterTipFacets(name).rows.map((r) => r[0]);

/**
 * Case-insensitive equality of a row's value — pins the exact ", " join and
 * membership while keeping casing latitude. Builds the condition for the one
 * assert at the call site.
 *
 * @param {[string, string] | undefined} pair
 * @param {string} expected
 * @returns {[boolean, string]}
 */
const rowValueIs = (pair, expected) => {
  const got = String((pair || [])[1]);
  return [got.toLowerCase() === expected, `expected row value "${expected}", got "${got}"`];
};

// ============================================================================
// filterTipFacets — unknown names
// ============================================================================

test("test_an_unknown_filter_name_yields_empty_rows_and_chips", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(filterTipFacets("no-such-filter"), { rows: [], chips: [] });
});

// ============================================================================
// filterTipFacets — rows carry the facets that hold
// ============================================================================

test("test_a_live_quality_renders_as_n_of_5", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("gauss-plain", "Quality"), ["Quality", "4/5"]);
});

test("test_a_static_only_filter_takes_its_quality_from_the_overlay", () => {
  seed([], { "closed-form": { quality: 3 } });
  assert.deepEqual(row("closed-form", "Quality"), ["Quality", "3/5"]);
});

test("test_a_linear_phase_name_token_renders_a_linear_phase_row", () => {
  seed([{ name: "poly-sinc-lp", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("poly-sinc-lp", "Phase"), ["Phase", "Linear"]);
});

// The xlong class has no literal name token: it derives from an -xl/-xla
// suffix (or a fixed per-name override table). "Extra long" is its label.
test("test_an_xla_suffixed_name_renders_an_extra_long_length_row", () => {
  seed([{ name: "poly-sinc-ext2-xla", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("poly-sinc-ext2-xla", "Length"), ["Length", "Extra long"]);
});

test("test_a_minimum_phase_name_token_renders_a_minimum_phase_row", () => {
  seed([{ name: "poly-sinc-mp", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("poly-sinc-mp", "Phase"), ["Phase", "Minimum"]);
});

test("test_an_intermediate_phase_name_token_renders_an_intermediate_phase_row", () => {
  seed([{ name: "poly-sinc-ip", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("poly-sinc-ip", "Phase"), ["Phase", "Intermediate"]);
});

test("test_a_long_name_substring_renders_a_long_length_row", () => {
  seed([{ name: "poly-sinc-gauss-long", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("poly-sinc-gauss-long", "Length"), ["Length", "Long"]);
});

test("test_an_xl_suffixed_name_renders_an_extra_long_length_row", () => {
  seed([{ name: "poly-sinc-ext3-xl", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("poly-sinc-ext3-xl", "Length"), ["Length", "Extra long"]);
});

// sinc-M carries no length token at all: its xlong class comes from the fixed
// per-name override table.
test("test_an_override_table_name_renders_its_extra_long_length_row", () => {
  seed([{ name: "sinc-M", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("sinc-M", "Length"), ["Length", "Extra long"]);
});

test("test_an_any_genre_filter_renders_all_genres", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }], { "gauss-plain": { genre: ["any"] } });
  assert.deepEqual(row("gauss-plain", "Genre"), ["Genre", "All genres"]);
});

test("test_a_live_integer_ratio_renders_an_integer_ratio_row", () => {
  seed([{ name: "rat-int", description: "4/5 ⥮ Int" }]);
  assert.deepEqual(row("rat-int", "Ratio"), ["Ratio", "Integer"]);
});

test("test_a_multi_genre_list_joins_with_comma_space", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }], { "gauss-plain": { genre: ["jazz", "classical"] } });
  assert.ok(...rowValueIs(row("gauss-plain", "Genre"), "jazz & blues, classical"));
});

test("test_a_multi_focus_list_joins_with_comma_space", () => {
  seed([{ name: "gauss-a", description: "4/5 timbre, transients ⥮ Any" }]);
  assert.ok(...rowValueIs(row("gauss-a", "Focus"), "timbre, transients"));
});

// ============================================================================
// filterTipFacets — a facet with no value produces no row
// ============================================================================

test("test_a_filter_without_quality_renders_no_quality_row", () => {
  seed([], { "closed-form": { genre: ["jazz"] } });
  assert.equal(rowKeys("closed-form").includes("Quality"), false);
});

test("test_a_name_without_phase_tokens_renders_no_phase_row", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }]);
  assert.equal(rowKeys("gauss-plain").includes("Phase"), false);
});

test("test_an_empty_genre_list_renders_no_genre_row", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }], { "gauss-plain": { genre: [] } });
  assert.equal(rowKeys("gauss-plain").includes("Genre"), false);
});

test("test_a_filter_without_focus_renders_no_focus_row", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }]);
  assert.equal(rowKeys("gauss-plain").includes("Focus"), false);
});

// Length is not an empty-able facet: every filter carries a length class, and
// a name with no length token classifies as medium — so the row always shows.
test("test_a_name_without_length_tokens_renders_a_medium_length_row", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("gauss-plain", "Length"), ["Length", "Medium"]);
});

test("test_a_filter_without_ratio_renders_no_ratio_row", () => {
  seed([], { "closed-form": { quality: 3 } });
  assert.equal(rowKeys("closed-form").includes("Ratio"), false);
});

// ============================================================================
// filterTipFacets — mode-split ratio
// ============================================================================

// The two sides differ on purpose: equal values would pass under a PCM/SDM swap.
test("test_a_mode_split_ratio_renders_one_pcm_and_sdm_valued_ratio_row", () => {
  seed([], { "closed-form": { ratio_pcm: "integer", ratio_sdm: "2x" } });
  assert.deepEqual(
    filterTipFacets("closed-form").rows.filter((r) => r[0] === "Ratio"),
    [["Ratio", "PCM Integer · SDM 2x"]],
  );
});

// ============================================================================
// filterTipFacets — an "any" ratio renders its label, never the raw token
// ============================================================================

test("test_a_live_any_ratio_renders_the_any_label", () => {
  seed([{ name: "rat-any", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("rat-any", "Ratio"), ["Ratio", "Any"]);
});

test("test_a_static_any_ratio_renders_the_any_label", () => {
  seed([], { "closed-form": { ratio: "any" } });
  assert.deepEqual(row("closed-form", "Ratio"), ["Ratio", "Any"]);
});

test("test_a_mode_split_any_side_renders_the_any_label", () => {
  seed([], { "closed-form": { ratio_pcm: "any", ratio_sdm: "2x" } });
  assert.deepEqual(row("closed-form", "Ratio"), ["Ratio", "PCM Any · SDM 2x"]);
});

// ============================================================================
// filterTipFacets — chips
// ============================================================================

test("test_a_live_apodizing_filter_carries_the_apodizing_chip", () => {
  seed([{ name: "gauss-apod", description: "4/5 ⥮ Any", arg: 1 }]);
  assert.deepEqual(filterTipFacets("gauss-apod").chips, ["Apodizing"]);
});

// Bit 1 of the raw (string) arg is read in the frontend; the backend derives a
// boolean field for bit 0 only, so the item carries no derived half field and
// its `apodizing` boolean stays false.
test("test_a_live_half_apodizing_filter_carries_the_half_apodizing_chip", () => {
  seed([{ name: "gauss-hapod", description: "4/5 ⥮ Any", arg: 2 }]);
  assert.deepEqual(filterTipFacets("gauss-hapod").chips, ["Half apodizing"]);
});

test("test_a_half_apodizing_overlay_filter_carries_the_half_apodizing_chip", () => {
  seed([], { "closed-form": { apodizing: "half" } });
  assert.deepEqual(filterTipFacets("closed-form").chips, ["Half apodizing"]);
});

test("test_an_upsample_only_overlay_filter_carries_the_upsample_only_chip", () => {
  seed([], { "closed-form": { upsample_only: true } });
  assert.deepEqual(filterTipFacets("closed-form").chips, ["Upsample only"]);
});

test("test_a_filter_with_no_boolean_facets_carries_no_chips", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(filterTipFacets("gauss-plain").chips, []);
});

// The hi-res chip is deliberately excluded: a hires-named filter earns nothing.
test("test_a_hires_name_earns_no_chip", () => {
  seed([{ name: "gauss-hires", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(filterTipFacets("gauss-hires").chips, []);
});

// ============================================================================
// filterTipFacets — live enumeration outranks the static overlay
// ============================================================================

test("test_live_quality_outranks_a_conflicting_overlay_quality", () => {
  seed([{ name: "gauss-plain", description: "5/5 ⥮ Any" }], { "gauss-plain": { quality: 2 } });
  assert.deepEqual(row("gauss-plain", "Quality"), ["Quality", "5/5"]);
});

test("test_live_ratio_outranks_a_conflicting_overlay_ratio", () => {
  seed([{ name: "rat-int", description: "4/5 ⥮ Int" }], { "rat-int": { ratio: "2x" } });
  assert.deepEqual(row("rat-int", "Ratio"), ["Ratio", "Integer"]);
});

test("test_live_focus_outranks_a_conflicting_overlay_focus", () => {
  seed([{ name: "gauss-a", description: "4/5 timbre ⥮ Any" }], { "gauss-a": { focus: ["transients"] } });
  const value = String((row("gauss-a", "Focus") || [])[1]).toLowerCase();
  assert.deepEqual([value.includes("timbre"), value.includes("transients")], [true, false]);
});

// ============================================================================
// filterTipFacets — the SDM arrow glyph parses like the PCM one
// ============================================================================

test("test_an_sdm_arrow_description_parses_its_quality", () => {
  seed([{ name: "sdm-a", description: "3/5 space ⥣ Int" }]);
  assert.deepEqual(row("sdm-a", "Quality"), ["Quality", "3/5"]);
});

test("test_an_sdm_arrow_description_parses_its_focus", () => {
  seed([{ name: "sdm-a", description: "3/5 space ⥣ Int" }]);
  assert.ok(...rowValueIs(row("sdm-a", "Focus"), "space"));
});

test("test_an_sdm_arrow_description_parses_its_ratio", () => {
  seed([{ name: "sdm-a", description: "3/5 space ⥣ Int" }]);
  assert.deepEqual(row("sdm-a", "Ratio"), ["Ratio", "Integer"]);
});

// ============================================================================
// tipsFor — the filter tip's text is today's manual prose
// ============================================================================

test("test_a_filter_option_tip_text_is_the_manual_description_and_notes", async () => {
  await reset();
  const tip = resolver(schema.pcm_filter_1x, FILTER_META);
  assert.equal(tip({ value: "0", label: "sinc-S" }).text, "A short sinc. Not recommended.");
});

test("test_a_filter_option_tip_text_resolves_through_an_alias", async () => {
  await reset();
  const tip = resolver(schema.pcm_filter_1x, FILTER_META);
  assert.equal(tip({ value: "0", label: "poly-sinc-xtr-mp" }).text, "Extra transient.");
});

test("test_a_two_stage_filter_option_tip_appends_the_two_stage_note", async () => {
  await reset();
  const tip = resolver(schema.pcm_filter_1x, FILTER_META);
  assert.equal(tip({ value: "0", label: "sinc-M-2s" }).text, "A very long sinc. Two stage oversampling.");
});

// ============================================================================
// tipsFor — the filter tip carries the filter's facets
// ============================================================================

test("test_a_filter_option_tip_carries_the_filters_facet_rows", async () => {
  await reset();
  enums.value = { filters: [item("sinc-M", "4/5 ⥮ Int", 0)] };
  const tip = resolver(schema.pcm_filter_1x, FILTER_META);
  assert.deepEqual(
    tip({ value: "0", label: "sinc-M" }).rows.find((r) => r[0] === "Quality"),
    ["Quality", "4/5"],
  );
});

test("test_a_filter_option_tip_carries_the_filters_chips", async () => {
  await reset();
  enums.value = { filters: [item("sinc-M", "4/5 ⥮ Int", 0, 1)] };
  const tip = resolver(schema.pcm_filter_1x, FILTER_META);
  assert.deepEqual(tip({ value: "0", label: "sinc-M" }).chips, ["Apodizing"]);
});

test("test_a_filter_absent_from_the_facet_map_tips_empty_rows_and_chips", async () => {
  await reset();
  const tip = resolver(schema.pcm_filter_1x, FILTER_META);
  const content = tip({ value: "9", label: "made-up" });
  assert.deepEqual([content.rows, content.chips], [[], []]);
});

// The facet map (a live enum naming other filters only) leaves sinc-S's manual
// prose untouched.
test("test_a_filter_absent_from_the_facet_map_keeps_its_manual_prose_text", async () => {
  await reset();
  enums.value = { filters: [item("gauss-plain", "4/5 ⥮ Any", 0)] };
  const tip = resolver(schema.pcm_filter_1x, FILTER_META);
  assert.equal(tip({ value: "1", label: "sinc-S" }).text, "A short sinc. Not recommended.");
});

// ============================================================================
// tipsFor — dither, modulator and config-desc tips stay prose-only
// ============================================================================

test("test_a_dither_option_tip_is_prose_only", async () => {
  await reset();
  const tip = resolver(schema.pcm_dither, SHAPER_META);
  assert.deepEqual(tip({ value: "0", label: "TPDF" }), { text: "Triangular dither.", rows: [], chips: [] });
});

test("test_a_modulator_option_tip_is_prose_only", async () => {
  await reset();
  const tip = resolver(schema.sdm_modulator, SHAPER_META);
  assert.deepEqual(tip({ value: "0", label: "ASDM7" }), { text: "Seventh order modulator.", rows: [], chips: [] });
});

test("test_a_config_desc_option_tip_is_prose_only", async () => {
  await reset();
  const tip = resolver(schema.sdm_integrator, INTEGRATOR_META);
  assert.deepEqual(tip({ value: "1", label: "Slow" }), { text: "Slow integrator.", rows: [], chips: [] });
});

// ============================================================================
// tipsFor — non-desc entries have no tip resolver
// ============================================================================

test("test_a_non_desc_entry_has_no_tip_resolver", async () => {
  await reset();
  assert.equal(tipsFor(schema.idle_time, { label: "Idle", tooltip: "Idle prose." }), undefined);
});
