// A daemon option labelled like an Object.prototype member ("constructor", "toString", "__proto__") is an unknown
// label, not a crash: Simplified mode shows it raw and sorted last, and engaged narrowing leaves it in the list. The
// engine is the enumeration authority for labels, so any string can arrive here.
//
// Each case captures its outcome as a value ({ value } or { error }) so a throw surfaces as a failed assertion.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrow/inherited-labels.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, META } from "../../support/field-harness.js";
import { plainNames } from "../../../../hqptuner/static/store/ui/prefs.js";
import { enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { nGenre, resetNarrowing } from "../../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions } from "../../../../hqptuner/static/store/narrow/match.js";

const MOD = new URL("../../../../hqptuner/static/store/plainnames.js", import.meta.url).href;
const plainnames = await import(`${MOD}`);

const META_PLAIN = {
  ...META,
  plain_names: {
    filters: {
      entries: { "sinc-M": { family: "Sinc", variant: null, leaf: "Classic M", short: "Sinc M" } },
      families: {},
      variants: {},
    },
  },
};

/**
 * @template T
 * @param {() => T} run
 * @returns {{ value: T } | { error: unknown }}
 */
function attempt(run) {
  try {
    return { value: run() };
  } catch (error) {
    return { error };
  }
}

const labelOf = (/** @type {{ label: string }} */ o) => o.label;
const isConstructor = (/** @type {{ label: string }} */ o) => o.label === "constructor";

const RAW = { label: "constructor", value: "0" };

async function simplifiedOn() {
  await reset({ meta: META_PLAIN });
  plainNames.value = true;
}

test("test_decorate_options_over_an_inherited_label_returns_without_throwing", async () => {
  await simplifiedOn();
  assert.doesNotThrow(() => plainnames.decorateOptions([RAW, { label: "sinc-M", value: "1" }], "filters"));
});

test("test_decorate_options_leaves_an_inherited_label_raw_and_sorted_after_the_known_one", async () => {
  await simplifiedOn();
  const outcome = attempt(() => plainnames.decorateOptions([RAW, { label: "sinc-M", value: "1" }], "filters"));
  assert.deepEqual("value" in outcome ? outcome.value.map(labelOf) : outcome.error, ["sinc-M", "constructor"]);
});

test("test_decorate_options_gives_an_inherited_label_no_display", async () => {
  await simplifiedOn();
  const outcome = attempt(() => plainnames.decorateOptions([RAW, { label: "sinc-M", value: "1" }], "filters"));
  assert.deepEqual("value" in outcome ? outcome.value.find(isConstructor) : outcome.error, RAW);
});

test("test_plain_closed_label_returns_an_inherited_label_unchanged", async () => {
  await simplifiedOn();
  assert.deepEqual(
    attempt(() => plainnames.plainClosedLabel("filters", "constructor")),
    { value: "constructor" },
  );
});

test("test_narrowing_keeps_an_option_whose_label_is_inherited", () => {
  enums.value = { filters: [{ index: "0", name: "gauss-a", value: "0", arg: 0, description: "5/5 ⥮ Any" }] };
  metadata.value = {
    settings: {},
    filters: { filters: { "gauss-a": { genre: ["jazz"] } }, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  nGenre.value = ["jazz"];
  const options = [{ label: "gauss-a", value: "0" }, RAW];
  const outcome = attempt(() => narrowOptions(options, "nx", "pcm_filter_nx").map((o) => o.label));
  assert.deepEqual(outcome, { value: ["gauss-a", "constructor"] });
});
