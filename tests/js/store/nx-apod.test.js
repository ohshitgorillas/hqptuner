// Behavioural suite for Nx-chain apodizing narrowing — store/narrowing.js plus
// the Field-level narrow controls.
//
// Unlike the 1x chains, where apodizing narrowing defaults ON, the Nx chains
// default OFF: a freshly reset Nx dropdown shows everything, and narrowing only
// starts when the user opts in per chain (setApod on an *_nx field key).
//
// Fixture rules follow tests/js/narrowing.test.js: the enum descriptions are
// WIRE-FAITHFUL (engine glyphs ⥮/⥣, abbreviated ratio spellings), facets are
// keyed by option LABEL, and the untouched path returns the SAME array object.
// The spec block writes the stage token as "nx"; the shipped call sites and the
// existing suite pass "Nx", so that spelling is used here.

import test from "node:test";
import assert from "node:assert/strict";

import { enums, metadata } from "../../../hqptuner/static/store/signals.js";
import {
  narrowOptions,
  narrowCount,
  narrowingActive,
  resetNarrowing,
  setApod,
  setApodHalf,
  setHideHires,
} from "../../../hqptuner/static/store/narrowing.js";
import { reset, field } from "../support/field-harness.js";

// The live enumeration: `apodizing: true` arrives pre-computed from the backend
// (arg bit 0); ½-apodizing is arg bit 1, read off the raw arg client-side.
const ENUM = {
  filters: [
    { name: "poly-sinc-gauss-long", apodizing: true, description: "5/5 transients, timbre ⥮ Any" },
    { name: "sinc-M", description: "4/5 space ⥮ Int" },
    { name: "poly-sinc-short-mp", arg: 2, description: "2/5 ⥮ 2^x" },
  ],
};

const OPTIONS = [
  { value: "0", label: "poly-sinc-gauss-long" },
  { value: "1", label: "sinc-M" },
  { value: "2", label: "poly-sinc-short-mp" },
];

// Clean slate for the store-level cases: wire state assigned fresh every test
// (module-level signals persist, and the Field harness nulls them).
function clean() {
  enums.value = ENUM;
  metadata.value = null;
  resetNarrowing();
}

const kept = (current = null, fieldKey = "pcm_filter_nx") =>
  narrowOptions(OPTIONS, current, "Nx", fieldKey).map((o) => o.label);

// --- default: Nx apodizing narrowing is OFF ---------------------------------

test("test_nx_apodizing_defaults_off_and_leaves_the_option_list_untouched", () => {
  clean();
  assert.equal(narrowOptions(OPTIONS, null, "Nx", "pcm_filter_nx"), OPTIONS);
});

// --- opting in narrows the Nx dropdown --------------------------------------

test("test_nx_apodizing_keeps_a_full_apodizing_filter", () => {
  clean();
  setApod("pcm_filter_nx", true);
  assert.ok(kept().includes("poly-sinc-gauss-long"));
});

test("test_nx_apodizing_drops_a_non_apodizing_filter", () => {
  clean();
  setApod("pcm_filter_nx", true);
  assert.equal(kept().includes("sinc-M"), false);
});

test("test_half_apodizing_filters_stay_hidden_under_nx_apodizing", () => {
  clean();
  setApod("pcm_filter_nx", true);
  assert.equal(kept().includes("poly-sinc-short-mp"), false);
});

test("test_the_nx_half_toggle_reveals_half_apodizing_filters", () => {
  clean();
  setApod("pcm_filter_nx", true);
  setApodHalf("pcm_filter_nx", true);
  assert.ok(kept().includes("poly-sinc-short-mp"));
});

// --- independence: per chain, and Nx vs 1x ----------------------------------

test("test_nx_apodizing_is_per_chain", () => {
  clean();
  setApod("pcm_filter_nx", true);
  assert.equal(narrowOptions(OPTIONS, null, "Nx", "sdm_filter_nx"), OPTIONS);
});

test("test_nx_apodizing_leaves_the_1x_dropdown_untouched", () => {
  clean();
  setApod("pcm_filter_1x", false);
  setHideHires("pcm_filter_1x", false);
  setApod("pcm_filter_nx", true);
  assert.equal(narrowOptions(OPTIONS, null, "1x", "pcm_filter_1x"), OPTIONS);
});

// --- the current selection is never hidden ----------------------------------

test("test_the_current_selection_survives_nx_apodizing", () => {
  clean();
  setApod("pcm_filter_nx", true);
  assert.ok(kept("1").includes("sinc-M"));
});

// --- narrowingActive ---------------------------------------------------------

test("test_enabling_nx_apodizing_reads_as_active", () => {
  clean();
  setApod("pcm_filter_nx", true);
  assert.equal(narrowingActive.value, true);
});

test("test_reset_returns_nx_apodizing_to_inactive", () => {
  clean();
  setApod("pcm_filter_nx", true);
  setApodHalf("pcm_filter_nx", true);
  resetNarrowing();
  assert.equal(narrowingActive.value, false);
});

// --- the n/total badge -------------------------------------------------------

test("test_the_nx_badge_count_reflects_apodizing_narrowing", () => {
  clean();
  setApod("pcm_filter_nx", true);
  const two = [
    { value: "0", label: "poly-sinc-gauss-long" },
    { value: "1", label: "sinc-M" },
  ];
  assert.deepEqual(narrowCount(two, "Nx", "pcm_filter_nx"), { n: 1, total: 2 });
});

// --- Field-level narrow controls ---------------------------------------------
// The Nx filter fields carry the same two apodizing checkboxes as 1x; only the
// 1x field carries the novice caption (dsp.apodizing tooltip from metadata).

const CAPTION = "Novice apodizing caption prose.";

const FIELDS = [
  {
    name: "filter1x",
    value: "0",
    options: [{ value: "0", label: "poly-sinc-gauss-long" }],
  },
  {
    name: "filter",
    value: "0",
    options: [{ value: "0", label: "poly-sinc-gauss-long" }],
  },
];

const META = {
  settings: {
    dsp: {
      filter_1x: { label: "1x filter", tooltip: "Filter prose." },
      filter_nx: { label: "Nx filter", tooltip: "Oversampling prose." },
      apodizing: { label: "Apodizing", tooltip: CAPTION },
    },
  },
};

const renderField = async (k) => {
  await reset({ fields: FIELDS, meta: META });
  return field(k);
};

test("test_the_nx_field_offers_the_apodizing_only_checkbox", async () => {
  assert.ok((await renderField("pcm_filter_nx")).includes("Show apodizing only"));
});

test("test_the_nx_field_offers_the_half_apodizing_checkbox", async () => {
  assert.ok((await renderField("pcm_filter_nx")).includes("Show ½ apodizing filters"));
});

test("test_the_1x_field_still_offers_the_apodizing_only_checkbox", async () => {
  assert.ok((await renderField("pcm_filter_1x")).includes("Show apodizing only"));
});

test("test_the_1x_field_still_offers_the_half_apodizing_checkbox", async () => {
  assert.ok((await renderField("pcm_filter_1x")).includes("Show ½ apodizing filters"));
});

test("test_the_novice_apodizing_caption_renders_under_the_1x_field", async () => {
  assert.ok((await renderField("pcm_filter_1x")).includes(CAPTION));
});

test("test_the_nx_field_omits_the_novice_apodizing_caption", async () => {
  assert.equal((await renderField("pcm_filter_nx")).includes(CAPTION), false);
});
