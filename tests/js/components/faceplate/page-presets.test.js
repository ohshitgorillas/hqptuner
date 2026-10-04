// Rendered suite for hqptuner/static/components/faceplate/page/FilterPresets.js: the Filter presets popover and the
// button that opens it. What each row says is store/faceplate/page/presets.js's, pinned in
// tests/js/store/faceplate/page-presets.test.js; this suite pins what the popover draws of those rows and what its
// buttons do: a row per top-level preset, the lit one marked, a fold line per flagship or that flagship's nested rows
// once it is open, and the pick, knob and fold buttons wired to the store.
//
// Driven at the wire like the Easy Mode suites (tests/js/support/easy/easytiles.js `resetLive`); a press is fired
// through the onClick its vnode carries, collected by preact's own `options.vnode` hook
// (tests/js/support/vnodeseam.js), and leaves over a faked `POST /api/config/live`.
//
// Not reachable here: the panel's parking left of its button, which runs in a layout effect.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/page-presets.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

useStorage();

const { resetLive, running, flush, postedFields, liveExpected } = await import("../../support/easy/easytiles.js");
const { enums } = await import("../../../../hqptuner/static/store/signals.js");
const { renderTree } = await import("../../support/vnodeseam.js");
const { propsOf } = await import("../../support/wheel.js");
const { elements, classes, attr, hasAttr } = await import("../../support/markup.js");
const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { presetsFor } = await import("../../../../hqptuner/static/store/easy/easy.js");
const { knobsOffered } = await import("../../../../hqptuner/static/store/easy/easyoffer.js");
const { setEasyMaterial } = await import("../../../../hqptuner/static/store/easy/easyview.js");
const { openPopover } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { presetRows, showSubsets, foldSubsets } =
  await import("../../../../hqptuner/static/store/faceplate/page/presets.js");
const { FilterPresets, FilterPresetsButton, FILTER_PRESETS } =
  await import("../../../../hqptuner/static/components/faceplate/page/FilterPresets.js");

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

/**
 * Every vnode of a subtree, the node itself included.
 *
 * @param {unknown} node
 * @returns {VNode[]}
 */
function within(node) {
  if (node === false || node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(within);
  const v = /** @type {VNode} */ (node);
  return [v, ...(v.props ? within(v.props.children) : [])];
}

/** @param {VNode} v @param {string} cls */
const hasClass = (v, cls) =>
  String(propsOf(v).class || "")
    .split(/\s+/)
    .includes(cls);

/**
 * The row vnode for a preset, nested under `under` or top-level when `under` is undefined.
 *
 * @param {VNode[]} seen
 * @param {string} id
 * @param {string} [under]
 */
const rowNode = (seen, id, under) =>
  seen.find(
    (v) =>
      v.type === "div" &&
      hasClass(v, "frow") &&
      propsOf(v)["data-preset"] === id &&
      (propsOf(v)["data-lane"] ?? undefined) === under,
  );

/** Fire a vnode's onClick, when it has one. @param {VNode | undefined} v */
function fire(v) {
  const fn = v ? propsOf(v).onClick : undefined;
  if (typeof fn === "function") fn({ preventDefault() {}, stopPropagation() {} });
}

/** @param {VNode | undefined} row */
const pickOf = (row) =>
  within(row ? propsOf(row).children : []).find((v) => v.type === "button" && hasClass(v, "pick"));

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

  test(`test_running_${p.id}_lights_its_rows_lamp_and_no_other`, async () => {
    await live({ ...running(p.id, resting(p)) });
    const lamps = Object.fromEntries(
      topRows(drawn().out).map((e) => [
        attr(e, "data-preset"),
        elements(e.html).some((x) => is(x, "lamp") && is(x, "on")),
      ]),
    );
    assert.deepEqual(lamps, Object.fromEntries(TOP.map((t) => [t.id, t.id === p.id])));
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
    Object.fromEntries(
      topRows(drawn().out).map((e) => [
        attr(e, "data-preset"),
        attr(elements(e.html).find((x) => x.name === "svg" && is(x, "apod")) || e, "data-mark"),
      ]),
    ),
    Object.fromEntries(TOP.map((p) => [p.id, "half"])),
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

test("test_a_grayed_rows_pick_is_disabled_and_no_other", async () => {
  await live();
  const card = PRESETS.flatMap((p) => p.knobs).find((k) => k.card);
  setEasyMaterial(String(card?.options.find((o) => o !== card.default)));
  const picks = Object.fromEntries(
    topRows(drawn().out).map((e) => {
      const pick = elements(e.html).find((x) => x.name === "button" && is(x, "pick"));
      return [attr(e, "data-preset"), !!pick && hasAttr(pick, "disabled")];
    }),
  );
  const store = presetRows();
  assert.deepEqual(picks, Object.fromEntries(TOP.map((p) => [p.id, store.find((r) => r.id === p.id)?.grayed])));
});

// ============================================================================
// presses write through the store
// ============================================================================

for (const p of TOP) {
  test(`test_pressing_the_${p.id}_row_posts_its_resting_filters`, async () => {
    const w = await live();
    fire(pickOf(rowNode(drawn().seen, p.id)));
    await flush(w);
    assert.deepEqual(postedFields(w), liveExpected(p.id, resting(p)));
  });
}

for (const { under, sub, vk } of NESTED) {
  test(`test_pressing_${sub.id}_nested_under_${under}_posts_its_${under}_version`, async () => {
    const w = await live();
    showSubsets(under);
    fire(pickOf(rowNode(drawn().seen, sub.id, under)));
    await flush(w);
    assert.deepEqual(postedFields(w), liveExpected(sub.id, { ...resting(sub), [vk]: under }));
  });
}

const MOVED = TOP.flatMap((p) =>
  knobsOffered(p, resting(p), "pcm")
    .filter((k) => !k.inert)
    .flatMap((k) => k.options.filter((o) => o !== k.default).map((o) => ({ p, knob: k.id, at: o }))),
);

for (const { p, knob, at } of MOVED) {
  test(`test_moving_the_${p.id}_rows_${knob}_to_${at}_posts_the_filters_that_position_writes`, async () => {
    const w = await live();
    const row = rowNode(drawn().seen, p.id);
    const seg = within(row ? propsOf(row).children : []).find((v) => propsOf(v)["data-knob"] === knob);
    fire(within(seg ? propsOf(seg).children : []).find((v) => v.type === "button" && propsOf(v)["data-v"] === at));
    await flush(w);
    assert.deepEqual(postedFields(w), liveExpected(p.id, { ...resting(p), [knob]: at }));
  });
}
