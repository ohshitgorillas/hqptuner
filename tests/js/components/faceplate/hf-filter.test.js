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
import { engineState, enums } from "../../../../hqptuner/static/store/signals.js";
import { liveBusy, liveErrors } from "../../../../hqptuner/static/store/live/state.js";
import { HfFilter, HfFilterPopover } from "../../../../hqptuner/static/components/faceplate/HfFilter.js";
import { ok, quiesce } from "../../support/wire/wire.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** The `junk_filters` names, in the engine's order. */
const NAMES = ["none", "20k", "2x"];

/**
 * One `junk_filters` entry as the daemon sends it: every attribute a string, its value the index of another entry.
 *
 * @param {string} name
 * @param {number} i
 */
const item = (name, i) => ({ index: String(i), value: String((i + 2) % NAMES.length), name });

/**
 * Write one running engine onto the wire-side signals.
 *
 * @param {string} junk  the running junk filter's index
 */
function running(junk) {
  engineState.value = { state: "2", active_chain: "pcm", filter_junk: junk, filter1x: "0", filterNx: "0", shaper: "0" };
  enums.value = { junk_filters: NAMES.map(item), filters: [], shapers: [] };
}

/** @type {{ fetch?: unknown }} */
const env = globalThis;

/** @type {{ path: string, body: unknown }[]} */
let posts = [];

/**
 * The answer to one request, each body recorded first.
 *
 * @param {string} path
 * @param {{ body?: string }} [opts]
 */
async function answer(path, opts = {}) {
  if (opts.body) posts.push({ path, body: JSON.parse(opts.body) });
  if (path === "/api/config/live") return ok({ report: { live: [], stored: {} } });
  if (path === "/api/state") return ok({ data: { ...engineState.value } });
  if (path === "/api/enumerations") return ok({ data: { ...enums.value } });
  if (path === "/api/config/pending") return ok({ live: {}, http: {} });
  return ok({});
}

/** The wire's requests handed over and not yet answered. */
const wire = { inflight: new Set() };

/**
 * One request answered as `answer` answers it, kept in `wire.inflight` until it is.
 *
 * @param {string} path
 * @param {{ body?: string }} [opts]
 */
function tracked(path, opts) {
  const req = answer(path, opts);
  wire.inflight.add(req);
  req.then(
    () => wire.inflight.delete(req),
    () => wire.inflight.delete(req),
  );
  return req;
}

/** The bodies posted to one path. @param {string} path */
const sent = (path) => posts.filter((p) => p.path === path).map((p) => p.body);

beforeEach(() => {
  env.fetch = tracked;
  running("1");
  liveErrors.value = {};
  liveBusy.value = "";
  posts = [];
});

/**
 * The elements inside `e`, `e` itself left out; none when `e` is missing.
 *
 * @param {MarkupElement | undefined} e
 */
const inside = (e) => (e ? elements(e.html).slice(0, -1) : []);

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

test("test_the_readout_value_is_the_running_filters_name", () => {
  const at = (/** @type {string} */ junk) => {
    running(junk);
    return readoutValue();
  };
  assert.deepEqual([at("1"), at("2")], ["20k", "2x"]);
});

test("test_the_popover_draws_one_row_per_option_in_engine_order", () => {
  assert.deepEqual(
    rows().map((r) => text(r).trim()),
    NAMES,
  );
});

test("test_only_the_running_options_row_is_checked", () => {
  const checked = (/** @type {string} */ junk) => {
    running(junk);
    return rows()
      .filter((r) => attr(r, "aria-checked") === "true")
      .map((r) => text(r).trim());
  };
  assert.deepEqual([checked("1"), checked("2")], [["20k"], ["2x"]]);
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
