// Behavioral suite for the RATE GATE on Easy Mode's preset grid: which presets
// the grid offers a tile for at all, on either of its two lanes.
//
// The behavior. A preset is NOT OFFERED — no tile in the grid, not a disabled
// one, not a dimmed one — when all three of these hold at once:
//
//   1. every filter that preset can write on the SDM chain, across every
//      combination of its knob positions, is rate-limited: the enumeration
//      classes it "2x" or "integer";
//   2. the lane's output mode is sdm; and
//   3. the active backend is pinned to the 44.1 kHz DSD base — the daemon's own
//      `any_dsd` switch at 0, spelled `alsa_anydsd` for backend `alsa` and
//      `net_anydsd` for backend `network` (hqplayerd-readme.txt).
//
// Otherwise the preset is offered exactly as before. A filter whose ratio class
// the enumeration does not state is NOT rate-limited: narrowing hides on
// positive evidence only, which is the standing rule of store/narrow/match.js
// and is what the no-class case below pins.
//
// NO PRESET IS NAMED HERE (docs/testing.md rule 9). The grid's roster is a
// curated display list, so the subject of every case is DERIVED from the shipped
// table at run time — `sdmSubject` asks which presets exist and what each writes
// on the SDM chain, and the case then classes exactly those filter names in the
// seeded enumeration. Which preset that turns out to be is the table's business.
// No tile COUNT is asserted either: a case asks whether the grid offered ITS
// subject, never how many tiles the grid has.
//
// RULE 8 EXEMPTION, stated rather than assumed. Eight of the twelve cases are
// CHARACTERIZATION: they pin the conditions under which nothing is hidden — an
// unlimited filter the preset reaches only off its default knobs (on either
// lane), no ratio class stated at all, the 48 kHz family available (on either
// lane), a PCM lane, an Auto lane, and a backend that pins no base. Each of
// those is green before the gate exists as well as after, and cannot bite on
// its own. They are here because the gate's whole risk is over-hiding, and a
// hide rule with no fence around it is the defect this file exists to catch.
// The four cases that bite are the four hides: SDM out at the 44.1 kHz base on
// the config lane for each rate-limited class, on a network backend, and on the
// LIVE lane.
//
// TWO FENCES ARE SHARPER THAN THEY LOOK. The unlimited filter is one the preset
// reaches only by moving a knob off its default, so a reader that inspects the
// resting position alone sees nothing but rate-limited writes and hides the
// tile; and the hide is pinned on a network backend as well as an ALSA one,
// where the ALSA switch says the 48 kHz family IS available, so a reader that
// consults `alsa_anydsd` whatever the backend is fails it.
//
// The ratio class reaches the store the way it reaches it in production: off the
// running engine's `filters` enumeration, each item's `description` carrying the
// class in its tail after the SDM chain glyph (docs/protocol.md §4). The
// harness's `ratios` seam writes those descriptions; an empty map is an
// enumeration that states no class for anything.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-rategate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, resetLive, tabs, liveCard, presetIds } = await import("../support/easytiles.js");
const { sdmSubject, sdmSweepSubject, sdmNames, sdmOffDefaultNames, classedAs } =
  await import("../support/easytable.js");

/** The state that pins the base: an ALSA backend whose own switch says 44.1k only. */
const PINNED = { engine: { backend: "alsa", anydsd: "0" } };

/**
 * Whether the grid put a tile up for a preset.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {boolean}
 */
const offers = (out, presetId) => presetIds(out).includes(presetId);

/**
 * Every SDM filter a preset can reach classed rate-limited EXCEPT one it reaches
 * only away from its default knob positions, which is classed unlimited.
 *
 * This is the fence that forces the sweep. The unlimited filter is invisible to
 * a reader that looks at the tile's resting position alone — every write it can
 * see is 2x — so an implementation that never walks the preset's other knob
 * combinations hides the tile here, and the spec says it must not: condition one
 * is "every filter the preset can write, ACROSS EVERY COMBINATION".
 *
 * @param {string} presetId
 * @returns {Record<string, string>}
 */
const sweptUnlimited = (presetId) => ({
  ...classedAs(sdmNames(presetId), "2x"),
  [sdmOffDefaultNames(presetId)[0]]: "any",
});

// ============================================================================
// the hide: SDM out, 44.1 kHz base, nothing but rate-limited filters in reach
// ============================================================================

test("test_a_preset_reaching_only_2x_filters_is_not_offered_on_the_sdm_output_tab_at_the_441_base", async () => {
  const subject = sdmSubject();
  await resetTab({ mode: "sdm", ...PINNED, ratios: classedAs(sdmNames(subject), "2x") });
  assert.equal(offers(tabs(), subject), false);
});

test("test_a_preset_reaching_only_integer_filters_is_not_offered_on_the_sdm_output_tab_at_the_441_base", async () => {
  const subject = sdmSubject();
  await resetTab({ mode: "sdm", ...PINNED, ratios: classedAs(sdmNames(subject), "integer") });
  assert.equal(offers(tabs(), subject), false);
});

test("test_a_preset_reaching_only_2x_filters_is_not_offered_in_sdm_on_a_network_backend_at_the_441_base", async () => {
  const subject = sdmSubject();
  await resetTab({
    mode: "sdm",
    engine: { backend: "network", anydsd: "0" },
    ratios: classedAs(sdmNames(subject), "2x"),
  });
  assert.equal(offers(tabs(), subject), false);
});

test("test_a_preset_reaching_only_2x_filters_is_not_offered_on_the_live_page_in_sdm_at_the_441_base", async () => {
  const subject = sdmSubject();
  await resetLive({
    mode: "SDM",
    output: "sdm",
    chain: "sdm",
    ...PINNED,
    ratios: classedAs(sdmNames(subject), "2x"),
  });
  assert.equal(offers(liveCard(), subject), false);
});

// ============================================================================
// the fences: each condition on its own is not enough to hide anything
// ============================================================================

test("test_a_preset_reaching_one_unlimited_filter_off_its_default_knobs_is_still_offered_in_sdm", async () => {
  const subject = sdmSweepSubject();
  await resetTab({ mode: "sdm", ...PINNED, ratios: sweptUnlimited(subject) });
  assert.equal(offers(tabs(), subject), true);
});

test("test_a_preset_reaching_one_unlimited_filter_off_its_default_knobs_is_still_offered_on_the_live_page", async () => {
  const subject = sdmSweepSubject();
  await resetLive({ mode: "SDM", output: "sdm", chain: "sdm", ...PINNED, ratios: sweptUnlimited(subject) });
  assert.equal(offers(liveCard(), subject), true);
});

test("test_a_preset_reaching_only_2x_filters_is_still_offered_on_the_live_page_when_the_48k_family_is_available", async () => {
  const subject = sdmSubject();
  await resetLive({
    mode: "SDM",
    output: "sdm",
    chain: "sdm",
    engine: { backend: "alsa", anydsd: "1" },
    ratios: classedAs(sdmNames(subject), "2x"),
  });
  assert.equal(offers(liveCard(), subject), true);
});

test("test_a_preset_whose_filters_carry_no_ratio_class_is_still_offered_in_sdm_at_the_441_base", async () => {
  const subject = sdmSubject();
  await resetTab({ mode: "sdm", ...PINNED, ratios: {} });
  assert.equal(offers(tabs(), subject), true);
});

test("test_a_preset_reaching_only_2x_filters_is_still_offered_in_sdm_when_the_48k_family_is_available", async () => {
  const subject = sdmSubject();
  await resetTab({
    mode: "sdm",
    engine: { backend: "alsa", anydsd: "1" },
    ratios: classedAs(sdmNames(subject), "2x"),
  });
  assert.equal(offers(tabs(), subject), true);
});

test("test_a_preset_reaching_only_2x_filters_is_still_offered_in_pcm_at_the_441_base", async () => {
  const subject = sdmSubject();
  await resetTab({ mode: "pcm", ...PINNED, ratios: classedAs(sdmNames(subject), "2x") });
  assert.equal(offers(tabs(), subject), true);
});

test("test_a_preset_reaching_only_2x_filters_is_still_offered_in_auto_at_the_441_base", async () => {
  const subject = sdmSubject();
  await resetTab({ mode: "auto", ...PINNED, ratios: classedAs(sdmNames(subject), "2x") });
  assert.equal(offers(tabs(), subject), true);
});

test("test_a_preset_reaching_only_2x_filters_is_still_offered_in_sdm_on_a_backend_that_pins_no_base", async () => {
  const subject = sdmSubject();
  await resetTab({
    mode: "sdm",
    engine: { backend: "combo", anydsd: "0" },
    ratios: classedAs(sdmNames(subject), "2x"),
  });
  assert.equal(offers(tabs(), subject), true);
});
