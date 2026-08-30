// Behavioral suite for the Simplified option style dropping every mention of
// the two-stage variant.
//
// The "Option style" pref (`plainNames` in store/prefs.js) has two settings:
// Standard shows the raw engine name, Simplified shows the plain-names
// overlay's curated breakdown — a `leaf` on the dropdown row and a `short` on
// the closed control. A filter's inline description is composed separately,
// out of the filters overlay, and a two-stage filter's description can pick up
// two extra sentences: the shared note keyed by the `-2s` suffix on the
// filter's own name (`two_stage_note`) and the SDM-chain note keyed by the
// entry's `sdm_two_stage` flag (`sdm_two_stage_note`).
//
// Under Simplified none of those four appear: the trailing two-stage clause is
// stripped off the leaf and off the short, and neither shared note joins the
// description. Under Standard nothing changes at all, which the four regression
// guards below hold.
//
// Every string asserted here is invented by this file's own fixture and seeded
// into the /api/metadata signal through the field harness's reset(), the way
// the neighboring prose suites drive their overlays. No shipped wording from
// hqptuner/data/*.json is read or asserted (docs/testing.md rule 9); what is
// pinned is whether a fixture-defined sentence or clause survives the
// composition.
//
// `plainNames` is a module-level signal the harness reset() does not touch, so
// every case sets it explicitly — otherwise the cases pass alone and fail in
// sequence.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/simplified-two-stage.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { decorateOptions, plainClosedLabel } from "../../../hqptuner/static/store/plainnames.js";
import { optionDescription, selectionDescription } from "../../../hqptuner/static/store/prose.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { reset, META } from "../support/field-harness.js";

// --- fixture ----------------------------------------------------------------

const TWO_STAGE_NOTE = "Oversamples in two passes.";
const SDM_TWO_STAGE_NOTE = "Oversamples in two passes on the SDM chain.";

const OWN_DESCRIPTION = "A fixture filter.";
const OWN_NOTES = "A fixture caveat.";

// The filters overlay: one plain entry reachable through its own `-2s` variant
// name (which is how the shared two-stage note lands on a description) and one
// entry flagged for the SDM chain (which is how the SDM note lands on one).
const FILTERS = {
  filters: {
    "fix-a": { description: OWN_DESCRIPTION, notes: OWN_NOTES },
    "fix-b": { description: OWN_DESCRIPTION, sdm_two_stage: true },
  },
  aliases: {},
  two_stage_note: TWO_STAGE_NOTE,
  sdm_two_stage_note: SDM_TWO_STAGE_NOTE,
};

// The plain-names overlay. `fix-a-2s` carries a leaf and a short whose trailing
// clause is the one Simplified drops; `fix-c-2s` carries the same clause in the
// MIDDLE of its leaf, so only a strip anchored at the end leaves it alone.
//
// The base `fix-a` entry deliberately carries a DIFFERENT leaf and short from
// the stripped forms of the variant's own, so a stripped row cannot be
// confused with a row that fell back to the base entry.
const PLAIN_ENTRIES = {
  "fix-a": { family: "Fixture", variant: null, leaf: "Base leaf", short: "Base short" },
  "fix-a-2s": { family: "Fixture", variant: null, leaf: "Long, two-stage", short: "Fix L, 2-stage" },
  "fix-c-2s": { family: "Fixture", variant: null, leaf: "Long, two-stage, apodizing", short: "Fix C" },
};

const FIXTURE_META = {
  ...META,
  filters: FILTERS,
  plain_names: {
    filters: { entries: PLAIN_ENTRIES, families: {}, variants: {} },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: { entries: {}, families: {}, variants: {} },
  },
};

// settings.json prose for the control being described; the two-stage sentences
// come from the filters overlay, never from here.
const FILTER_META = META.settings.dsp.filter_1x;

const OPTIONS = [
  { value: "0", label: "fix-a" },
  { value: "1", label: "fix-a-2s" },
  { value: "2", label: "fix-c-2s" },
];

/** @param {string} label */
const one = (label) => [{ value: "0", label }];

/**
 * Seed the overlays and the option-style pref.
 *
 * @param {boolean} plain
 * @returns {Promise<void>}
 */
async function seed(plain) {
  await reset({ meta: FIXTURE_META });
  plainNames.value = plain;
}

/**
 * The dropdown-row text of one decorated option, found by the raw engine label
 * it was built from. Throws when the decoration dropped the option, so a
 * missing row fails loudly rather than comparing against nothing.
 *
 * An option the overlay does not know comes back undecorated, so the decorated
 * shape is narrowed rather than assumed: a row with no `display` at all is an
 * undecorated row, and that is a failure of the case, not a value to compare.
 *
 * @param {string} label
 * @returns {Promise<string>}
 */
async function rowText(label) {
  await seed(true);
  const hit = decorateOptions(OPTIONS, "filters").find((o) => o.label === label);
  if (!hit) throw new Error(`no decorated option carries the raw label "${label}"`);
  if (!("display" in hit)) throw new Error(`the decorated option for "${label}" carries no display text`);
  return hit.display;
}

// --- N1/N2/N3: the row and the closed control -------------------------------

test("test_a_simplified_two_stage_row_drops_the_trailing_two_stage_clause_from_the_leaf", async () => {
  assert.equal(await rowText("fix-a-2s"), "Long");
});

test("test_a_simplified_two_stage_closed_control_drops_the_trailing_two_stage_clause_from_the_short", async () => {
  await seed(true);
  assert.equal(plainClosedLabel("filters", "fix-a-2s"), "Fix L");
});

test("test_a_simplified_row_whose_leaf_does_not_end_in_a_two_stage_clause_is_left_alone", async () => {
  assert.equal(await rowText("fix-c-2s"), "Long, two-stage, apodizing");
});

// --- N4/N5: the two shared notes leave the description ----------------------

test("test_a_simplified_two_stage_filter_selection_omits_the_shared_two_stage_note", async () => {
  await seed(true);
  assert.ok(
    !selectionDescription(schema.pcm_filter_1x, "0", one("fix-a-2s"), FILTER_META).includes(TWO_STAGE_NOTE),
    "the shared two-stage note is still in the Simplified description",
  );
});

test("test_a_simplified_flagged_filter_on_the_sdm_chain_omits_the_sdm_two_stage_note", async () => {
  await seed(true);
  assert.ok(
    !selectionDescription(schema.sdm_filter_1x, "0", one("fix-b"), FILTER_META).includes(SDM_TWO_STAGE_NOTE),
    "the SDM two-stage note is still in the Simplified description",
  );
});

// The option-row twin of each: Simplified mentions the variant NOWHERE, so the
// dropdown's own descriptions drop the same two sentences the closed
// selection's does.

test("test_a_simplified_two_stage_filter_option_omits_the_shared_two_stage_note", async () => {
  await seed(true);
  assert.ok(
    !optionDescription(schema.pcm_filter_1x, { value: "0", label: "fix-a-2s" }, FILTER_META).includes(TWO_STAGE_NOTE),
    "the shared two-stage note is still in the Simplified option description",
  );
});

test("test_a_simplified_flagged_filter_option_on_the_sdm_chain_omits_the_sdm_two_stage_note", async () => {
  await seed(true);
  assert.ok(
    !optionDescription(schema.sdm_filter_1x, { value: "0", label: "fix-b" }, FILTER_META).includes(SDM_TWO_STAGE_NOTE),
    "the SDM two-stage note is still in the Simplified option description",
  );
});

// --- N6: only the two-stage sentences go ------------------------------------

test("test_a_simplified_two_stage_filter_selection_keeps_its_own_description_and_notes", async () => {
  await seed(true);
  assert.equal(
    selectionDescription(schema.pcm_filter_1x, "0", one("fix-a-2s"), FILTER_META),
    `${OWN_DESCRIPTION} ${OWN_NOTES}`,
  );
});

// --- N7/N8: Standard is untouched -------------------------------------------

test("test_a_standard_two_stage_filter_selection_still_carries_the_shared_two_stage_note", async () => {
  await seed(false);
  assert.ok(
    selectionDescription(schema.pcm_filter_1x, "0", one("fix-a-2s"), FILTER_META).includes(TWO_STAGE_NOTE),
    "the shared two-stage note is missing from the Standard description",
  );
});

test("test_a_standard_flagged_filter_on_the_sdm_chain_still_carries_the_sdm_two_stage_note", async () => {
  await seed(false);
  assert.ok(
    selectionDescription(schema.sdm_filter_1x, "0", one("fix-b"), FILTER_META).includes(SDM_TWO_STAGE_NOTE),
    "the SDM two-stage note is missing from the Standard description",
  );
});
