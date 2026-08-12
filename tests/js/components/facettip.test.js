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
// rows exist and what they say, not their order. Spec ambiguity, reading
// taken: multi-value genre/focus row values are matched case-insensitively —
// the spec fixes the ", " join and the member order, not the casing.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/facettip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { filterTipFacets } from "../../../hqptuner/static/components/facettip.js";
import { tipsFor } from "../../../hqptuner/static/components/Field.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";
import { reset, META } from "../support/field-harness.js";

const FILTER_META = META.settings.dsp.filter_1x;
const SHAPER_META = META.settings.dsp.shaper;
const INTEGRATOR_META = META.settings.dsp.sdm_integrator;

// --- fixtures -----------------------------------------------------------------

/**
 * One `<FiltersItem/>` as the enumeration serves it — all-string attributes,
 * `arg` the flags bitfield (bit 0 = apodizing, bit 1 = half-apodizing;
 * protocol.md:226). The backend derives `apodizing` from bit 0, so the two
 * always agree.
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
  arg,
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

test("test_an_xlong_name_token_renders_an_extra_long_length_row", () => {
  seed([{ name: "poly-sinc-xlong", description: "4/5 ⥮ Any" }]);
  assert.deepEqual(row("poly-sinc-xlong", "Length"), ["Length", "Extra long"]);
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
  assert.match(String((row("gauss-plain", "Genre") || [])[1]), /jazz, classical/i);
});

test("test_a_multi_focus_list_joins_with_comma_space", () => {
  seed([{ name: "gauss-a", description: "4/5 timbre, transients ⥮ Any" }]);
  assert.match(String((row("gauss-a", "Focus") || [])[1]), /timbre, transients/i);
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

test("test_a_name_without_length_tokens_renders_no_length_row", () => {
  seed([{ name: "gauss-plain", description: "4/5 ⥮ Any" }]);
  assert.equal(rowKeys("gauss-plain").includes("Length"), false);
});

test("test_a_filter_without_ratio_renders_no_ratio_row", () => {
  seed([], { "closed-form": { quality: 3 } });
  assert.equal(rowKeys("closed-form").includes("Ratio"), false);
});

// ============================================================================
// filterTipFacets — mode-split ratio
// ============================================================================

test("test_a_mode_split_ratio_renders_one_pcm_and_sdm_valued_ratio_row", () => {
  seed([], { "closed-form": { ratio_pcm: "integer", ratio_sdm: "integer" } });
  assert.deepEqual(
    filterTipFacets("closed-form").rows.filter((r) => r[0] === "Ratio"),
    [["Ratio", "PCM Integer · SDM Integer"]],
  );
});

// ============================================================================
// filterTipFacets — chips
// ============================================================================

test("test_a_live_apodizing_filter_carries_the_apodizing_chip", () => {
  seed([{ name: "gauss-apod", description: "4/5 ⥮ Any", arg: 1 }]);
  assert.deepEqual(filterTipFacets("gauss-apod").chips, ["Apodizing"]);
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
// tipsFor — the filter tip's text is today's manual prose
// ============================================================================

test("test_a_filter_option_tip_text_is_the_manual_description_and_notes", async () => {
  await reset();
  const tip = tipsFor(schema.pcm_filter_1x, FILTER_META);
  assert.equal(tip({ value: "0", label: "sinc-S" }).text, "A short sinc. Not recommended.");
});

test("test_a_filter_option_tip_text_resolves_through_an_alias", async () => {
  await reset();
  const tip = tipsFor(schema.pcm_filter_1x, FILTER_META);
  assert.equal(tip({ value: "0", label: "poly-sinc-xtr-mp" }).text, "Extra transient.");
});

test("test_a_two_stage_filter_option_tip_appends_the_two_stage_note", async () => {
  await reset();
  const tip = tipsFor(schema.pcm_filter_1x, FILTER_META);
  assert.equal(tip({ value: "0", label: "sinc-M-2s" }).text, "A very long sinc. Two stage oversampling.");
});

// ============================================================================
// tipsFor — the filter tip carries the filter's facets
// ============================================================================

test("test_a_filter_option_tip_carries_the_filters_facet_rows", async () => {
  await reset();
  enums.value = { filters: [item("sinc-M", "4/5 ⥮ Int", 0)] };
  const tip = tipsFor(schema.pcm_filter_1x, FILTER_META);
  assert.deepEqual(
    tip({ value: "0", label: "sinc-M" }).rows.find((r) => r[0] === "Quality"),
    ["Quality", "4/5"],
  );
});

test("test_a_filter_option_tip_carries_the_filters_chips", async () => {
  await reset();
  enums.value = { filters: [item("sinc-M", "4/5 ⥮ Int", 0, 1)] };
  const tip = tipsFor(schema.pcm_filter_1x, FILTER_META);
  assert.deepEqual(tip({ value: "0", label: "sinc-M" }).chips, ["Apodizing"]);
});

test("test_a_filter_absent_from_the_facet_map_tips_empty_rows_and_chips", async () => {
  await reset();
  const tip = tipsFor(schema.pcm_filter_1x, FILTER_META);
  const content = tip({ value: "9", label: "made-up" });
  assert.deepEqual([content.rows, content.chips], [[], []]);
});

// ============================================================================
// tipsFor — dither, modulator and config-desc tips stay prose-only
// ============================================================================

test("test_a_dither_option_tip_is_prose_only", async () => {
  await reset();
  const tip = tipsFor(schema.pcm_dither, SHAPER_META);
  assert.deepEqual(tip({ value: "0", label: "TPDF" }), { text: "Triangular dither.", rows: [], chips: [] });
});

test("test_a_modulator_option_tip_is_prose_only", async () => {
  await reset();
  const tip = tipsFor(schema.sdm_modulator, SHAPER_META);
  assert.deepEqual(tip({ value: "0", label: "ASDM7" }), { text: "Seventh order modulator.", rows: [], chips: [] });
});

test("test_a_config_desc_option_tip_is_prose_only", async () => {
  await reset();
  const tip = tipsFor(schema.sdm_integrator, INTEGRATOR_META);
  assert.deepEqual(tip({ value: "1", label: "Slow" }), { text: "Slow integrator.", rows: [], chips: [] });
});

// ============================================================================
// tipsFor — non-desc entries have no tip resolver
// ============================================================================

test("test_a_non_desc_entry_has_no_tip_resolver", async () => {
  await reset();
  assert.equal(tipsFor(schema.idle_time, { label: "Idle", tooltip: "Idle prose." }), undefined);
});
