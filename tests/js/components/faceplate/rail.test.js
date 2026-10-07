// Rendered suite for hqptuner/static/components/faceplate/Rail.js: one button per rail stage, carrying its id, its level,
// its lamp, the stage whose drawer is open, a bypassed stage and a hidden one, and a tap that opens its drawer.
//
// The wire is the seam: /api/state into `engineState`, the junk filter enumeration into `enums`, the Status frame into
// `engineStatus`, the /config and /matrix forms into `config` and `matrixConfig`, and the backend's readiness into
// `health`.
//
// Not reachable here: the wire drawn through the lamps, which measures the rendered rail in an effect; server rendering
// lays nothing out and runs no effects. A browser run closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/rail.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Rail } from "../../../../hqptuner/static/components/faceplate/Rail.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { hiddenStages } from "../../../../hqptuner/static/store/ui/faceplate.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  health,
  matrixConfig,
  staged,
  volume,
} from "../../../../hqptuner/static/store/signals.js";
import { elements, attr, classes, text, hasAttr } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */

/**
 * A PCM source playing, or in the transport `state` given, with the HF filter at the junk filter enumeration's item
 * `junk`.
 *
 * @param {string} junk
 * @param {string} [state]  /api/state `state`: "2" is playing
 */
function playing(junk, state = "2") {
  health.value = { ready: true };
  engineState.value = { state, active_chain: "pcm", filter_junk: junk };
  enums.value = { junk_filters: ["none", "30k"].map((name, i) => ({ index: String(i), name })) };
  engineStatus.value = { status: { active_rate: "176400" }, metadata: { samplerate: "44100", bits: "16" } };
  config.value = { fields: [] };
  matrixConfig.value = { fields: [{ name: "enabled", value: true }] };
}

beforeEach(() => {
  playing("1");
  staged.value = { live: {}, http: {} };
  volume.value = "-20";
  hiddenStages.value = [];
  openStage.value = null;
});

/** The rendered rail's stage buttons. */
const buttons = () => elements(render(html`<${Rail} />`)).filter((e) => e.name === "button");

/**
 * The ids of the rendered stages that satisfy a test.
 *
 * @param {(b: MarkupElement) => boolean} pick
 */
const idsWhere = (pick) =>
  buttons()
    .filter(pick)
    .map((b) => attr(b, "data-stage"));

/**
 * The rendered button of one stage, or an empty element when there is none.
 *
 * @param {string} id
 * @returns {MarkupElement}
 */
const button = (id) =>
  buttons().find((b) => attr(b, "data-stage") === id) || { name: "", attrs: "", start: -1, html: "" };

/**
 * One part of a stage's button by its class: the lamp or the value.
 *
 * @param {string} id
 * @param {string} part
 * @returns {MarkupElement}
 */
const partOf = (id, part) =>
  elements(button(id).html).find((e) => classes(e).includes(part)) || { name: "", attrs: "", start: -1, html: "" };

test("test_a_stage_renders_as_a_button_carrying_its_id", () => {
  assert.ok(idsWhere(() => true).includes("hf"));
});

test("test_the_matrix_engine_parts_carry_their_level", () => {
  assert.equal(attr(button("pipelines"), "data-level"), "1");
});

test("test_only_the_stage_whose_drawer_is_open_carries_open", () => {
  openStage.value = "volume";
  assert.deepEqual(
    idsWhere((b) => classes(b).includes("open")),
    ["volume"],
  );
});

test("test_a_stage_this_path_does_not_run_carries_byp", () => {
  assert.deepEqual(
    idsWhere((b) => classes(b).includes("byp")),
    ["dsd"],
  );
});

test("test_a_stage_the_preferences_hide_is_hidden", () => {
  hiddenStages.value = ["loudness"];
  assert.deepEqual(
    idsWhere((b) => hasAttr(b, "hidden")),
    ["loudness"],
  );
});

test("test_a_running_hf_filter_lights_its_lamp", () => {
  assert.ok(classes(partOf("hf", "lamp")).includes("on"));
});

test("test_the_hf_filter_at_none_leaves_its_lamp_as_a_running_one_does_not", () => {
  const lit = classes(partOf("hf", "lamp"));
  playing("0");
  assert.notDeepEqual(classes(partOf("hf", "lamp")), lit);
});

test("test_an_unlit_stage_carries_off", () => {
  playing("0");
  assert.ok(classes(button("hf")).includes("off"));
});

test("test_a_stage_lighting_up_changes_its_classes", () => {
  playing("0");
  const unlit = classes(button("hf"));
  playing("1");
  assert.notDeepEqual(classes(button("hf")), unlit);
});

test("test_a_stage_shows_its_value", () => {
  assert.equal(text(partOf("hf", "v")), "30k");
});

test("test_tapping_a_stage_opens_its_drawer", () => {
  const { seen } = renderTree(html`<${Rail} />`);
  const hit = seen.find((v) => v.type === "button" && v.props["data-stage"] === "output");
  const onClick = /** @type {(() => void) | undefined} */ (hit && hit.props.onClick);
  if (onClick) onClick();
  assert.equal(openStage.value, "output");
});

test("test_paused_the_source_lamp_carries_pause", () => {
  playing("1", "1");
  assert.ok(classes(partOf("source", "lamp")).includes("pause"));
});
