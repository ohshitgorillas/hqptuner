// Rendered suite for hqptuner/static/components/faceplate/builders/ProfileEq.js: the EQ / Correction step's rows.
// Headphone Auto EQ only while the edit listens on headphones, its search box, credit line and paragraph; typing a
// query lists the ranked hits and how many were cut; a tap on a hit picks it and shows its strip, whose Clear drops
// the pick and whose Load lands the hit's bands on the staged stereo pair and empties the search; the correction files
// row with its two buttons, its two hidden file inputs and its mirror box ticked; then what the pair holds and its
// response plot.
//
// Driven at the wire, as tests/js/store/faceplate-builders/profile.test.js is: the stations and the loaded one on
// `config`, the post-process selects and the stereo pair on `matrixConfig`, staging on `stagingWire`'s real
// /api/config/stage path, and the AutoEq library on GET /api/autoeq answered from the wire's `routes` with four
// profiles of the fixture's own, which the one-token query matches all of. Listening is the store's `setListen`. Taps
// and typing are fired through the renderer's vnode seam, since render-to-string fires no events. The search's query
// and the picked hit live inside the component; each headphones case starts by typing an empty query, which drops the
// pick. Every copy string is read from profile-data.js or the component's own exports, never retyped.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-builders/profile-eq.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { EqStep, FILES_LABEL, PLOT_ARIA } from "../../../../hqptuner/static/components/faceplate/builders/ProfileEq.js";
import { config, matrixConfig, engineState } from "../../../../hqptuner/static/store/signals.js";
import { effectivePipelines } from "../../../../hqptuner/static/store/resolve.js";
import { discardAll, stagePipelines } from "../../../../hqptuner/static/store/actions.js";
import { descriptions } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { NEW } from "../../../../hqptuner/static/model/builders/builder.js";
import { cur, staged, ask, refused } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { AEQ_COPY, AUTOEQ_COPY, EQ_MAN } from "../../../../hqptuner/static/store/faceplate/builders/profile-data.js";
import {
  answerOf,
  openProfileBuilder,
  setListen,
} from "../../../../hqptuner/static/store/faceplate/builders/profile.js";
import { rankProfiles } from "../../../../hqptuner/static/lib/profilerank.js";
import { parseProcess } from "../../../../hqptuner/static/vendor/eqlab/core/matrixspec.js";
import { ROW } from "../../support/profile-fixtures.js";
import { stagingWire, ok, quiesce } from "../../support/wire/wire.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";

/** @typedef {import("../../support/profile-fixtures.js").PipelineRow} PipelineRow */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {{ model: string, source: string, pre: number, lines: string[] }} Entry  a profile and what its text says */

const LOADED = "Day";

/** Three peak stages, as a pipeline's process carries them. */
const PEAKS = [
  "iir:type=peak;f=100.0;q=0.70;g=-3",
  "iir:type=peak;f=1000.0;q=1.00;g=2",
  "iir:type=peak;f=8000.0;q=2.00;g=-1",
].join(",");

/**
 * A straight stereo pair, In 1 to Out 1 and In 2 to Out 2, both rows on one gain and one process.
 *
 * @param {string} gain
 * @param {string} [process]
 * @returns {PipelineRow[]}
 */
const STEREO = (gain, process = "") => [
  { ...ROW(gain), process },
  { ...ROW(gain), process, source: "1", mixdown: "1" },
];

/**
 * `n` peak filter lines in ParametricEQ.txt's grammar.
 *
 * @param {number} n
 * @returns {string[]}
 */
const filters = (n) =>
  Array.from({ length: n }, (_, i) => `Filter ${i + 1}: ON PK Fc ${100 * (i + 1)} Hz Gain ${i - 2}.5 dB Q 0.71`);

/**
 * The library's profiles: every model holds the query, each text a different preamp and filter count.
 *
 * @type {Entry[]}
 */
const ENTRIES = [
  { model: "Fx HD 600", source: "crinacle", pre: -5.2, lines: filters(2) },
  { model: "MyHD One", source: "oratory1990", pre: -2, lines: filters(1) },
  { model: "HD 650", source: "oratory1990", pre: -6.4, lines: filters(3) },
  { model: "Fx HD 580", source: "oratory1990", pre: -4.1, lines: filters(5) },
];

/** The profiles as GET /api/autoeq carries them. */
const PROFILES = ENTRIES.map((e) => ({
  model: e.model,
  source: e.source,
  text: [`Preamp: ${e.pre} dB`, ...e.lines].join("\n"),
}));

/** The GET /api/autoeq payload. */
const LIBRARY = { meta: { profiles: PROFILES.length, sha: "0123456789abcdef" }, profiles: PROFILES };

/** A one-token query every model holds. */
const QUERY = "hd";
/** How many hits the step lists. */
const SHOWN = 3;
/** The hit a pick taps: the second listed. */
const PICK = 1;

/** A fresh /api/matrix payload: the stereo pair, no saved profile. */
const matrixTree = () => ({
  fields: [
    { name: "post_bauer_enabled", value: "0", options: [] },
    { name: "post_correction_enabled", value: "0", options: [] },
    { name: "post_loudness_enabled", value: "0", options: [] },
  ],
  rows: STEREO("0"),
  file_profiles: {},
  live_profiles: [],
  preset_profiles: { [LOADED]: [] },
  live_active: "",
});

/** A fresh /config form: one station, loaded. */
const configTree = () => ({
  fields: [{ name: "fixed_volume_enabled", value: "0", options: [] }],
  file: {},
  profiles: { options: [{ value: "" }, { value: LOADED }] },
  active: LOADED,
});

/**
 * The routes the step reaches beyond staging: the AutoEq library.
 *
 * @param {string} path
 */
const routes = (path) => (path === "/api/autoeq" ? ok(LIBRARY) : undefined);

/** @type {StagingWire} */
let w;

beforeEach(async () => {
  w = stagingWire({ routes });
  engineState.value = {};
  config.value = configTree();
  matrixConfig.value = matrixTree();
  descriptions.value = {};
  await discardAll();
  staged.value = new Map();
  ask.value = null;
  refused.value = false;
  cur.value = { st: "", name: NEW };
  openProfileBuilder();
  await quiesce(w);
});

const tree = () => html`<div>${html`<${EqStep} />`}</div>`;

// --- markup ------------------------------------------------------------------------------------------------------

/**
 * SSR's entities decoded.
 *
 * @param {string} s
 */
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * What a reader sees inside an element, entities decoded; empty when the element is missing.
 *
 * @param {MarkupElement | undefined} e
 */
const said = (e) => (e ? decode(text(e)) : "");

/**
 * One attribute, entities decoded.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} name
 */
const attrOf = (e, name) => {
  const v = e ? attr(e, name) : undefined;
  return v === undefined ? undefined : decode(v);
};

/** Every element of one render of the step. */
const drawn = () => elements(render(tree()));

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

/**
 * The elements inside `e`, `e` itself left out; none when `e` is missing.
 *
 * @param {MarkupElement | undefined} e
 */
const inside = (e) => (e ? elements(e.html).slice(0, -1) : []);

/**
 * A row's label: the bold head of its control column.
 *
 * @param {MarkupElement} row
 */
const labelOf = (row) => said(every(inside(every(inside(row), "div", "fh")[0]), "b")[0]);

/**
 * The drawer rows of one render labelled `label`.
 *
 * @param {string} label
 */
const rowsLabelled = (label) => every(drawn(), "div", "drow").filter((r) => labelOf(r) === label);

/** The Headphone Auto EQ row. */
const autoRow = () => rowsLabelled(AEQ_COPY.title)[0];

/** The correction files row. */
const filesRow = () => rowsLabelled(FILES_LABEL)[0];

/**
 * A row's paragraph column.
 *
 * @param {MarkupElement | undefined} row
 */
const manOf = (row) => said(every(inside(row), "div", "man")[0]);

/** The search box. */
const searchBox = () => every(inside(autoRow()), "input", "peqq")[0];

/** The hits listed. */
const hits = () => every(drawn(), "div", "peqhit");

/**
 * The fixture model a listed hit names.
 *
 * @param {MarkupElement} hit
 */
const modelOf = (hit) => PROFILES.find((p) => said(hit).includes(p.model))?.model ?? "no-such-model";

/** The picked hit's strips drawn. */
const strips = () => every(drawn(), "div", "peqsel");

/**
 * The buttons inside `e`, as a reader reads them.
 *
 * @param {MarkupElement | undefined} e
 */
const buttonTexts = (e) => every(inside(e), "button").map(said);

/** What the pair holds and its plot. */
const out = () => every(drawn(), "div", "pbeqout")[0];

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

/** Every vnode of one render. */
const seen = () => renderTree(tree()).seen;

/**
 * Fire one handler of a vnode, if it carries it.
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
 * Type `value` into the search.
 *
 * @param {string} value
 */
const typeQuery = (value) => {
  const box = seen().find((v) => isV(v, "input", "peqq"));
  const target = { value };
  return fire(box, "onInput", { target, currentTarget: target });
};

/** Listen on headphones, let the library arrive, and start from an empty search. */
async function headphones() {
  setListen("headphones");
  render(tree());
  await quiesce(w);
  await typeQuery("");
}

/** Listen on headphones and search for the query. */
async function searching() {
  await headphones();
  await typeQuery(QUERY);
}

/** Search, then tap the picked hit. */
async function picking() {
  await searching();
  const hit = seen().filter((v) => isV(v, "div", "peqhit"))[PICK];
  await fire(descend(hit).find((v) => isV(v, "button", "peqpick")));
}

/**
 * Tap the picked hit's strip button reading `label`.
 *
 * @param {string} label
 */
async function tapStrip(label) {
  const strip = seen().find((v) => isV(v, "div", "peqsel"));
  await fire(descend(strip).find((v) => v.type === "button" && textOf(v) === label));
}

/** The picked hit's entry in the fixture, by ranked position. */
const picked = () => {
  const model = rankProfiles(PROFILES, QUERY, SHOWN).hits[PICK]?.model;
  return ENTRIES.find((e) => e.model === model);
};

// --- Headphone Auto EQ -------------------------------------------------------------------------------------------

test("test_listening_on_speakers_draws_no_headphone_auto_eq_row", () => {
  assert.equal(rowsLabelled(AEQ_COPY.title).length, 0);
});

test("test_listening_on_headphones_draws_one_headphone_auto_eq_row", async () => {
  await headphones();
  assert.equal(rowsLabelled(AEQ_COPY.title).length, 1);
});

test("test_the_auto_eq_search_box_is_a_search_input", async () => {
  await headphones();
  assert.equal(attrOf(searchBox(), "type"), "search");
});

test("test_the_auto_eq_search_box_carries_the_search_placeholder", async () => {
  await headphones();
  assert.equal(attrOf(searchBox(), "placeholder"), AUTOEQ_COPY.placeholder);
});

test("test_the_auto_eq_credit_line_opens_with_the_credit", async () => {
  await headphones();
  assert.equal(said(every(inside(autoRow()), "div", "aeqcred")[0]).startsWith(AEQ_COPY.credit), true);
});

test("test_the_auto_eq_row_explains_the_parametric_eq_file", async () => {
  await headphones();
  assert.equal(manOf(autoRow()), EQ_MAN.peqFile);
});

test("test_typing_a_query_lists_the_ranked_hits_in_rank_order", async () => {
  await searching();
  assert.deepEqual(
    hits().map(modelOf),
    rankProfiles(PROFILES, QUERY, SHOWN).hits.map((p) => p.model),
  );
});

test("test_typing_a_query_says_how_many_matches_were_cut", async () => {
  await searching();
  assert.equal(said(every(drawn(), "div", "peqmore")[0]), AEQ_COPY.more(PROFILES.length - SHOWN));
});

test("test_tapping_a_hit_marks_it_picked", async () => {
  await picking();
  assert.deepEqual(
    hits().map((h) => classes(h).includes("on")),
    [false, true, false],
  );
});

test("test_a_picked_hit_shows_its_band_count_and_preamp", async () => {
  await picking();
  const e = picked();
  const cap = every(inside(strips()[0]), "span", "cap")[0];
  assert.equal(said(cap), AEQ_COPY.bands(e?.lines.length ?? -1, e?.pre ?? null));
});

test("test_tapping_clear_drops_the_picked_hits_strip", async () => {
  await picking();
  await tapStrip(AEQ_COPY.clear);
  assert.equal(strips().length, 0);
});

test("test_tapping_load_lands_the_picked_hits_bands_on_the_stereo_pair", async () => {
  await picking();
  await tapStrip(AEQ_COPY.load);
  const first = /** @type {PipelineRow | undefined} */ (effectivePipelines.value[0]);
  const peaks = parseProcess(String(first?.process ?? "")).filter((s) => s.args?.type === "peak").length;
  assert.equal(peaks, picked()?.lines.length);
});

test("test_tapping_load_empties_the_search", async () => {
  await picking();
  await tapStrip(AEQ_COPY.load);
  const value = attrOf(searchBox(), "value") ?? "";
  assert.equal(value, "");
});

// --- correction files --------------------------------------------------------------------------------------------

test("test_the_correction_files_row_is_drawn_once", () => {
  assert.equal(rowsLabelled(FILES_LABEL).length, 1);
});

test("test_the_correction_files_row_explains_convolution_filters", () => {
  assert.equal(manOf(filesRow()), EQ_MAN.conv);
});

test("test_the_correction_files_row_offers_the_text_file_button", () => {
  assert.equal(buttonTexts(filesRow()).includes(AEQ_COPY.file), true);
});

test("test_the_correction_files_row_offers_the_convolution_upload_button", () => {
  assert.equal(buttonTexts(filesRow()).includes(AEQ_COPY.conv), true);
});

test("test_the_correction_files_row_holds_hidden_text_and_wav_file_inputs", () => {
  const files = every(inside(filesRow()), "input").filter((e) => attr(e, "type") === "file" && hasAttr(e, "hidden"));
  assert.deepEqual(files.map((e) => attrOf(e, "accept")).sort(), [".txt", ".wav"]);
});

test("test_the_mirror_box_is_ticked_by_default", () => {
  const label = every(inside(filesRow()), "label").find((e) => said(e) === AUTOEQ_COPY.mirror);
  const box = every(inside(label), "input").find((e) => attr(e, "type") === "checkbox");
  assert.equal(box ? hasAttr(box, "checked") : null, true);
});

// --- what the pair holds -----------------------------------------------------------------------------------------

test("test_the_holds_line_reads_the_eq_steps_answer", async () => {
  await stagePipelines(STEREO("0", PEAKS));
  await quiesce(w);
  const hold = every(inside(out()), "div", "peqhold")[0];
  assert.equal(said(every(inside(hold), "b")[0]), answerOf("eq"));
});

test("test_the_pairs_response_plot_carries_its_accessible_name", () => {
  const plot = every(inside(out()), "div", "peqplot")[0];
  const named = [...(plot ? [plot] : []), ...inside(plot)].filter((e) => attrOf(e, "aria-label") === PLOT_ARIA);
  assert.equal(named.length, 1);
});
