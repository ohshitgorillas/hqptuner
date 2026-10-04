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
import { StationsMenu } from "../../../../hqptuner/static/components/faceplate/builders/StationsMenu.js";
import { cur, staged, ask, refused } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import {
  MATRIX_STAGES,
  OUTSIDE_STAGES,
  PB_COPY,
  PB_STEPS,
  PROFILE_COPY,
} from "../../../../hqptuner/static/store/faceplate/builders/profile-data.js";
import {
  meta,
  page,
  openProfileBuilder,
  profileBook,
  skip,
  answerOf,
  setName,
  setDesc,
  setListen,
  switchTo,
} from "../../../../hqptuner/static/store/faceplate/builders/profile.js";
import { railStages, railNow } from "../../../../hqptuner/static/store/faceplate/chain.js";
import { body, openStage, openList, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { config, matrixConfig, engineState } from "../../../../hqptuner/static/store/signals.js";
import { edit, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { descriptions } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { NEW, OVERVIEW } from "../../../../hqptuner/static/model/builders/builder.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";
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
//: A name typed into the name window, a note typed into the description, a question the confirm line is handed.
const TYPED = "Dusk";
const NOTE = "fx-dusk note";
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

/** How many times the question's own action ran. */
let runs = 0;

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
  runs = 0;
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
    onConfirm: () => {
      runs += 1;
    },
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

/** @param {string} id */
const titleOf = (id) => PB_STEPS.find((s) => s.id === id)?.title ?? "no-such-step";

// --- markup ------------------------------------------------------------------------------------------------------

/** @type {Record<string, string>} */
const ENTITY = { quot: '"', "#39": "'", lt: "<", gt: ">", amp: "&" };

/** What a reader sees inside an element, the renderer's entities decoded. @param {MarkupElement | undefined} e */
const said = (e) => (e ? text(e).replace(/&(quot|#39|lt|gt|amp);/g, (_, k) => ENTITY[k]) : null);

/**
 * Whether an element is a `name` carrying every class in `cls`.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} name
 * @param {string[]} cls
 */
const isEl = (e, name, cls) => e !== undefined && e.name === name && cls.every((c) => classes(e).includes(c));

/**
 * Every element of a list that is a `name` with the classes in `cls`.
 *
 * @param {MarkupElement[]} all
 * @param {string} name
 * @param {...string} cls
 */
const every = (all, name, ...cls) => all.filter((e) => isEl(e, name, cls));

/** The elements inside `e`, `e` itself left out; none when `e` is missing. @param {MarkupElement | undefined} e */
const inside = (e) => (e ? elements(e.html).slice(0, -1) : []);

/** The elements directly inside `e`. @param {MarkupElement | undefined} e */
const kids = (e) => {
  const all = inside(e);
  return all.filter(
    (k) => !all.some((o) => o !== k && o.start <= k.start && o.start + o.html.length >= k.start + k.html.length),
  );
};

/**
 * The first `name.cls…` inside `e`.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} name
 * @param {...string} cls
 */
const first = (e, name, ...cls) => every(inside(e), name, ...cls)[0];

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

/** The holds rows, the pipelines row left out. */
const holds = () => every(drawn(), "button", "pbhold").filter((e) => !classes(e).includes("pbpl"));

/** The hold row of step `id`'s answer. @param {string} id */
const holdAnswer = (id) => said(first(holds()[HOLD_IDS.indexOf(id)], "span", "pa"));

/** The chain picture's lines. */
const chainLines = () => kids(one("ol", "pbchain")).filter((e) => e.name === "li");

/** The picker's select. */
const picker = () => first(one("label", "vfd", "pbpick"), "select");

/** The picker's group for the loaded station. */
const loadedGroup = () => kids(picker()).find((e) => e.name === "optgroup" && attr(e, "label") === LOADED);

/** The name window's input. */
const nameInput = () =>
  every(inside(one("label", "vfd", "bname")), "input", "bnin").find((e) => attr(e, "aria-label") === "Profile name");

/** The foot's buttons, in document order. */
const footButtons = () => every(inside(one("div", "pbfoot")), "button");

/** The confirm lines drawn. */
const askLines = () => every(drawn(), "div", "bask");

/** The foot's state line. */
const stateLine = () => inside(one("div", "pbfoot")).find((e) => classes(e).includes("pbstate"));

/** The caption's refusals' readings. */
const refusals = () => every(inside(first(one("div", "pbfoot"), "div", "pbcap")), "span", "bref").map(said);

/** The pipelines stage's name on the rail. */
const pipelinesName = () => railStages(railNow()).find((s) => s.id === "pipelines")?.name ?? "no-such-stage";

// --- vnodes ------------------------------------------------------------------------------------------------------

/** A vnode's classes. @param {VNode | undefined} v */
const vcls = (v) => (v ? String(propsOf(v).class ?? propsOf(v).className ?? "").split(/\s+/) : []);

/**
 * Whether a vnode is a host `name` carrying every class in `cls`.
 *
 * @param {VNode | undefined} v
 * @param {string} name
 * @param {...string} cls
 */
const isV = (v, name, ...cls) => v !== undefined && v.type === name && cls.every((c) => vcls(v).includes(c));

/**
 * Whether a value is a vnode.
 *
 * @param {unknown} c
 * @returns {c is VNode}
 */
const isVNode = (c) => typeof c === "object" && c !== null && "type" in c && "props" in c;

/**
 * The vnodes directly under `v`, empty slots left out.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
const vkids = (v) => (v ? [propsOf(v).children].flat(Infinity).filter(isVNode) : []);

/**
 * `v` and every vnode under it, in document order; a component's own output is not under it.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
const descend = (v) => (v ? [v, ...vkids(v).flatMap(descend)] : []);

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
  const fn = v ? propsOf(v)[handler] : undefined;
  if (typeof fn === "function") await fn({ preventDefault: () => {}, stopPropagation: () => {}, ...extra });
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

/** The textarea of the description. */
const vdesc = () =>
  descend(vone("label", "desc", "pbdesc")).find(
    (v) => v.type === "textarea" && propsOf(v)["aria-label"] === "Profile description",
  );

/** The name window's input vnode. */
const vname = () =>
  descend(vone("label", "vfd", "bname")).find((v) => v.type === "input" && propsOf(v)["aria-label"] === "Profile name");

/** The confirm line's buttons' vnodes, in document order. */
const vaskButtons = () => descend(vone("div", "bask")).filter((v) => v.type === "button");

// --- the body ----------------------------------------------------------------------------------------------------

test("test_the_profile_body_holds_the_rail_the_hairline_the_page_and_the_pipelines_drawer_in_that_order", () => {
  const root = elements(render(builderTree())).find((e) => e.name === "div" && attr(e, "data-body") === "profile");
  const k = kids(root);
  assert.deepEqual(
    [
      isEl(root, "div", ["body"]),
      k.length,
      isEl(k[0], "nav", ["rail", "prail"]),
      isEl(k[1], "div", ["vrule"]),
      isEl(k[2], "main", ["page", "pbpage"]),
      isEl(k[3], "aside", ["drawer"]),
      k[3] ? attr(k[3], "id") : null,
    ],
    [true, 4, true, true, true, true, "drawer-pipelines"],
  );
});

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

test("test_the_rail_titles_the_overview_then_each_step", () => {
  assert.deepEqual(
    RAIL_IDS.map((id) => entrySpan(id, "n")),
    [PB_COPY.overview, ...PB_STEPS.map((s) => s.title)],
  );
});

test("test_an_applicable_steps_entry_reads_its_answer", () => {
  const live = STEP_IDS.filter((id) => skip(id) === "");
  assert.deepEqual(
    live.map((id) => entrySpan(id, "v")),
    live.map(answerOf),
  );
});

test("test_a_skipped_steps_entry_reads_skipped", () => {
  assert.equal(entrySpan("crossfeed", "v"), PB_COPY.skipped);
});

test("test_only_a_skipped_steps_entry_carries_skip", () => {
  assert.deepEqual(
    entries().map((e) => classes(e).includes("skip")),
    RAIL_IDS.map((id) => id !== OVERVIEW && skip(id) !== ""),
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

test("test_the_close_names_the_builder_the_title_names", () => {
  const close = every(inside(one("div", "sh", "btitle")), "button").find((e) => hasAttr(e, "aria-label"));
  const title = first(one("div", "sh", "btitle"), "span", "t");
  assert.equal(close ? attr(close, "aria-label") : null, `Close ${said(title)}`);
});

test("test_tapping_close_shows_the_chain", async () => {
  await fire(vclose());
  assert.equal(body.value, "chain");
});

// --- the intro and the holds -------------------------------------------------------------------------------------

test("test_the_intro_reads_the_builders_intro", () => {
  assert.equal(said(first(one("div", "pbovtop"), "p", "pbintro")), PB_COPY.intro);
});

test("test_the_holds_heading_reads_what_the_profile_holds", () => {
  assert.equal(said(first(one("div", "pbovtop"), "div", "pbhh")), PB_COPY.holds);
});

test("test_one_hold_row_per_step_it_holds_titled_by_that_step", () => {
  assert.deepEqual(
    holds().map((e) => said(first(e, "b"))),
    HOLD_IDS.map(titleOf),
  );
});

test("test_an_applicable_steps_hold_reads_its_answer", () => {
  const live = HOLD_IDS.filter((id) => skip(id) === "");
  assert.deepEqual(live.map(holdAnswer), live.map(answerOf));
});

test("test_a_skipped_steps_hold_reads_skipped", () => {
  assert.equal(holdAnswer("crossfeed"), PB_COPY.skipped);
});

test("test_crossfeed_engaged_reads_its_answer_on_its_hold_though_skipped", async () => {
  await edit("crossfeed_enabled", "1");
  await quiesce(w);
  await setListen("speakers");
  assert.equal(holdAnswer("crossfeed"), answerOf("crossfeed"));
});

test("test_tapping_a_hold_row_shows_its_step", async () => {
  await fire(vholds()[HOLD_IDS.indexOf("correction")]);
  assert.equal(page.value, "correction");
});

test("test_the_pipelines_hold_row_names_the_pipelines_stage", () => {
  assert.equal(said(first(one("button", "pbhold", "pbpl"), "b")), pipelinesName());
});

test("test_tapping_the_pipelines_hold_row_opens_the_pipelines_drawer", async () => {
  await fire(vone("button", "pbhold", "pbpl"));
  assert.equal(openStage.value, "pipelines");
});

// --- the chain picture -------------------------------------------------------------------------------------------

test("test_the_chain_picture_lights_the_matrix_family_stages", () => {
  assert.deepEqual(
    chainLines().map((e) => classes(e).includes("mx")),
    railStages(railNow()).map((s) => MATRIX_STAGES.includes(s.id)),
  );
});

test("test_the_chain_picture_marks_the_stages_outside_the_matrix_engine", () => {
  assert.deepEqual(
    chainLines().map((e) => classes(e).includes("out")),
    railStages(railNow()).map((s) => OUTSIDE_STAGES.includes(s.id)),
  );
});

// --- the picker --------------------------------------------------------------------------------------------------

test("test_the_picker_groups_by_station_of_the_book", () => {
  assert.deepEqual(
    kids(picker())
      .filter((e) => e.name === "optgroup")
      .map((e) => attr(e, "label")),
    Object.keys(profileBook()),
  );
});

test("test_each_station_group_lists_its_profiles_names", () => {
  assert.deepEqual(every(inside(loadedGroup()), "option").map(said), Object.keys(profileBook()[LOADED] ?? {}));
});

test("test_the_new_entry_follows_the_station_groups", () => {
  const last = kids(picker()).at(-1);
  assert.deepEqual([last?.name, last ? attr(last, "value") : null], ["option", NEW]);
});

test("test_picking_a_saved_name_switches_to_it", async () => {
  const sel = vpicker();
  const opt = descend(sel).find((v) => v.type === "option" && textOf(propsOf(v).children).trim() === "Warm");
  await typeInto(sel, "onChange", String(opt ? propsOf(opt).value : ""));
  assert.deepEqual(cur.value, { st: LOADED, name: "Warm" });
});

test("test_only_a_dirty_records_option_carries_the_dirty_mark", async () => {
  await onSaved("Flat");
  await setDesc(NOTE);
  await onSaved("Warm");
  const opts = every(inside(loadedGroup()), "option");
  assert.deepEqual(
    ["Flat", "Warm"].map((n) => opts.some((o) => said(o) === `${n} •`)),
    [true, false],
  );
});

// --- the name window, the stations menu and the description ------------------------------------------------------

test("test_the_name_window_shows_the_edits_name", async () => {
  const fresh = nameInput();
  await onSaved("Flat");
  const saved = nameInput();
  assert.deepEqual(
    [fresh && (attr(fresh, "value") ?? (hasAttr(fresh, "value") ? "" : undefined)), saved && attr(saved, "value")],
    ["", "Flat"],
  );
});

test("test_the_name_window_is_read_only_only_on_the_default_profile", () => {
  const fresh = nameInput();
  cur.value = { st: LOADED, name: DEFAULT };
  const dflt = nameInput();
  assert.deepEqual([fresh && hasAttr(fresh, "readonly"), dflt && hasAttr(dflt, "readonly")], [false, true]);
});

test("test_typing_a_name_names_the_edit", async () => {
  await typeInto(vname(), "onInput", TYPED);
  assert.equal(meta.value.name, TYPED);
});

test("test_the_overview_holds_the_stations_menu", () => {
  assert.equal(seenIn(overviewTree()).filter((v) => v.type === StationsMenu).length, 1);
});

test("test_the_description_shows_the_edits_description", async () => {
  const fresh = vdesc();
  await onSaved("Flat");
  const saved = vdesc();
  assert.deepEqual([fresh && propsOf(fresh).value, saved && propsOf(saved).value], ["", FLAT_NOTE]);
});

test("test_typing_a_description_describes_the_edit", async () => {
  await typeInto(vdesc(), "onInput", NOTE);
  assert.equal(meta.value.desc, NOTE);
});

// --- the confirm line --------------------------------------------------------------------------------------------

test("test_the_confirm_line_shows_only_while_a_question_is_asked", () => {
  const idle = askLines().length;
  asking();
  assert.deepEqual([idle, askLines().length], [0, 1]);
});

test("test_the_confirm_lines_first_button_answers_the_question", async () => {
  asking();
  await fire(vaskButtons()[0]);
  assert.deepEqual([runs, ask.value], [1, null]);
});

test("test_the_confirm_lines_second_button_cancels_the_question", async () => {
  asking();
  await fire(vaskButtons()[1]);
  assert.deepEqual([runs, ask.value], [0, null]);
});

// --- the state line and the caption ------------------------------------------------------------------------------

test("test_the_new_entry_says_saving_restarts_and_runs_it", () => {
  assert.equal(said(stateLine()), PB_COPY.state.dirtyRun);
});

test("test_a_clean_profile_the_engine_runs_says_running", async () => {
  await onSaved("Warm");
  assert.equal(said(stateLine()), PB_COPY.state.running);
});

test("test_a_clean_profile_the_engine_does_not_run_says_saved", async () => {
  await onSaved("Flat");
  assert.equal(said(stateLine()), PB_COPY.state.saved);
});

test("test_the_state_line_reads_dirty_only_while_pending", async () => {
  const fresh = stateLine();
  await onSaved("Flat");
  const saved = stateLine();
  assert.deepEqual(
    [fresh && classes(fresh).includes("dirty"), saved && classes(saved).includes("dirty")],
    [true, false],
  );
});

test("test_the_caption_holds_the_refusal_only_while_refused", () => {
  const before = refusals();
  refused.value = true;
  assert.deepEqual([before, refusals()], [[], [PROFILE_COPY.noName]]);
});

// --- the foot's buttons ------------------------------------------------------------------------------------------

test("test_the_foot_opens_with_start_from_scratch_then_change_something", () => {
  assert.deepEqual(footButtons().slice(0, 2).map(said), [PB_COPY.scratch, PB_COPY.change]);
});

test("test_tapping_start_from_scratch_shows_the_first_step", async () => {
  await fire(vfootButtons()[0]);
  assert.equal(page.value, PB_STEPS[0].id);
});

test("test_tapping_change_something_shows_the_first_step", async () => {
  await fire(vfootButtons()[1]);
  assert.equal(page.value, PB_STEPS[0].id);
});

test("test_the_foot_carries_delete_only_on_a_saved_profile_other_than_the_default", async () => {
  const fresh = footButtons().length;
  await onSaved("Flat");
  const saved = footButtons().length;
  cur.value = { st: LOADED, name: DEFAULT };
  assert.deepEqual([fresh, saved, footButtons().length], [4, 5, 4]);
});

test("test_tapping_delete_asks_to_remove_the_profile_edited", async () => {
  await onSaved("Flat");
  await fire(vfootButtons()[2]);
  assert.equal(ask.value?.text, PROFILE_COPY.remove("Flat"));
});

test("test_discard_is_disabled_while_the_edit_is_clean", async () => {
  const clean = footButtons().at(-2);
  await setName(TYPED);
  const dirty = footButtons().at(-2);
  assert.deepEqual([clean && hasAttr(clean, "disabled"), dirty && hasAttr(dirty, "disabled")], [true, false]);
});

test("test_save_is_disabled_only_on_a_clean_saved_profile", async () => {
  const fresh = footButtons().at(-1);
  await onSaved("Flat");
  const saved = footButtons().at(-1);
  assert.deepEqual([fresh && hasAttr(fresh, "disabled"), saved && hasAttr(saved, "disabled")], [false, true]);
});

test("test_tapping_save_with_no_name_refuses", async () => {
  await fire(vfootButtons().at(-1));
  assert.equal(refused.value, true);
});

// --- advanced settings -------------------------------------------------------------------------------------------

test("test_the_advanced_link_follows_the_foot", () => {
  const all = drawn();
  const foot = every(all, "div", "pbfoot")[0];
  const link = every(all, "button", "pbadvlink")[0];
  assert.equal(foot && link ? link.start >= foot.start + foot.html.length : null, true);
});

test("test_the_advanced_link_reads_advanced_settings", () => {
  assert.equal(said(one("button", "pbadvlink"))?.startsWith(PB_COPY.advanced), true);
});

test("test_tapping_the_advanced_link_shows_advanced_settings", async () => {
  await fire(vone("button", "pbadvlink"));
  assert.equal(page.value, "advanced");
});
