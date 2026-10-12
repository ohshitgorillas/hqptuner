// Rendered suite for hqptuner/static/components/faceplate/page/FilterPresets.js: the Filter presets popover and the
// button that opens it. What each row says is store/faceplate/page/presets.js's, pinned in
// tests/js/store/faceplate-page/presets.test.js; this suite pins what the popover draws of those rows and what its
// buttons do: a row per top-level preset, the lit one marked, a fold line per flagship or that flagship's nested rows
// once it is open, and the open and fold buttons wired to the store.
//
// Driven at the wire like the Easy Mode suites (tests/js/support/easy/easytiles.js `resetLive`); a press is fired
// through the onClick its vnode carries, collected by preact's own `options.vnode` hook
// (tests/js/support/vnodeseam.js).
//
// Not reachable here: the panel's parking left of its button, which runs in a layout effect.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/presets.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { useStorage } from "../../support/storage.js";

useStorage();

const { resetLive, running } = await import("../../support/easy/easytiles.js");
const { enums } = await import("../../../../hqptuner/static/store/signals.js");
const { renderTree } = await import("../../support/vnodeseam.js");
const { propsOf } = await import("../../support/wheel.js");
const { elements, classes, attr, hasAttr } = await import("../../support/markup.js");
const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { presetsFor } = await import("../../../../hqptuner/static/store/easy/easy.js");
const { knobsOffered } = await import("../../../../hqptuner/static/store/easy/easyoffer.js");
const { openPopover, openList } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { presetRows, showSubsets, foldSubsets } =
  await import("../../../../hqptuner/static/store/faceplate/page/presets.js");
const { FilterPresets, FilterPresetsButton, FILTER_PRESETS } =
  await import("../../../../hqptuner/static/components/faceplate/page/FilterPresets.js");
const { OptionList } = await import("../../../../hqptuner/static/components/faceplate/lists/OptionList.js");
const { flushNarrowing } = await import("../../../../hqptuner/static/store/narrow/persist.js");
const { loadLists, resetLists } = await import("../../support/listsfixture.js");

/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/store/easy/easy.js").Preset} Preset */
/** @typedef {import("../../../../hqptuner/static/store/easy/easy.js").Knob} Knob */

/** @type {Preset[]} */
const PRESETS = presetsFor();
const IDS = new Set(PRESETS.map((p) => p.id));

/** @param {Preset} preset */
const versionKnob = (preset) => preset.knobs.find((k) => k.options.every((o) => IDS.has(o) && o !== preset.id));

const SUBSETS = PRESETS.filter((p) => versionKnob(p) !== undefined);
const FLAGSHIPS = [...new Set(SUBSETS.flatMap((p) => /** @type {Knob} */ (versionKnob(p)).options))];
const TOP = PRESETS.filter((p) => versionKnob(p) === undefined);
const NESTED = FLAGSHIPS.flatMap((under) =>
  SUBSETS.map((sub) => ({ under, sub, vk: String(/** @type {Knob} */ (versionKnob(sub)).id) })),
);

/** @param {Preset} p */
const resting = (p) => Object.fromEntries(p.knobs.map((k) => [k.id, k.default]));

/** @param {Parameters<typeof resetLive>[0]} [seams] */
async function live(seams = {}) {
  const w = await resetLive(seams);
  foldSubsets();
  openPopover.value = FILTER_PRESETS;
  return w;
}

/** One render of the button and the popover, with every vnode built along the way. */
const drawn = () => renderTree(html`<${FilterPresetsButton} /><${FilterPresets} />`);

/** @param {MarkupElement} el @param {string} cls */
const is = (el, cls) => classes(el).includes(cls);

/** The panel: the `div` carrying the popover's `data-pop`. @param {string} out */
const panel = (out) => elements(out).find((e) => e.name === "div" && attr(e, "data-pop") === FILTER_PRESETS);

/** The trigger: the `button` carrying it. @param {string} out */
const trigger = (out) => elements(out).find((e) => e.name === "button" && attr(e, "data-pop") === FILTER_PRESETS);

/** Whether an element carries `hidden`, undefined for no element. @param {MarkupElement | undefined} el */
const hiddenOf = (el) => (el ? hasAttr(el, "hidden") : undefined);

/** The top-level rows, in the order drawn. @param {string} out */
const topRows = (out) => elements(out).filter((e) => is(e, "frow") && !is(e, "sub"));

/** The nested rows, in the order drawn. @param {string} out */
const subRows = (out) => elements(out).filter((e) => is(e, "frow") && is(e, "sub"));

/** @param {string} out */
const foldLines = (out) => elements(out).filter((e) => e.name === "button" && is(e, "fsubs"));

/**
 * One row's own markup, keyed `under>id` for a nested row and by id alone for a top-level one.
 *
 * @param {string} out
 * @returns {Record<string, MarkupElement>}
 */
const rowsByKey = (out) =>
  Object.fromEntries([
    ...topRows(out).map((e) => [String(attr(e, "data-preset")), e]),
    ...subRows(out).map((e) => [`${attr(e, "data-lane")}>${attr(e, "data-preset")}`, e]),
  ]);

/** @param {VNode} v @param {string} cls */
const hasClass = (v, cls) =>
  String(propsOf(v).class || "")
    .split(/\s+/)
    .includes(cls);

/**
 * The apodizing mark inside an element: the first element under it carrying the mark's state, `data-kind`.
 *
 * @param {MarkupElement} el
 */
const markIn = (el) => elements(el.html).find((x) => x.start > 0 && hasAttr(x, "data-kind"));

/** The state a mark carries, undefined for no mark. @param {MarkupElement | undefined} mark */
const kindOf = (mark) => (mark ? attr(mark, "data-kind") : undefined);

/** Fire a vnode's onClick, when it has one. @param {VNode | undefined} v */
function fire(v) {
  const fn = v ? propsOf(v).onClick : undefined;
  if (typeof fn === "function") fn({ preventDefault() {}, stopPropagation() {} });
}

// ============================================================================
// the panel and its button
// ============================================================================

test("test_the_panel_is_hidden_while_its_popover_is_closed", async () => {
  await live();
  openPopover.value = null;
  assert.equal(hiddenOf(panel(drawn().out)), true);
});

test("test_the_panel_shows_while_its_popover_is_open", async () => {
  await live();
  assert.equal(hiddenOf(panel(drawn().out)), false);
});

test("test_the_button_reads_expanded_while_its_popover_is_open", async () => {
  await live();
  const t = trigger(drawn().out);
  assert.equal(t ? attr(t, "aria-expanded") : undefined, "true");
});

test("test_pressing_the_button_opens_the_popover", async () => {
  await live();
  openPopover.value = null;
  fire(drawn().seen.find((v) => v.type === "button" && propsOf(v)["data-pop"] === FILTER_PRESETS));
  assert.equal(openPopover.value, FILTER_PRESETS);
});

// ============================================================================
// the rows drawn
// ============================================================================

test("test_the_panel_draws_one_row_per_top_level_preset_in_table_order", async () => {
  await live();
  assert.deepEqual(
    topRows(drawn().out).map((e) => attr(e, "data-preset")),
    TOP.map((p) => p.id),
  );
});

test("test_every_folded_flagship_draws_one_fold_line", async () => {
  await live();
  assert.deepEqual(
    foldLines(drawn().out).map((e) => attr(e, "data-lane")),
    FLAGSHIPS,
  );
});

for (const under of FLAGSHIPS) {
  test(`test_an_open_${under}_draws_its_subsets_as_nested_rows_under_it`, async () => {
    await live();
    showSubsets(under);
    assert.deepEqual(
      subRows(drawn().out).map((e) => `${attr(e, "data-lane")}>${attr(e, "data-preset")}`),
      SUBSETS.map((s) => `${under}>${s.id}`),
    );
  });

  test(`test_an_open_${under}_draws_no_fold_line_of_its_own`, async () => {
    await live();
    showSubsets(under);
    assert.deepEqual(
      foldLines(drawn().out).map((e) => attr(e, "data-lane")),
      FLAGSHIPS.filter((f) => f !== under),
    );
  });

  test(`test_pressing_the_${under}_fold_line_opens_${under}`, async () => {
    await live();
    fire(drawn().seen.find((v) => v.type === "button" && hasClass(v, "fsubs") && propsOf(v)["data-lane"] === under));
    assert.equal(presetRows().find((r) => r.id === under)?.open, true);
  });

  test(`test_pressing_the_fold_button_in_${under}s_nested_rows_folds_${under}`, async () => {
    await live();
    showSubsets(under);
    fire(drawn().seen.find((v) => v.type === "button" && hasClass(v, "fsubx")));
    assert.equal(presetRows().find((r) => r.id === under)?.open, false);
  });
}

for (const p of TOP) {
  test(`test_running_${p.id}_marks_its_row_lit_and_no_other`, async () => {
    await live({ ...running(p.id, resting(p)) });
    assert.deepEqual(
      Object.fromEntries(topRows(drawn().out).map((e) => [attr(e, "data-preset"), is(e, "cur")])),
      Object.fromEntries(TOP.map((t) => [t.id, t.id === p.id])),
    );
  });
}

for (const { under, sub, vk } of NESTED) {
  test(`test_running_${sub.id}_in_its_${under}_version_lights_its_name_on_the_folded_${under}_line`, async () => {
    await live({ ...running(sub.id, { ...resting(sub), [vk]: under }) });
    const line = foldLines(drawn().out).find((e) => attr(e, "data-lane") === under);
    const lit = line
      ? elements(line.html)
          .filter((x) => is(x, "cur"))
          .map((x) => attr(x, "data-preset"))
      : [];
    assert.deepEqual(lit, [sub.id]);
  });
}

test("test_each_row_draws_as_many_pips_as_the_store_counts", async () => {
  await live();
  const under = FLAGSHIPS[0];
  showSubsets(under);
  const rows = rowsByKey(drawn().out);
  const store = presetRows();
  const want = Object.fromEntries([
    ...TOP.map((p) => [p.id, store.find((r) => r.id === p.id)?.pips]),
    ...SUBSETS.map((s) => [
      `${under}>${s.id}`,
      store.find((r) => r.id === under)?.subs.find((x) => x.id === s.id)?.pips,
    ]),
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(rows).map(([key, e]) => [key, elements(e.html).filter((x) => is(x, "pip")).length]),
    ),
    want,
  );
});

// Every enumerated filter re-served half-apodizing: `arg` bit 1 set, bit 0 (and the `apodizing` flag from it) clear.
test("test_each_row_draws_the_half_mark_the_engine_states_for_its_filters", async () => {
  await live();
  const served = /** @type {Record<string, any>} */ (enums.value);
  enums.value = /** @type {never} */ ({
    ...served,
    filters: served.filters.map((/** @type {object} */ f) => Object.assign({}, f, { arg: "2", apodizing: false })),
  });
  assert.deepEqual(
    Object.fromEntries(topRows(drawn().out).map((e) => [attr(e, "data-preset"), kindOf(markIn(e))])),
    Object.fromEntries(TOP.map((p) => [p.id, "half"])),
  );
});

// The filter lists' own wire (tests/js/support/listsfixture.js) serves one filter in each apodizing state; each state
// below pairs its enumeration flags (`arg` bit 0 apodizing, bit 1 half-apodizing, and the `apodizing` flag from bit 0)
// with the fixture filter the lists draw in that state.
/** @type {Record<string, { arg: string, apodizing: boolean, listed: string }>} */
const APOD_STATES = {
  full: { arg: "1", apodizing: true, listed: "poly-sinc-gauss-long" },
  half: { arg: "2", apodizing: false, listed: "sinc-M" },
};

/** What the filter lists open over the body for a 1x filter pick. */
const LIST_KEY = "sdm_filter_1x";

/** Stands in for the list's mark when the list draws none, so an absent mark on both sides never reads as the same. */
const NO_LIST_MARK = "the filter list draws no mark";

/**
 * What a mark draws: its state and the drawing inside it, its own styling attributes left out.
 *
 * @param {MarkupElement | undefined} mark
 */
const drawingOf = (mark) =>
  mark ? { kind: kindOf(mark), inside: mark.html.slice(`<${mark.name}${mark.attrs}>`.length) } : undefined;

/**
 * The mark a filter list's row draws for the fixture filter `name`.
 *
 * @param {string} name
 */
async function listMark(name) {
  const before = openList.value;
  resetLists();
  loadLists();
  openList.value = { key: LIST_KEY, stage: "1x", value: name, pick: () => undefined };
  const row = elements(render(html`<${OptionList} />`)).find(
    (e) => attr(e, "role") === "option" && attr(e, "data-v") === name,
  );
  const mark = row ? markIn(row) : undefined;
  resetLists();
  await flushNarrowing();
  openList.value = before;
  return mark;
}

/**
 * Re-serve every enumerated filter with the given apodizing flags.
 *
 * @param {{ arg: string, apodizing: boolean }} flags
 */
function serveAll({ arg, apodizing }) {
  const served = /** @type {Record<string, any>} */ (enums.value);
  enums.value = /** @type {never} */ ({
    ...served,
    filters: served.filters.map((/** @type {object} */ f) => ({ ...f, arg, apodizing })),
  });
}

for (const [state, flags] of Object.entries(APOD_STATES)) {
  test(`test_each_preset_row_draws_the_mark_the_filter_lists_draw_for_${state}_apodizing`, async () => {
    const want = drawingOf(await listMark(flags.listed)) ?? NO_LIST_MARK;
    await live();
    serveAll(flags);
    assert.deepEqual(
      Object.fromEntries(topRows(drawn().out).map((e) => [attr(e, "data-preset"), drawingOf(markIn(e))])),
      Object.fromEntries(TOP.map((p) => [p.id, want])),
    );
  });
}

/** The enumeration flags of a filter with no apodizing: `arg` bits 0 and 1 clear, so the `apodizing` flag is clear. */
const NO_APODIZING = { arg: "0", apodizing: false };

test("test_each_row_draws_the_no_correction_mark_when_the_engine_serves_its_filters_unapodized", async () => {
  await live();
  serveAll(NO_APODIZING);
  assert.deepEqual(
    Object.fromEntries(topRows(drawn().out).map((e) => [attr(e, "data-preset"), kindOf(markIn(e))])),
    Object.fromEntries(TOP.map((p) => [p.id, "none"])),
  );
});

test("test_only_the_rows_of_hi_res_presets_wear_the_hi_res_badge", async () => {
  await live();
  assert.deepEqual(
    Object.fromEntries(
      topRows(drawn().out).map((e) => [attr(e, "data-preset"), elements(e.html).some((x) => is(x, "hires"))]),
    ),
    Object.fromEntries(TOP.map((p) => [p.id, !!p.hires])),
  );
});

// ============================================================================
// the columns
// ============================================================================

// A column is named by `data-col` on its head and on each row's cell in it. A control or mark belongs to the column of
// the innermost `data-col` element enclosing it. Column names are this suite's contract, not the words the heads show.

const COLUMNS = ["preset", "filter", "emphasis", "correction", "resources"];
const EMPHASIS_COLUMN = "emphasis";
const CORRECTION_COLUMN = "correction";

/** The knob ids of the Space / Transients choice and of the error-correction on / off choice: wire identifiers. */
const EMPHASIS_KNOB = "emphasis";
const ON_OFF_KNOB = "correction";

/** Stands in for a column when the row draws no such element, so a missing control never reads as a column. */
const NOT_DRAWN = "the row draws no such element";

/**
 * Whether `inner` lies within `outer`, both scanned from the same fragment.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const inside = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/**
 * The column holding the first element of a row that `pick` selects.
 *
 * @param {MarkupElement | undefined} row
 * @param {(el: MarkupElement) => boolean} pick
 */
function columnOf(row, pick) {
  const all = row ? elements(row.html) : [];
  const target = all.find((e) => e.start > 0 && pick(e));
  if (!target) return NOT_DRAWN;
  const cells = all.filter((e) => hasAttr(e, "data-col") && inside(target, e)).sort((a, b) => b.start - a.start);
  return cells.length > 0 ? attr(cells[0], "data-col") : undefined;
}

/** @param {string} knob */
const knobSeg = (knob) => (/** @type {MarkupElement} */ el) => attr(el, "data-knob") === knob;

/** @param {MarkupElement} el */
const apodMark = (el) => hasAttr(el, "data-kind");

/**
 * The column heads, in the order drawn: the panel's `data-col` elements outside every row and fold line.
 *
 * @param {string} out
 */
function heads(out) {
  const p = panel(out);
  const all = p ? elements(p.html) : [];
  const rows = all.filter((e) => is(e, "frow") || (e.name === "button" && is(e, "fsubs")));
  return all
    .filter((e) => hasAttr(e, "data-col") && !rows.some((r) => inside(e, r)))
    .sort((a, b) => a.start - b.start)
    .map((e) => attr(e, "data-col"));
}

/**
 * Whether a nested row offers the error-correction on / off choice in its flagship's version.
 *
 * @param {{ under: string, sub: Preset, vk: string }} nested
 */
const offersOnOff = ({ under, sub, vk }) =>
  knobsOffered(sub, { ...resting(sub), [vk]: under }, "pcm").some((k) => !k.inert && k.id === ON_OFF_KNOB);

const EMPHASIS_ROWS = TOP.filter((p) =>
  knobsOffered(p, resting(p), "pcm").some((k) => !k.inert && k.id === EMPHASIS_KNOB),
);
const ON_OFF_NESTED = NESTED.filter(offersOnOff);
const MARKED_NESTED = NESTED.filter((n) => !offersOnOff(n));

test("test_the_popover_heads_the_preset_filter_emphasis_correction_and_resources_columns_and_no_other", async () => {
  await live();
  assert.deepEqual(heads(drawn().out).sort(), [...COLUMNS].sort());
});

for (const p of EMPHASIS_ROWS) {
  test(`test_the_${p.id}_row_offers_its_emphasis_choice_in_the_emphasis_column`, async () => {
    await live();
    assert.equal(columnOf(rowsByKey(drawn().out)[p.id], knobSeg(EMPHASIS_KNOB)), EMPHASIS_COLUMN);
  });
}

for (const { under, sub } of MARKED_NESTED) {
  test(`test_${sub.id}_nested_under_${under}_with_no_correction_switch_draws_its_mark_in_the_correction_column`, async () => {
    await live();
    showSubsets(under);
    assert.equal(columnOf(rowsByKey(drawn().out)[`${under}>${sub.id}`], apodMark), CORRECTION_COLUMN);
  });
}

for (const { under, sub } of ON_OFF_NESTED) {
  test(`test_${sub.id}_nested_under_${under}_offers_its_correction_switch_in_the_correction_column`, async () => {
    await live();
    showSubsets(under);
    assert.equal(columnOf(rowsByKey(drawn().out)[`${under}>${sub.id}`], knobSeg(ON_OFF_KNOB)), CORRECTION_COLUMN);
  });

  test(`test_${sub.id}_nested_under_${under}_draws_no_apodizing_mark_where_its_correction_switch_stands`, async () => {
    await live();
    showSubsets(under);
    const row = rowsByKey(drawn().out)[`${under}>${sub.id}`];
    assert.equal(row ? elements(row.html).filter((e) => e.start > 0 && apodMark(e)).length : NOT_DRAWN, 0);
  });
}
