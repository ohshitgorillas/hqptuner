// Rendered suite for hqptuner/static/components/faceplate/Page.js: the faceplate's page, one section per engaged stage
// as model/shell/page.js decides it, fed from the running path, the running matrix engine and the browser's own Top of
// page and Allow pinned rates preferences; a section's header and body; and a section's fields, one open and every
// other folded to a line that opens it.
//
// The wire is the seam for the page: each case writes the engine's state and Status frame into `engineState` and
// `engineStatus`, the daemon's /config and /matrix form fields into `config` and `matrixConfig`, and the preferences
// into `topOfPage` and `allowPinnedRates`. Sections are told apart by `data-stage`, the rail's stage id; their titles
// are copy and named nowhere here. Section and Fields are rendered with the test's own titles, names and bodies.
//
// Tapping a folded field is reached through preact's own vnode creation hook (tests/js/support/vnodeseam.js), since
// server rendering fires no events.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/page.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Page, Section } from "../../../../hqptuner/static/components/faceplate/Page.js";
import { Fields } from "../../../../hqptuner/static/components/faceplate/page/Fields.js";
import {
  config,
  matrixConfig,
  engineState,
  engineStatus,
  enums,
  staged,
  liveOverride,
} from "../../../../hqptuner/static/store/signals.js";
import { topOfPage, allowPinnedRates } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, classes, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */

const CD = "44100";
const PCM_8X = "352800";
const DSD64 = "2822400";
const DSD256 = "11289600";

//: The engine's PCM rate list, 1x to 32x of both families, as /api/enumerations serves it with index 0 for auto.
const PCM_RATES = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000];
const RATES = [{ index: "0", rate: "0" }, ...PCM_RATES.map((r, n) => ({ index: String(n + 1), rate: String(r) }))];

/**
 * @typedef {object} Running
 * @property {string} [source]    the source's sample rate, Hz
 * @property {string} [output]    the output's rate, Hz
 * @property {boolean} [direct]   Direct SDM as the daemon runs it
 * @property {boolean} [matrix]   the matrix engine as the daemon runs it
 * @property {string} [top]       Top of page
 * @property {boolean} [pins]     Allow pinned rates
 * @property {{ w: number, h: number }} [win]  the window the plate is fitted to
 */

/**
 * Write one running state onto the wire-side signals and the preferences: by default a PCM source playing to a PCM
 * rate, the matrix engine engaged, Top of page on Auto and pinned rates off.
 *
 * @param {Running} r
 */
function run({
  source = CD,
  output = PCM_8X,
  direct = false,
  matrix = true,
  top = "auto",
  pins = false,
  win = { w: 1080, h: 810 },
}) {
  viewport.value = win;
  engineState.value = { state: "2", mode: "1", active_chain: "pcm", rate: "0" };
  enums.value = { rates: RATES };
  engineStatus.value = { status: { active_rate: output }, metadata: { samplerate: source } };
  config.value = { fields: [{ name: "direct_sdm", value: direct }] };
  matrixConfig.value = { fields: [{ name: "enabled", value: matrix }] };
  staged.value = { live: {}, http: {} };
  liveOverride.value = {};
  topOfPage.value = top;
  allowPinnedRates.value = pins;
}

beforeEach(() => run({}));

/** Every element of the rendered page, in document order. */
const pageEls = () => elements(render(html`<${Page} />`)).sort((a, b) => a.start - b.start);

/** The rendered page's sections. */
const sectionEls = () => pageEls().filter((e) => e.name === "section");

/** The stage ids of the page's sections, in page order. */
const stages = () => sectionEls().map((e) => attr(e, "data-stage"));

/**
 * The stage ids of the sections carrying a class.
 *
 * @param {string} cls
 */
const stagesWith = (cls) =>
  sectionEls()
    .filter((e) => classes(e).includes(cls))
    .map((e) => attr(e, "data-stage"));

/**
 * How many section bodies one section holds, or a string naming the stage when the page has no such section, so a
 * missing section never reads as an empty one.
 *
 * @param {string} stage
 * @returns {number | string}
 */
function bodiesIn(stage) {
  const sec = sectionEls().find((e) => attr(e, "data-stage") === stage);
  if (!sec) return `no ${stage} section`;
  return elements(sec.html).filter((e) => classes(e).includes("two")).length;
}

// --- the page --------------------------------------------------------------------

test("test_the_page_shows_a_section_per_engaged_stage", () => {
  assert.deepEqual(stages(), ["source", "matrix", "resampling", "shaping"]);
});

test("test_a_running_direct_sdm_takes_resampling_and_shaping_off_the_page", () => {
  run({ source: DSD64, output: DSD256, direct: true });
  assert.deepEqual(stages(), ["source", "matrix"]);
});

/**
 * The rate pins anywhere on the rendered page: each exact-rate pin as its tier and family, Auto by its test id.
 *
 * @returns {(string | undefined)[][]}
 */
const ratePins = () =>
  pageEls()
    .filter((e) => attr(e, "data-fam") !== undefined || attr(e, "data-testid") === "pin-auto")
    .map((e) => [attr(e, "data-i"), attr(e, "data-fam"), attr(e, "data-testid")]);

test("test_allowing_pinned_rates_puts_no_rate_pin_on_the_page", () => {
  run({ pins: true });
  assert.deepEqual(ratePins(), []);
});

test("test_a_bypassed_matrix_engine_takes_the_matrix_section_off_the_page", () => {
  run({ matrix: false });
  assert.deepEqual(stages(), ["source", "resampling", "shaping"]);
});

test("test_the_matrix_profile_top_takes_the_spectrum_off_the_page", () => {
  run({ top: "profile" });
  assert.deepEqual(stages(), ["matrix", "resampling", "shaping"]);
});

test("test_the_spectrum_takes_the_fill_under_auto", () => {
  assert.deepEqual(stagesWith("fill"), ["source"]);
});

test("test_the_matrix_section_takes_the_fill_at_the_top_of_the_page", () => {
  run({ top: "profile" });
  assert.deepEqual(stagesWith("fill"), ["matrix"]);
});

test("test_auto_marks_the_matrix_section_folded", () => {
  assert.deepEqual(stagesWith("mxfold"), ["matrix"]);
});

test("test_a_folded_matrix_section_has_no_body", () => {
  assert.equal(bodiesIn("matrix"), 0);
});

test("test_an_unfolded_matrix_section_has_its_body", () => {
  run({ top: "profile" });
  assert.equal(bodiesIn("matrix"), 1);
});

/**
 * The classes of the elements inside one section that carry `cls`, or a string naming the stage when the page has no
 * such section.
 *
 * @param {string} stage
 * @param {string} cls
 * @returns {string[][] | string}
 */
function partsOf(stage, cls) {
  const sec = sectionEls().find((e) => attr(e, "data-stage") === stage);
  if (!sec) return `no ${stage} section`;
  return elements(sec.html)
    .filter((e) => classes(e).includes(cls))
    .map(classes);
}

/**
 * Whether one section's header holds an element a predicate picks, or a string naming the stage when the page has no
 * such section.
 *
 * @param {string} stage
 * @param {(e: MarkupElement) => boolean} pick
 * @returns {boolean | string}
 */
function headHolds(stage, pick) {
  const sec = sectionEls().find((e) => attr(e, "data-stage") === stage);
  if (!sec) return `no ${stage} section`;
  const head = elements(sec.html).find((e) => classes(e).includes("sh"));
  return !!head && elements(head.html).some(pick);
}

test("test_the_source_section_is_the_page_meters_home", () => {
  assert.deepEqual(stagesWith("psrc"), ["source"]);
});

test("test_the_source_section_is_slim_on_a_small_plate", () => {
  assert.deepEqual(stagesWith("slim"), ["source"]);
});

test("test_the_source_section_is_full_on_a_13_inch_plate", () => {
  run({ win: { w: 1366, h: 1024 } });
  assert.deepEqual(stagesWith("slim"), []);
});

test("test_the_source_section_holds_the_page_meter_outside_a_two_column_body", () => {
  assert.deepEqual([partsOf("source", "pmeter").length, bodiesIn("source")], [1, 0]);
});

test("test_a_folded_matrix_section_carries_the_profile_select_on_its_header_line", () => {
  assert.equal(
    headHolds("matrix", (e) => e.name === "select"),
    true,
  );
});

test("test_an_unfolded_matrix_section_keeps_the_profile_select_in_its_body", () => {
  run({ top: "profile" });
  assert.equal(
    headHolds("matrix", (e) => e.name === "select"),
    false,
  );
});

test("test_an_unfolded_matrix_section_stretches_its_two_columns", () => {
  run({ top: "profile" });
  assert.deepEqual(partsOf("matrix", "two"), [["two", "stretch"]]);
});

test("test_the_resampling_header_carries_the_filter_presets_trigger", () => {
  assert.equal(
    headHolds("resampling", (e) => attr(e, "data-pop") === "presets"),
    true,
  );
});

test("test_the_shaping_header_carries_no_filter_presets_trigger", () => {
  assert.equal(
    headHolds("shaping", (e) => attr(e, "data-pop") === "presets"),
    false,
  );
});

test("test_the_resampling_body_holds_a_chain_picker", () => {
  assert.equal(partsOf("resampling", "cplate").length, 1);
});

test("test_a_13_inch_plate_opens_both_resampling_filters_in_one_body", () => {
  run({ win: { w: 1366, h: 1024 } });
  assert.deepEqual([partsOf("resampling", "cplate").length, partsOf("resampling", "two")], [2, [["two", "both"]]]);
});

// --- a section ---------------------------------------------------------------------

/**
 * Every element of one rendered section, in document order.
 *
 * @param {boolean} fold
 */
const sectionParts = (fold) =>
  elements(
    render(html`
      <${Section} id="resampling" title="test-title" fold=${fold} head=${html`<i data-testid="head"></i>`}>
        <i data-testid="body"></i>
      <//>
    `),
  ).sort((a, b) => a.start - b.start);

/**
 * The test ids inside the first element carrying a class, or a string naming the class when none does.
 *
 * @param {MarkupElement[]} parts
 * @param {string} cls
 * @returns {(string | undefined)[] | string}
 */
function testidsIn(parts, cls) {
  const host = parts.find((e) => classes(e).includes(cls));
  if (!host) return `no .${cls}`;
  return elements(host.html)
    .filter((e) => attr(e, "data-testid"))
    .map((e) => attr(e, "data-testid"));
}

/**
 * The reading of the first element a predicate picks, or undefined when it picks none.
 *
 * @param {MarkupElement[]} parts
 * @param {(e: MarkupElement) => boolean} pick
 * @param {(e: MarkupElement) => string | undefined} read
 * @returns {string | undefined}
 */
function readFirst(parts, pick, read) {
  const found = parts.find(pick);
  return found ? read(found) : undefined;
}

test("test_a_section_is_named_by_its_title", () => {
  const label = readFirst(
    sectionParts(false),
    (e) => e.name === "section",
    (e) => attr(e, "aria-label"),
  );
  assert.equal(label, "test-title");
});

test("test_a_section_header_reads_its_title", () => {
  assert.equal(
    readFirst(sectionParts(false), (e) => classes(e).includes("t"), text),
    "test-title",
  );
});

test("test_a_section_header_carries_its_head_children", () => {
  assert.deepEqual(testidsIn(sectionParts(false), "sh"), ["head"]);
});

test("test_a_section_body_carries_its_children", () => {
  assert.deepEqual(testidsIn(sectionParts(false), "two"), ["body"]);
});

test("test_a_folded_section_keeps_its_header_and_drops_its_body", () => {
  assert.deepEqual(testidsIn(sectionParts(true), "sec"), ["head"]);
});

test("test_an_unfolded_section_shows_its_header_and_body", () => {
  assert.deepEqual(testidsIn(sectionParts(false), "sec"), ["head", "body"]);
});

// --- a section's fields ----------------------------------------------------------------

const FIELDS = ["a", "b", "c"].map((k) => ({
  id: k,
  name: `name-${k}`,
  why: `why-${k}`,
  value: `value-${k}`,
  body: html`<i data-testid=${`body-${k}`}></i>`,
}));

/**
 * The rendered fields with one open, every element in document order.
 *
 * @param {string} open
 * @param {(id: string) => void} [onOpen]
 */
const fieldParts = (open, onOpen = () => {}) =>
  elements(render(html`<div><${Fields} fields=${FIELDS} open=${open} onOpen=${onOpen} /></div>`)).sort(
    (a, b) => a.start - b.start,
  );

/**
 * The folded lines among rendered fields.
 *
 * @param {MarkupElement[]} parts
 */
const flines = (parts) => parts.filter((e) => e.name === "button" && classes(e).includes("fline"));

test("test_the_open_field_shows_its_body_and_no_other_does", () => {
  assert.deepEqual(
    fieldParts("b")
      .filter((e) => attr(e, "data-testid"))
      .map((e) => attr(e, "data-testid")),
    ["body-b"],
  );
});

test("test_every_other_field_folds_to_a_line_naming_it", () => {
  assert.deepEqual(
    flines(fieldParts("b")).map((e) => readFirst(elements(e.html), (x) => x.name === "b", text)),
    ["name-a", "name-c"],
  );
});

test("test_a_folded_line_reads_the_field_value", () => {
  assert.deepEqual(
    flines(fieldParts("a")).map((e) => readFirst(elements(e.html), (x) => classes(x).includes("fn"), text)),
    ["value-b", "value-c"],
  );
});

test("test_a_folded_line_reads_name_why_and_value", () => {
  assert.deepEqual(flines(fieldParts("c")).map(text), ["name-a why-a value-a", "name-b why-b value-b"]);
});

test("test_tapping_a_folded_line_opens_its_field", () => {
  /** @type {string[]} */
  const opened = [];
  const { seen } = renderTree(
    html`<${Fields} fields=${FIELDS} open="a" onOpen=${(/** @type {string} */ id) => opened.push(id)} />`,
  );
  const line = seen.find(
    (/** @type {VNode} */ v) => v.type === "button" && textOf(v.props.children).includes("name-c"),
  );
  const tap = line?.props.onClick;
  if (typeof tap === "function") tap();
  assert.deepEqual(opened, ["c"]);
});
