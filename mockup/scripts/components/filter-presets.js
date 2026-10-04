// Filter presets popover (Resampling header). One row per preset: pick button (lamp, emoji, name, description), filters,
// knobs, correction glyph, resource pips. Parked to the left of its button.
//
// Concert Hall and The Crucible are subsets of the flagships: each flagship carries a fold line
// naming them; expanding it shows both as nested rows under that flagship, in that flagship's version (data LINEAGE: the
// lane is the version), so there is no Version knob. One flagship open at a time, so the two copies never show together.
// A nested pick keeps its flagship open and lights the fold line's name while folded.

import { h, s } from "../lib/dom.js";
import { popover } from "../lib/popover.js";
import { parkLeftOf } from "../lib/plate.js";
import { seg } from "./seg.js";
import { PRESET_COLUMNS, CORRECTION_LABELS, HIRES_TIP, LINEAGE } from "../data/presets.js";
import { classNames } from "../model/format.js";
import { subsetVersion } from "../model/presets.js";

export function mountFilterPresets(plate, trigger, presets) {
  const by = Object.fromEntries(presets.map((p) => [p.id, p]));
  const subs = Object.keys(LINEAGE.rows); // ['concert-hall', 'crucible']
  const cur0 = presets.find((p) => p.current);
  let cur = { id: cur0?.id, lane: null }; // the pick: preset id + its flagship for a nested row
  let open = null; // the flagship whose subsets show
  const corr = Object.fromEntries(subs.map((id) => [id, "on"])); // Correction per subset preset (v1: one per preset)

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

  const isCur = (id, lane = null) => cur.id === id && cur.lane === lane;
  const pick = (id, lane = null) => {
    cur = { id, lane };
    render();
  };
  const ui = {
    subs,
    by,
    corr,
    isCur,
    pick,
    render,
    fold: () => {
      open = null;
      render();
    },
  };

  function render() {
    rows.replaceChildren(
      ...presets
        .filter((p) => !subs.includes(p.id))
        .flatMap((p) => {
          if (!LINEAGE.lanes.includes(p.id)) return [presetRow(p)];
          const shown = open === p.id;
          return [presetRow(p), ...(shown ? subs.map((id) => subRow(by[id], p.id, ui)) : [foldLine(p)])];
        }),
    );
    if (panel.offsetParent) parkLeftOf(panel, trigger); // height changed: stay inside the plate
  }

  /** The folded subsets under a flagship: ▸ and their names, the picked one amber. Tap → open (closes the other). */
  function foldLine(p) {
    return h(
      "button.fsubs",
      {
        type: "button",
        aria: { expanded: false, label: `Show ${subs.map((id) => by[id].name).join(" and ")} for ${p.name}` },
        on: {
          click: () => {
            open = p.id;
            render();
          },
        },
      },
      subs.map((id) =>
        h(
          "span",
          { class: isCur(id, p.id) && "cur" },
          h("span.em", { "aria-hidden": "true", text: by[id].emoji }),
          by[id].name,
        ),
      ),
    );
  }

  function presetRow(p) {
    const flag = LINEAGE.lanes.includes(p.id);
    return h(
      "div.frow",
      { class: classNames(isCur(p.id) && "cur", flag && open === p.id && "opened"), data: { preset: p.id } },
      h(
        "button.pick",
        { type: "button", on: { click: () => pick(p.id) } },
        h("span.lamp", { class: isCur(p.id) && "on" }),
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

  render();
}

/**
 * A subset preset nested under a flagship, in that flagship's version; ▾ on the first one folds the pair again.
 * ui: the popover's pick state and actions (mountFilterPresets).
 */
function subRow(p, lane, { subs, by, corr, isCur, pick, render, fold }) {
  const on = corr[p.id] === "on";
  // Correction Off costs one pip less (v1 easycost.js); a fixed version or a captioned cost doesn't move.
  const v = subsetVersion(LINEAGE.rows, p.id, lane, on);
  const k = p.knobs[0];
  const first = p.id === subs[0];
  return h(
    "div.frow.sub",
    { class: classNames(isCur(p.id, lane) && "cur", first && "first"), data: { preset: p.id, lane } },
    h(
      "button.pick",
      { type: "button", on: { click: () => pick(p.id, lane) } },
      h("span.lamp", { class: isCur(p.id, lane) && "on" }),
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
              render();
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
        on: { click: fold },
      }),
  );
}

function knob(k) {
  const options = k.options.map((o) => ({ v: o.label, label: o.label, title: o.title }));
  return h(
    "span.kseg",
    { title: k.title },
    h("span.kl", { text: k.label }),
    seg({ tag: "span", aria: k.label, options, value: k.options.find((o) => o.on)?.label }),
  );
}

/** Correction coverage: filled disc = full, half disc = partial, ring = none. */
function correctionGlyph(kind) {
  const label = CORRECTION_LABELS[kind];
  const shape = {
    full: () => s("circle", { cx: 7, cy: 7, r: 6, fill: "currentColor" }),
    partial: () => [
      s("circle", { cx: 7, cy: 7, r: 5.5, fill: "none", stroke: "currentColor" }),
      s("path", { d: "M7 1.5 A5.5 5.5 0 0 1 7 12.5 Z", fill: "currentColor" }),
    ],
    none: () => s("circle", { cx: 7, cy: 7, r: 5.5, fill: "none", stroke: "currentColor" }),
  }[kind]();
  return s("svg.apod", { viewBox: "0 0 14 14", role: "img", "aria-label": label }, s("title", { text: label }), shape);
}

function cost(c) {
  if (c.word) return h("span.pips", {}, h("span.w", { text: c.word }));
  return h(
    "span.pips",
    { role: "img", "aria-label": `${c.pips} ${c.pips === 1 ? "pip" : "pips"}` },
    Array.from({ length: c.pips }, () => h("span.pip")),
  );
}
