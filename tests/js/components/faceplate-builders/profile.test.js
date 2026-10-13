// Rendered suite for hqptuner/static/components/faceplate/builders/ProfileBuilder.js: the body of rail, hairline, page
// and the pipelines stage drawer, opening on the loaded station's New entry; the rail's entries, their answers, the
// skipped steps and the page showing lit, a tapped entry showing its page; the overview's title row and close, its
// intro and holds rows going to their step or opening the pipelines drawer, the chain picture with the matrix family lit,
// the picker by station with its dirty marks and its change switching record, the name window, the stations menu, the
// description, the confirm line, the state line and caption, the foot's buttons, and the Advanced settings link.
//
// Driven at the wire, as tests/js/store/faceplate-builders/profile.test.js is: the stations, the loaded one and Fixed
// volume on `config`, the post-process selects, the pipeline rows, the stored and daemon-known profiles and the live one
// on `matrixConfig`, the stored descriptions on `descriptions`, staging on `stagingWire`'s /api/config/stage path. The
// record being edited, the confirm line's question and the refusal are the shell's `cur`, `ask` and `refused`; the page
// showing is the store's `page`, the body and open drawer the view's `body` and `openStage`. Taps and typing are fired
// through the renderer's vnode seam, since render-to-string fires no events. Every name asserted is the fixture's own;
// every sentence is read from the store's tables or answers, never retyped.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-builders/profile.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import {
  ProfileBuilder,
  ProfileRail,
} from "../../../../hqptuner/static/components/faceplate/builders/ProfileBuilder.js";
import { ProfileOverview } from "../../../../hqptuner/static/components/faceplate/builders/ProfileOverview.js";
import { cur, staged, ask, refused } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { PB_STEPS } from "../../../../hqptuner/static/store/faceplate/builders/profile-data.js";
import {
  page,
  openProfileBuilder,
  setName,
  switchTo,
} from "../../../../hqptuner/static/store/faceplate/builders/profile.js";
import { body, openStage, openList, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { config, matrixConfig, engineState } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { descriptions } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { NEW, OVERVIEW } from "../../../../hqptuner/static/model/builders/builder.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";
import { every, inside, kids, first, vcls, isV, descend, fire as fireNow } from "../../support/rendered/treewalk.js";
import { ROW, PROF } from "../../support/profile-fixtures.js";
import { stagingWire, quiesce } from "../../support/wire/wire.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../support/profile-fixtures.js").PipelineRow} PipelineRow */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

const LOADED = "Day";
const STATIONS = [LOADED, "Night", "Spare"];
//: The profile the name window will not rename.
const DEFAULT = "[Default]";

/**
 * A straight stereo pair, In 1 to Out 1 and In 2 to Out 2, both rows on one gain.
 *
 * @param {string} gain
 * @returns {PipelineRow[]}
 */
const STEREO = (gain) => [ROW(gain), { ...ROW(gain), source: "1", mixdown: "1" }];

/**
 * A stored profile's post-process chain: crossfeed and DAC correction on or off, a Bauer preset, a DAC model.
 *
 * @param {string} on
 * @param {string} preset
 * @param {string} dac
 */
const post = (on, preset, dac) => ({
  post_bauer_enabled: on,
  post_bauer_preset: preset,
  post_correction_enabled: on,
  post_correction_dac0: dac,
  post_loudness_enabled: "0",
  post_loudness_rangelow: "-40",
  post_loudness_rangehigh: "-10",
});

const FLAT_NOTE = "fixture flat note";
//: A name typed into the name window, a question the confirm line is handed.
const TYPED = "Dusk";
const QUESTION = "fixture question";

/** A fresh /api/matrix payload: Flat engages the chain, Warm sits at the form's values and runs. */
const matrixTree = () => ({
  fields: [
    { name: "post_bauer_enabled", value: "0", options: [] },
    {
      name: "post_bauer_preset",
      value: "cmoy",
      options: [
        { value: "cmoy", label: "fx-Moy" },
        { value: "jmeier", label: "fx-Meier" },
      ],
    },
    { name: "post_correction_enabled", value: "0", options: [] },
    {
      name: "post_correction_dac0",
      value: "fx-dac-a",
      options: [
        { value: "", label: "" },
        { value: "fx-dac-a", label: "fx-dac-a" },
        { value: "fx-dac-b", label: "fx-dac-b" },
      ],
    },
    { name: "post_loudness_enabled", value: "0", options: [] },
    { name: "post_loudness_rangelow", value: "-40", options: [] },
    { name: "post_loudness_rangehigh", value: "-10", options: [] },
  ],
  rows: STEREO("0"),
  file_profiles: {
    Flat: PROF(STEREO("-2"), post("1", "jmeier", "fx-dac-b")),
    Warm: PROF(STEREO("0"), post("0", "cmoy", "fx-dac-a")),
  },
  live_profiles: ["Warm"],
  preset_profiles: { Day: ["Flat", "Warm"], Night: ["Warm"], Spare: ["Flat"] },
  live_active: "Warm",
});

/** A fresh /config form: the stations, Day loaded, Fixed volume off. */
const configTree = () => ({
  fields: [{ name: "fixed_volume_enabled", value: "0", options: [] }],
  file: {},
  profiles: { options: [{ value: "" }, ...STATIONS.map((value) => ({ value }))] },
  active: LOADED,
});

/** @type {StagingWire} */
let w;

beforeEach(async () => {
  w = stagingWire();
  engineState.value = {};
  config.value = configTree();
  matrixConfig.value = matrixTree();
  descriptions.value = { Flat: { text: FLAT_NOTE, updated: "2026-01-01T00:00:00Z" } };
  await discardAll();
  staged.value = new Map();
  ask.value = null;
  refused.value = false;
  cur.value = { st: "", name: NEW };
  body.value = "profile";
  openStage.value = null;
  openList.value = null;
  openPopover.value = null;
  await openProfileBuilder();
  await quiesce(w);
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** Switch to saved profile `name` in the loaded station and let the wire settle. @param {string} name */
async function onSaved(name) {
  await switchTo({ st: LOADED, name });
  await quiesce(w);
}

/** Put the fixture's question on the confirm line. */
const asking = () => {
  ask.value = {
    text: QUESTION,
    onConfirm: () => {},
  };
};

const builderTree = () => html`<${ProfileBuilder} />`;
const railTree = () => html`<${ProfileRail} />`;
const overviewTree = () => html`<${ProfileOverview} />`;

/** Every step's id, in the walk's order. */
const STEP_IDS = PB_STEPS.map((s) => s.id);
/** The rail's entries' ids, in order: the overview, then every step. */
const RAIL_IDS = [OVERVIEW, ...STEP_IDS];
/** The steps the overview's holds rows show, in order. */
const HOLD_IDS = ["eq", "crossfeed", "correction", "loudness"];

// --- markup ------------------------------------------------------------------------------------------------------

/** @type {Record<string, string>} */
const ENTITY = { quot: '"', "#39": "'", lt: "<", gt: ">", amp: "&" };

/** What a reader sees inside an element, the renderer's entities decoded. @param {MarkupElement | undefined} e */
const said = (e) => (e ? text(e).replace(/&(quot|#39|lt|gt|amp);/g, (_, k) => ENTITY[k]) : null);

/** Every element of one render of the overview. */
const drawn = () => elements(render(overviewTree()));

/** The first `name.cls…` of one render of the overview. @param {string} name @param {...string} cls */
const one = (name, ...cls) => every(drawn(), name, ...cls)[0];

/** The rail's entries, in document order. */
const entries = () =>
  every(elements(render(railTree())), "button", "st").filter((e) => attr(e, "data-stage") !== undefined);

/** The rail entry for `id`'s `span.cls` reading. @param {string} id @param {string} cls */
const entrySpan = (id, cls) =>
  said(
    first(
      entries().find((e) => attr(e, "data-stage") === id),
      "span",
      cls,
    ),
  );

/** The picker's select. */
const picker = () => first(one("label", "vfd", "pbpick"), "select");

/** The foot's buttons, in document order. */
const footButtons = () => every(inside(one("div", "pbfoot")), "button");

/** Whether the foot's Discard is disabled. */
const discardOff = () => {
  const b = footButtons().at(-2);
  return b && hasAttr(b, "disabled");
};

/** Whether the foot's Save is disabled. */
const saveOff = () => {
  const b = footButtons().at(-1);
  return b && hasAttr(b, "disabled");
};

/** The confirm lines drawn. */
const askLines = () => every(drawn(), "div", "bask");

/** The foot's state line. */
const stateLine = () => inside(one("div", "pbfoot")).find((e) => classes(e).includes("pbstate"));

/** Whether the foot's state line reads dirty. */
const stateDirty = () => {
  const line = stateLine();
  return line && classes(line).includes("dirty");
};

//: The restart mark's state-bearing handle, its `data-testid`.
const MARK = "restart-mark";

/** The restart marks the foot draws, in document order. */
const footMarks = () => inside(one("div", "pbfoot")).filter((e) => attr(e, "data-testid") === MARK);

/**
 * What a reader sees of a run of markup.
 *
 * @param {string} markup
 */
const readOf = (markup) => said({ name: "", attrs: "", start: 0, html: markup }) ?? "";

/** What a reader sees of the foot after its first restart mark; null when the foot draws none. */
const readAfterMark = () => {
  const foot = one("div", "pbfoot");
  const mark = footMarks()[0];
  return foot && mark ? readOf(foot.html.slice(mark.start + mark.html.length)) : null;
};

/** The state line's own sentence: what a reader sees of it, any restart mark inside it left out. */
const sentence = () => {
  const line = stateLine();
  const marks = footMarks();
  return line ? readOf(marks.reduce((rest, m) => rest.replace(m.html, ""), line.html)) : "";
};

// --- vnodes ------------------------------------------------------------------------------------------------------

/**
 * Every vnode one render of `tree` builds.
 *
 * @param {Parameters<typeof render>[0]} tree
 * @returns {VNode[]}
 */
const seenIn = (tree) => /** @type {VNode[]} */ (renderTree(tree).seen);

/** The first vnode of one render of the overview that is a host `name.cls…`. @param {string} name @param {...string} cls */
const vone = (name, ...cls) => seenIn(overviewTree()).find((v) => isV(v, name, ...cls));

/**
 * Fire one handler of a vnode, if it carries it, and let the wire settle.
 *
 * @param {VNode | undefined} v
 * @param {string} [handler]
 * @param {Record<string, unknown>} [extra]  what the event carries beyond the no-op methods
 */
async function fire(v, handler = "onClick", extra = {}) {
  await fireNow(v, handler, extra);
  await quiesce(w);
}

/**
 * Fire `handler` on `v` with a target holding `value`.
 *
 * @param {VNode | undefined} v
 * @param {string} handler
 * @param {string} value
 */
const typeInto = (v, handler, value) => {
  const target = { value };
  return fire(v, handler, { target, currentTarget: target });
};

/** Tap the rail entry for `id`. @param {string} id */
const tapEntry = (id) => fire(seenIn(railTree()).find((v) => v.type === "button" && propsOf(v)["data-stage"] === id));

/** The holds rows' vnodes, the pipelines row left out. */
const vholds = () => seenIn(overviewTree()).filter((v) => isV(v, "button", "pbhold") && !vcls(v).includes("pbpl"));

/** The foot's buttons' vnodes, in document order. */
const vfootButtons = () => descend(vone("div", "pbfoot")).filter((v) => v.type === "button");

/** The title row's close. */
const vclose = () => descend(vone("div", "btitle")).find((v) => v.type === "button");

/** The picker's select vnode. */
const vpicker = () => descend(vone("label", "vfd", "pbpick")).find((v) => v.type === "select");

// --- the body ----------------------------------------------------------------------------------------------------

test("test_mounting_the_body_opens_on_the_loaded_stations_new_entry", async () => {
  await onSaved("Flat");
  render(builderTree());
  await quiesce(w);
  assert.deepEqual(cur.value, { st: LOADED, name: NEW });
});

// --- the rail ----------------------------------------------------------------------------------------------------

test("test_the_rail_holds_one_entry_for_the_overview_then_each_step_in_the_walks_order", () => {
  assert.deepEqual(
    entries().map((e) => attr(e, "data-stage")),
    RAIL_IDS,
  );
});

test("test_the_overview_entry_reads_the_typed_name", async () => {
  await setName(TYPED);
  assert.equal(entrySpan(OVERVIEW, "v"), TYPED);
});

test("test_only_the_entry_of_the_page_showing_lights_open", () => {
  page.value = "correction";
  assert.deepEqual(
    entries().map((e) => classes(e).includes("open")),
    RAIL_IDS.map((id) => id === "correction"),
  );
});

test("test_only_the_entry_of_the_page_showing_is_the_current_one", () => {
  page.value = "eq";
  assert.deepEqual(
    entries().map((e) => attr(e, "aria-current") === "true"),
    RAIL_IDS.map((id) => id === "eq"),
  );
});

test("test_advanced_settings_lights_the_overview_entry", () => {
  page.value = "advanced";
  assert.deepEqual(
    entries().map((e) => classes(e).includes("open")),
    RAIL_IDS.map((id) => id === OVERVIEW),
  );
});

test("test_tapping_an_entry_shows_its_page", async () => {
  await tapEntry("loudness");
  assert.equal(page.value, "loudness");
});

// --- the overview's title row ------------------------------------------------------------------------------------

test("test_tapping_close_shows_the_chain", async () => {
  await fire(vclose());
  assert.equal(body.value, "chain");
});

// --- the intro and the holds -------------------------------------------------------------------------------------

test("test_tapping_a_hold_row_shows_its_step", async () => {
  await fire(vholds()[HOLD_IDS.indexOf("correction")]);
  assert.equal(page.value, "correction");
});

test("test_tapping_the_pipelines_hold_row_opens_the_pipelines_drawer", async () => {
  await fire(vone("button", "pbhold", "pbpl"));
  assert.equal(openStage.value, "pipelines");
});

// --- the picker --------------------------------------------------------------------------------------------------

test("test_the_picker_ends_on_an_option_outside_the_station_groups", () => {
  const last = kids(picker()).at(-1);
  assert.equal(last?.name, "option");
});

test("test_the_pickers_last_entry_is_the_new_entry", () => {
  const last = kids(picker()).at(-1);
  assert.equal(last ? attr(last, "value") : null, NEW);
});

test("test_picking_a_saved_name_switches_to_it", async () => {
  const sel = vpicker();
  const opt = descend(sel).find((v) => v.type === "option" && textOf(propsOf(v).children).trim() === "Warm");
  await typeInto(sel, "onChange", String(opt ? propsOf(opt).value : ""));
  assert.deepEqual(cur.value, { st: LOADED, name: "Warm" });
});

// --- the confirm line --------------------------------------------------------------------------------------------

test("test_the_confirm_line_shows_while_a_question_is_asked", () => {
  asking();
  assert.equal(askLines().length, 1);
});

// --- the state line and the caption ------------------------------------------------------------------------------

test("test_the_state_line_reads_dirty_while_a_new_profile_is_pending", () => {
  assert.equal(stateDirty(), true);
});

// --- the restart mark on the state line --------------------------------------------------------------------------

test("test_the_foot_marks_a_restart_while_a_new_profile_waits_for_save", () => {
  assert.equal(footMarks().length, 1);
});

test("test_the_foot_draws_no_restart_mark_on_the_clean_profile_the_engine_runs", async () => {
  await onSaved("Warm");
  assert.equal(footMarks().length, 0);
});

test("test_the_foot_marks_a_restart_on_an_edited_saved_profile", async () => {
  await onSaved("Flat");
  await setName(TYPED);
  assert.equal(footMarks().length, 1);
});

test("test_the_foot_draws_no_restart_mark_on_a_clean_saved_profile", async () => {
  await onSaved("Flat");
  assert.equal(footMarks().length, 0);
});

test("test_the_restart_mark_stands_directly_in_front_of_the_state_lines_sentence", () => {
  const line = sentence();
  assert.equal(readAfterMark()?.slice(0, line.length), line);
});

// --- the foot's buttons ------------------------------------------------------------------------------------------

test("test_tapping_start_from_scratch_shows_the_first_step", async () => {
  await fire(vfootButtons()[0]);
  assert.equal(page.value, PB_STEPS[0].id);
});

test("test_tapping_change_something_shows_the_first_step", async () => {
  await fire(vfootButtons()[1]);
  assert.equal(page.value, PB_STEPS[0].id);
});

test("test_the_foot_carries_no_delete_on_a_new_profile", () => {
  assert.equal(footButtons().length, 4);
});

test("test_the_foot_carries_delete_on_a_saved_profile", async () => {
  await onSaved("Flat");
  assert.equal(footButtons().length, 5);
});

test("test_the_foot_carries_no_delete_on_the_default_profile", async () => {
  await onSaved("Flat");
  cur.value = { st: LOADED, name: DEFAULT };
  assert.equal(footButtons().length, 4);
});

test("test_discard_is_disabled_while_the_edit_is_clean", () => {
  assert.equal(discardOff(), true);
});

test("test_save_is_disabled_on_a_clean_saved_profile", async () => {
  await onSaved("Flat");
  assert.equal(saveOff(), true);
});

test("test_tapping_save_with_no_name_refuses", async () => {
  await fire(vfootButtons().at(-1));
  assert.equal(refused.value, true);
});

// --- advanced settings -------------------------------------------------------------------------------------------

test("test_tapping_the_advanced_link_shows_advanced_settings", async () => {
  await fire(vone("button", "pbadvlink"));
  assert.equal(page.value, "advanced");
});
