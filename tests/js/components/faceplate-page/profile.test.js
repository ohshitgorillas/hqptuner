// Rendered suite for hqptuner/static/components/faceplate/page/MatrixProfile.js, the page's Matrix profile section:
// its body (the profile select and the Profile builder button, the description well, the response plot of the running
// profile) and the header-line form the folded section carries (the select and the button alone).
//
// Driven at the wire: the /matrix form is assigned into `matrixConfig` as the poll writes it, its rows the running
// profile's pipelines, and a fetch fake answers the real REST paths in their real shapes and records every request
// (POST /api/matrix/profile for a switch, PUT /api/descriptions for a description). No store function is stubbed. Picks,
// taps, typing and blur are fired through the renderer's vnode seam, since render-to-string fires no events. Profile
// names are the fixture's own wire data; everything located by a word carries a `data-testid` instead.
//
// Not reachable here: the plot measuring its box, which runs in a layout effect server rendering never runs, so the
// plot draws at its fallback size. A browser run closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/profile.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { MatrixProfileBody, ProfileLine } from "../../../../hqptuner/static/components/faceplate/page/MatrixProfile.js";
import { config, matrixConfig, enums } from "../../../../hqptuner/static/store/signals.js";
import { descriptions } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { leaveDescription } from "../../../../hqptuner/static/store/faceplate/page/profile.js";
import { body } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, text, hasAttr, classes } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { ok, bad } from "../../support/wire/wire.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/wire/wire.js").FakeResponse} FakeResponse */
/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} Row */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

/** The answer to a switch, or undefined for the route's success shape. @type {FakeResponse | undefined} */
let switchAnswer;

/**
 * One pipeline row as the /matrix form carries it.
 *
 * @param {string} source
 * @param {string} process
 * @returns {Row}
 */
const row = (source, process) => ({ gain: "0", gainunit: "dB", mixdown: "0", process, source });

/**
 * A /matrix form as GET /api/matrix carries it: the daemon's startup list, the profile running live and its rows.
 *
 * @param {string[]} live
 * @param {string} active
 * @param {Row[]} [rows]
 */
const form = (live, active, rows = []) => ({ fields: [], rows, live_profiles: live, live_active: active });

/**
 * The answer to one request.
 *
 * @param {string} path
 * @param {string} method
 * @param {Record<string, unknown> | null} sent
 * @returns {FakeResponse}
 */
function answer(path, method, sent) {
  if (path === "/api/matrix/profile") return switchAnswer || ok({ ok: true });
  if (path === "/api/matrix") return ok({ data: matrixConfig.value });
  if (path === "/api/config") return ok({ data: config.value });
  if (path === "/api/enumerations") return ok({ data: enums.value });
  if (path === "/api/config/pending") return ok({ live: {}, http: {} });
  if (path === "/api/descriptions" && method === "PUT" && sent) {
    return ok({ profiles: { [String(sent.name)]: { text: String(sent.text), updated: "2026-10-04T00:00:00+00:00" } } });
  }
  return ok({});
}

beforeEach(() => {
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    const sent = opts.body ? JSON.parse(opts.body) : null;
    CALLS.push({ path, method: opts.method || "GET", body: sent });
    return answer(path, opts.method || "GET", sent);
  };
  config.value = { fields: [], file: {}, active: "" };
  matrixConfig.value = { ...form(["Lounge"], "Lounge"), file_profiles: { Desk: { rows: [] } } };
  descriptions.value = {};
  switchAnswer = undefined;
  body.value = "chain";
  CALLS.length = 0;
});

// An edit a case leaves is written against the fake, as the well's blur writes it, before the real fetch returns: no
// drain timer outlives the case and no typed copy carries into the next.
afterEach(async () => {
  await leaveDescription();
  env.fetch = REAL_FETCH;
});

/** Every element of a rendered tree. */
const all = (/** @type {unknown} */ tree) => elements(render(/** @type {VNode} */ (tree)));

/** Every element of the section body carrying a test id. */
const marked = (/** @type {string} */ testid) =>
  all(html`<${MatrixProfileBody} />`).filter((e) => attr(e, "data-testid") === testid);

/** The select's options, as [value, label]. */
const optionsOf = (/** @type {unknown} */ tree) => {
  const els = all(tree);
  const sel = els.find((e) => attr(e, "data-testid") === "profile-select");
  return els.filter((e) => e.name === "option" && sel !== undefined && sel.html.includes(e.html));
};

/** An option's value: server rendering prints an empty one as a bare `value`, which HTML reads as "". */
const valueOf = (/** @type {import("../../support/markup.js").MarkupElement} */ o) =>
  attr(o, "value") ?? (hasAttr(o, "value") ? "" : undefined);

/** The response traces the body's plot draws. */
const traces = () =>
  all(html`<${MatrixProfileBody} />`).filter((e) => e.name === "path" && classes(e).includes("trace"));

/** The dB labels the body's plot prints in its gutter. */
const levels = () =>
  all(html`<${MatrixProfileBody} />`)
    .filter((e) => e.name === "text" && attr(e, "text-anchor") === "end")
    .map(text);

/**
 * The handler a vnode carrying a test id holds under a prop, or undefined when the tree draws none.
 *
 * @param {unknown} tree
 * @param {string} testid
 * @param {string} prop
 * @returns {((e?: unknown) => unknown) | undefined}
 */
function handler(tree, testid, prop) {
  const { seen } = renderTree(/** @type {VNode} */ (tree));
  const hit = seen.find((v) => v.props["data-testid"] === testid);
  const fn = hit?.props[prop];
  return typeof fn === "function" ? /** @type {(e?: unknown) => unknown} */ (fn) : undefined;
}

/** The requests the wire saw for a method and a path. */
const sent = (/** @type {string} */ method, /** @type {string} */ path) =>
  CALLS.filter((c) => c.method === method && c.path === path);

test("test_the_select_offers_the_unnamed_profile_then_every_saved_name", () => {
  assert.deepEqual(
    optionsOf(html`<${MatrixProfileBody} />`).map((o) => [valueOf(o), text(o)]),
    [
      ["", "[Default]"],
      ["Desk", "Desk"],
      ["Lounge", "Lounge"],
    ],
  );
});

test("test_the_running_profile_is_the_selected_option", () => {
  assert.deepEqual(
    optionsOf(html`<${MatrixProfileBody} />`)
      .filter((o) => hasAttr(o, "selected"))
      .map((o) => attr(o, "value")),
    ["Lounge"],
  );
});

test("test_a_saved_name_the_engine_did_not_load_is_a_disabled_option", () => {
  assert.deepEqual(
    optionsOf(html`<${MatrixProfileBody} />`)
      .filter((o) => hasAttr(o, "disabled"))
      .map((o) => attr(o, "value")),
    ["Desk"],
  );
});

test("test_picking_an_option_switches_the_running_profile_on_the_wire", async () => {
  const onChange = handler(html`<${MatrixProfileBody} />`, "profile-select", "onChange");
  if (onChange) await onChange({ currentTarget: { value: "Lounge" } });
  assert.deepEqual(
    sent("POST", "/api/matrix/profile").map((c) => c.body),
    [{ action: "switch", name: "Lounge" }],
  );
});

test("test_a_refused_switch_prints_the_servers_sentence", async () => {
  switchAnswer = bad(502, "MatrixSetProfile failed");
  const onChange = handler(html`<${MatrixProfileBody} />`, "profile-select", "onChange");
  if (onChange) await onChange({ currentTarget: { value: "Lounge" } });
  assert.deepEqual(marked("profile-error").map(text), ["MatrixSetProfile failed"]);
});

test("test_the_profile_builder_shows_the_profile_body", async () => {
  const onClick = handler(html`<${MatrixProfileBody} />`, "profile-builder", "onClick");
  if (onClick) await onClick();
  assert.equal(body.value, "profile");
});

test("test_the_profile_builder_is_pressed_while_the_profile_body_shows", () => {
  body.value = "profile";
  assert.deepEqual(
    marked("profile-builder").map((e) => attr(e, "aria-pressed")),
    ["true"],
  );
});

test("test_the_profile_builder_is_not_pressed_while_the_chain_shows", () => {
  assert.deepEqual(
    marked("profile-builder").map((e) => attr(e, "aria-pressed")),
    ["false"],
  );
});

test("test_the_header_line_carries_the_select_and_the_builder_alone", () => {
  assert.deepEqual(
    all(html`<${ProfileLine} />`)
      .map((e) => attr(e, "data-testid"))
      .filter(Boolean),
    ["profile-select", "profile-builder"],
  );
});

test("test_the_header_line_offers_the_same_choices_as_the_body", () => {
  assert.deepEqual(optionsOf(html`<${ProfileLine} />`).map(valueOf), ["", "Desk", "Lounge"]);
});

test("test_the_well_holds_the_running_profiles_description", () => {
  descriptions.value = { Lounge: { text: "Mains at the sofa.", updated: "2026-10-01T00:00:00+00:00" } };
  assert.deepEqual(marked("profile-description").map(text), ["Mains at the sofa."]);
});

test("test_typing_in_the_well_then_leaving_it_writes_the_description", async () => {
  const tree = html`<${MatrixProfileBody} />`;
  const onInput = handler(tree, "profile-description", "onInput");
  if (onInput) onInput({ currentTarget: { value: "Mains, late night." } });
  const onBlur = handler(tree, "profile-description", "onBlur");
  if (onBlur) await onBlur();
  assert.deepEqual(
    sent("PUT", "/api/descriptions").map((c) => c.body),
    [{ name: "Lounge", text: "Mains, late night." }],
  );
});

test("test_rows_that_carry_no_processing_draw_the_plot_with_no_trace", () => {
  matrixConfig.value = form(["Lounge"], "Lounge", [row("0", ""), row("1", "")]);
  const plots = all(html`<${MatrixProfileBody} />`).filter((e) => attr(e, "aria-label") === "Matrix response");
  assert.deepEqual([plots.length, traces().length], [1, 0]);
});

test("test_rows_sharing_one_chain_draw_one_trace", () => {
  const eq = "iir:type=peak;f=1000;q=1;g=-3";
  matrixConfig.value = form(["Lounge"], "Lounge", [row("0", eq), row("1", eq)]);
  assert.equal(traces().length, 1);
});

test("test_rows_with_two_chains_draw_a_trace_each", () => {
  matrixConfig.value = form(["Lounge"], "Lounge", [
    row("0", "iir:type=peak;f=1000;q=1;g=-3"),
    row("1", "iir:type=peak;f=200;q=1;g=4"),
  ]);
  assert.equal(traces().length, 2);
});

test("test_the_window_spans_twelve_db_each_way_for_a_gentle_profile", () => {
  matrixConfig.value = form(["Lounge"], "Lounge", [row("0", "iir:type=peak;f=1000;q=1;g=-3")]);
  assert.deepEqual([levels().includes("+12"), levels().includes("+18")], [true, false]);
});

test("test_a_cut_deeper_than_twelve_db_widens_the_window_to_the_next_six", () => {
  matrixConfig.value = form(["Lounge"], "Lounge", [row("0", "iir:type=peak;f=1000;q=1;g=-15")]);
  assert.deepEqual([levels().includes("+18"), levels().includes("+24")], [true, false]);
});
