// Rendered suite for hqptuner/static/components/faceplate/HfFilter.js: the engine row's HF filter readout and its option
// popover. What the readout names and which option runs are store/faceplate/hf.js's, pinned in
// tests/js/store/faceplate/hf.test.js; this suite pins how the two draw them: the readout's value is the running filter's
// name, the popover draws one row per option with the running one checked, and picking a row sends that row's index
// live.
//
// Driven at the wire: /api/state into `engineState`, /api/enumerations into `enums`, and a fetch fake that answers the
// real REST paths and records every request body. A pick is fired through the renderer's vnode seam, since
// render-to-string fires no events. A popover row is an element carrying `aria-checked`, and its text is the option's
// name; every name asserted is the fixture's own. Each entry's value differs from its index, so a row that sends the
// value rather than the index sends the wrong filter.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/hf-filter.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { engineStatus, health } from "../../../../hqptuner/static/store/signals.js";
import { openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { HfFilter, HfFilterPopover } from "../../../../hqptuner/static/components/faceplate/HfFilter.js";
import { quiesce } from "../../support/wire/wire.js";
import { NAMES, running, forgetPosts, sent, tracked, wire } from "../../support/rendered/switcherwire.js";
import { inside } from "../../support/rendered/treewalk.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** The popover's id. */
const ID = "hf";

/** @type {{ fetch?: unknown }} */
const env = globalThis;

beforeEach(() => {
  env.fetch = tracked();
  running("1");
  engineStatus.value = null;
  health.value = null;
  openPopover.value = null;
  forgetPosts();
});

/** The text of the value span inside the readout's button, or undefined where none is drawn. */
const readoutValue = () => {
  const spans = elements(render(html`<${HfFilter} />`))
    .filter((e) => e.name === "button")
    .flatMap(inside)
    .filter((e) => e.name === "span" && classes(e).includes("v"));
  return spans[0] ? text(spans[0]).trim() : undefined;
};

/** The popover's rows: every element carrying `aria-checked`. */
const rows = () => elements(render(html`<${HfFilterPopover} />`)).filter((e) => hasAttr(e, "aria-checked"));

/** The readout's value while the junk filter at index `junk` runs. @param {string} junk */
const at = (junk) => {
  running(junk);
  return readoutValue();
};

test("test_the_readout_value_is_the_running_filters_name_at_index_1", () => {
  assert.equal(at("1"), "20k");
});

test("test_the_readout_value_is_the_running_filters_name_at_index_2", () => {
  assert.equal(at("2"), "2x");
});

test("test_the_popover_draws_one_row_per_option_in_engine_order", () => {
  assert.deepEqual(
    rows().map((r) => text(r).trim()),
    NAMES,
  );
});

/** The names on the popover's checked rows while the junk filter at index `junk` runs. @param {string} junk */
const checked = (junk) => {
  running(junk);
  return rows()
    .filter((r) => attr(r, "aria-checked") === "true")
    .map((r) => text(r).trim());
};

test("test_only_the_running_options_row_is_checked_at_index_1", () => {
  assert.deepEqual(checked("1"), ["20k"]);
});

test("test_only_the_running_options_row_is_checked_at_index_2", () => {
  assert.deepEqual(checked("2"), ["2x"]);
});

test("test_picking_a_row_sends_that_rows_index_live_as_the_junk_filter", async () => {
  const row = renderTree(html`<${HfFilterPopover} />`).seen.find(
    (v) => "aria-checked" in propsOf(v) && textOf(v).trim() === "2x",
  );
  const pick = row ? propsOf(row).onClick : undefined;
  if (typeof pick === "function") await pick({ preventDefault: () => {} });
  await quiesce(wire);
  assert.deepEqual(sent("/api/config/live"), [{ fields: { junk_filter: "2" } }]);
});

/** A 44.1 kHz source playing: every option but none does nothing on it. */
function play44() {
  health.value = { phase: "Ready" };
  engineStatus.value = { status: { state: "2" }, metadata: { samplerate: "44100", sdm: "0" } };
}

/** The rendered popover row showing `name`, as the vnode seam sees it. @param {string} name */
const seamRow = (name) =>
  renderTree(html`<${HfFilterPopover} />`).seen.find((v) => "aria-checked" in propsOf(v) && textOf(v).trim() === name);

/** Fire a row's tap as the renderer's seam hands it over. @param {string} name */
async function tap(name) {
  const row = seamRow(name);
  const onClick = row ? propsOf(row).onClick : undefined;
  if (typeof onClick === "function") await onClick({ preventDefault: () => {} });
  await quiesce(wire);
}

test("test_with_a_44_1_source_playing_every_row_but_none_is_disabled", () => {
  play44();
  assert.deepEqual(
    rows()
      .filter((r) => hasAttr(r, "disabled"))
      .map((r) => text(r).trim()),
    ["20k", "2x"],
  );
});

test("test_a_disabled_row_that_runs_is_still_ticked", () => {
  play44();
  assert.deepEqual(
    rows()
      .filter((r) => hasAttr(r, "disabled") && attr(r, "aria-checked") === "true")
      .map((r) => text(r).trim()),
    ["20k"],
  );
});

test("test_a_grayed_row_carries_no_title", () => {
  play44();
  assert.deepEqual(
    rows().filter((r) => hasAttr(r, "title")),
    [],
  );
});

test("test_tapping_a_grayed_row_writes_nothing", async () => {
  play44();
  await tap("2x");
  assert.deepEqual(sent("/api/config/live"), []);
});

test("test_tapping_a_grayed_row_leaves_the_menu_open", async () => {
  play44();
  openPopover.value = ID;
  await tap("2x");
  assert.equal(openPopover.value, ID);
});
