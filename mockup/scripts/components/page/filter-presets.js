// Filter presets popover (Resampling header). One row per preset: pick button (lamp, emoji, name, description), filters,
// knobs, correction glyph, resource pips. Parked to the left of its button.
//
// Concert Hall and The Crucible are subsets of the flagships: each flagship carries a fold line
// naming them; expanding it shows both as nested rows under that flagship, in that flagship's version (data LINEAGE: the
// lane is the version), so there is no Version knob. One flagship open at a time, so the two copies never show together.
// A nested pick keeps its flagship open and lights the fold line's name while folded.

import { h, s } from "../../lib/shell/dom.js";
import { popover } from "../../lib/shell/popover.js";
import { parkLeftOf } from "../../lib/shell/plate.js";
import { seg } from "../controls/seg.js";
import { PRESET_COLUMNS, CORRECTION_LABELS, HIRES_TIP, LINEAGE } from "../../data/lists/presets.js";
import { classNames } from "../../../../hqptuner/static/model/shell/format.js";
import { subsetVersion } from "../../model/shell/presets.js";

/** @typedef {import('../../model/shell/presets.js').Cost} Cost */
/** @typedef {{ label: string, title?: string, on?: boolean }} KnobOption */
/** @typedef {{ label: string, title?: string, options: KnobOption[] }} Knob  a per-preset adjustment */

/**
 * A preset as data/presets.js writes it.
 *
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} emoji
 * @property {string} name
 * @property {string} desc
 * @property {boolean} [hires]
 * @property {boolean} [current]    running and selected
 * @property {{ stage?: string, name: string }[]} filters
 * @property {Knob[]} knobs
 * @property {string} correction    full | partial | none
 * @property {Cost} cost
 */

/**
 * One mounted popover's state, shared by the helpers below.
 *
 * @typedef {object} PresetsUi
 * @property {Preset[]} presets
 * @property {Record<string, Preset>} by
 * @property {string[]} subs    the subset presets ('concert-hall', 'crucible')
 * @property {Record<string, string>} corr  Correction per subset preset (v1: one per preset)
 * @property {{ id: string | undefined, lane: string | null }} cur  the pick: preset id + its flagship for a nested row
 * @property {string | null} open  the flagship whose subsets show
 * @property {HTMLElement} rows
 * @property {HTMLElement} panel
 * @property {HTMLElement} trigger
 */

/** @type {Record<string, string>} */
const LABELS = CORRECTION_LABELS;

/**
 * @param {PresetsUi} ui
 * @param {string} id
 * @param {string | null} [lane]
 */
const isCur = (ui, id, lane = null) => ui.cur.id === id && ui.cur.lane === lane;
/**
 * @param {PresetsUi} ui
 * @param {string} id
 * @param {string | null} [lane]
 */
const pick = (ui, id, lane = null) => {
  ui.cur = { id, lane };
  render(ui);
};
/** @param {PresetsUi} ui */
const fold = (ui) => {
  ui.open = null;
  render(ui);
};

/** @param {PresetsUi} ui */
function render(ui) {
  const { presets, subs, by, rows, panel, trigger } = ui;
  rows.replaceChildren(
    ...presets
      .filter((p) => !subs.includes(p.id))
      .flatMap((p) => {
        if (!LINEAGE.lanes.includes(p.id)) return [presetRow(ui, p)];
        const shown = ui.open === p.id;
        return [presetRow(ui, p), ...(shown ? subs.map((id) => subRow(ui, by[id], p.id)) : [foldLine(ui, p)])];
      }),
  );
  if (panel.offsetParent) parkLeftOf(panel, trigger); // height changed: stay inside the plate
}

/**
 * The folded subsets under a flagship: ▸ and their names, the picked one amber. Tap → open (closes the other).
 *
 * @param {PresetsUi} ui
 * @param {Preset} p
 */
function foldLine(ui, p) {
  const { subs, by } = ui;
  return h(
    "button.fsubs",
    {
      type: "button",
      aria: { expanded: false, label: `Show ${subs.map((id) => by[id].name).join(" and ")} for ${p.name}` },
      on: {
        click: () => {
          ui.open = p.id;
          render(ui);
        },
      },
    },
    subs.map((id) =>
      h(
        "span",
        { class: isCur(ui, id, p.id) && "cur" },
        h("span.em", { "aria-hidden": "true", text: by[id].emoji }),
        by[id].name,
      ),
    ),
  );
}

/**
 * @param {PresetsUi} ui
 * @param {Preset} p
 */
function presetRow(ui, p) {
  const flag = LINEAGE.lanes.includes(p.id);
  return h(
    "div.frow",
    { class: classNames(isCur(ui, p.id) && "cur", flag && ui.open === p.id && "opened"), data: { preset: p.id } },
    h(
      "button.pick",
      { type: "button", on: { click: () => pick(ui, p.id) } },
      h("span.lamp", { class: isCur(ui, p.id) && "on" }),
      h("span.em", { "aria-hidden": "true", text: p.emoji }),
      h("span.pn", {}, p.name, p.hires && h("span.hires", { title: HIRES_TIP, text: "Hi-Res" })),
      h("span.ds", { text: p.desc }),
    ),
    h(
      "span.fl",
      {},
      p.filters.map((f) => h("span", {}, f.stage && h("span.k", { text: f.stage }), f.name)),
    ),
    h("span.kn", {}, p.knobs.map(knob)),
    h("span.ap", {}, correctionGlyph(p.correction)),
    cost(p.cost),
  );
}

/**
 * The Filter presets popover, parked to the left of its button.
 *
 * @param {HTMLElement} plate
 * @param {HTMLElement} trigger
 * @param {Preset[]} presets
 */
export function mountFilterPresets(plate, trigger, presets) {
  const subs = Object.keys(LINEAGE.rows); // ['concert-hall', 'crucible']
  const rows = h("div.frows");
  const panel = h(
    "div.pop.fpop#fpop",
    { role: "dialog", "aria-label": "Filter presets" },
    h(
      "div.fhead",
      {},
      PRESET_COLUMNS.map((c, i, a) => h("span", { class: i === a.length - 1 && "r", text: c })),
    ),
    rows,
  );
  plate.append(panel);
  popover({ trigger, panel, onToggle: (o) => o && parkLeftOf(panel, trigger) });
  /** @type {PresetsUi} */
  const ui = {
    presets,
    by: Object.fromEntries(presets.map((p) => [p.id, p])),
    subs,
    corr: Object.fromEntries(subs.map((id) => [id, "on"])),
    cur: { id: presets.find((p) => p.current)?.id, lane: null },
    open: null,
    rows,
    panel,
    trigger,
  };
  render(ui);
}

/**
 * A subset preset nested under a flagship, in that flagship's version; ▾ on the first one folds the pair again.
 *
 * @param {PresetsUi} ui
 * @param {Preset} p
 * @param {string} lane
 */
function subRow(ui, p, lane) {
  const { subs, by, corr } = ui;
  const on = corr[p.id] === "on";
  // Correction Off costs one pip less (v1 easycost.js); a fixed version or a captioned cost doesn't move.
  const v = subsetVersion(LINEAGE.rows, p.id, lane, on);
  const k = p.knobs[0];
  const first = p.id === subs[0];
  return h(
    "div.frow.sub",
    { class: classNames(isCur(ui, p.id, lane) && "cur", first && "first"), data: { preset: p.id, lane } },
    h(
      "button.pick",
      { type: "button", on: { click: () => pick(ui, p.id, lane) } },
      h("span.lamp", { class: isCur(ui, p.id, lane) && "on" }),
      h("span.em", { "aria-hidden": "true", text: p.emoji }),
      h("span.pn", { text: p.name }),
      h("span.ds", { text: p.desc }),
    ),
    h("span.fl", {}, h("span", { text: v.filter })),
    // Correction only where this version has a non-correcting twin (v1 `when`); The Crucible's Lifelike has none.
    h(
      "span.kn",
      {},
      v.toggle &&
        h(
          "span.kseg",
          { title: k.title },
          h("span.kl", { text: k.label }),
          seg({
            tag: "span",
            aria: `${p.name} ${k.label}`,
            value: on ? "On" : "Off",
            options: k.options.map((o) => ({ v: o.label, label: o.label })),
            onChange: (val) => {
              corr[p.id] = val === "On" ? "on" : "off";
              render(ui);
            },
          }),
        ),
    ),
    h("span.ap", {}, correctionGlyph(v.correction)),
    cost(v.cost),
    first &&
      h("button.fsubx", {
        type: "button",
        "aria-label": `Hide ${subs.map((id) => by[id].name).join(" and ")}`,
        on: { click: () => fold(ui) },
      }),
  );
}

/** @param {Knob} k */
function knob(k) {
  const options = k.options.map((o) => ({ v: o.label, label: o.label, title: o.title }));
  return h(
    "span.kseg",
    { title: k.title },
    h("span.kl", { text: k.label }),
    seg({ tag: "span", aria: k.label, options, value: k.options.find((o) => o.on)?.label }),
  );
}

/**
 * Correction coverage: filled disc = full, half disc = partial, ring = none.
 *
 * @param {string} kind
 */
function correctionGlyph(kind) {
  const label = LABELS[kind];
  /** @type {Record<string, () => SVGElement | SVGElement[]>} */
  const shapes = {
    full: () => s("circle", { cx: 7, cy: 7, r: 6, fill: "currentColor" }),
    partial: () => [
      s("circle", { cx: 7, cy: 7, r: 5.5, fill: "none", stroke: "currentColor" }),
      s("path", { d: "M7 1.5 A5.5 5.5 0 0 1 7 12.5 Z", fill: "currentColor" }),
    ],
    none: () => s("circle", { cx: 7, cy: 7, r: 5.5, fill: "none", stroke: "currentColor" }),
  };
  const shape = shapes[kind]();
  return s("svg.apod", { viewBox: "0 0 14 14", role: "img", "aria-label": label }, s("title", { text: label }), shape);
}

/** @param {Cost} c */
function cost(c) {
  if (c.word) return h("span.pips", {}, h("span.w", { text: c.word }));
  return h(
    "span.pips",
    { role: "img", "aria-label": `${c.pips} ${c.pips === 1 ? "pip" : "pips"}` },
    Array.from({ length: /** @type {number} */ (c.pips) }, () => h("span.pip")),
  );
}
