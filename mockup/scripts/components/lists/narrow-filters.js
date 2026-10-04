// Narrowing, built into the filter list sheet: the facet bar along the sheet's head, one button per
// facet reading its state, each opening its own popover with its controls and its hint (v1's model: the hint copy sits with
// the controls it explains). Narrowing shows only here: the page carries no tags. State and matching live in lib/narrow.js;
// every count is live.

import { h } from "../../lib/shell/dom.js";
import { popover } from "../../lib/shell/popover.js";
import { toPlate, PLATE_W } from "../../lib/shell/plate.js";
import { seg, select } from "../controls/seg.js";
import { BAR, MOD_BAR, DITHER_BAR } from "../../data/lists/narrow-facets.js";
import { apodMark } from "../../lib/controls/apod.js";
import { chipPressed, deadChip, facetShown, narrowing, stateKeys, summary } from "../../model/shell/narrow-view.js";
import { defaults, state, change, reset, subscribe, preview, count, chainList } from "../../lib/state/narrow.js";

/** Hint paragraphs: strings or [bold lead-in, rest]; `prefix` opens the first with "HQPTuner Hints:". */
const hint = (f) =>
  f.hint &&
  h(
    "div.nhint",
    {},
    f.hint.map((p, i) =>
      h(
        "p",
        {},
        i === 0 && f.prefix && [h("strong", { text: "HQPTuner Hints:" }), " "],
        Array.isArray(p) ? [h("strong", { text: p[0] }), p[1]] : p,
      ),
    ),
  );

/**
 * The facet's state, short, in the list's own vocabulary: '' when it isn't narrowing. stage = the list's stage.
 * Bounded (long states broke the bar): one pick reads its label; several read `N · AND` / `N · OR` (the
 * facet's combine mode; Phase and Length always union); rate rules read their v1 tag, several `N rules`.
 */
function stateText(f, st, stage) {
  const s = summary(f, st, stage);
  if (!s) return "";
  if ("apod" in s) return s.apod === "only" ? [apodMark("full"), " only"] : [apodMark("full"), " + ", apodMark("half")];
  if ("labels" in s) return s.labels.join(" · ");
  if ("picks" in s) return `${s.picks} · ${s.mode.toUpperCase()}`;
  if ("rules" in s) return `${s.rules} rules`;
  return "On";
}
/** Every state a facet can show, for sizing its button once to the longest (the bar never changes width). */
function allStates(f) {
  if (f.apod) return [[apodMark("full"), " only"], [apodMark("full"), " + ", apodMark("half")], "All"];
  if (f.kind === "seg") return f.rows[0].options.map((o) => o.label);
  if (f.kind === "chips")
    return [...f.options.map((o) => o.label), `${f.options.length} · AND`, `${f.options.length} · OR`, "Any"];
  if (f.kind === "checks") return [...f.items.map((i) => i.tag), `${f.items.length} rules`, "Off"];
  return ["On", "Off"];
}
// What an idle facet reads (its default, never blank: the bar is a row of readouts).
const IDLE = { chips: "Any", toggle: "Off", checks: "Off" };
const idleText = (f) => (f.kind === "seg" ? f.rows[0].options[0].label : IDLE[f.kind]);

// One console per list kind: filters | modulators (rate floor + favorites) | dithers (rate marker).
// Favorites is one switch shared by filters and modulators (v1), so it has a button in both.
const FAV = BAR.flat().find((f) => f.key === "fav");
const SETS = { filters: BAR.flat(), modulators: [...MOD_BAR.flat(), FAV], dithers: DITHER_BAR.flat() };

// A chip / segment's count: the 1x·Nx filter lists for filter facets, the list itself for shaper facets.
const countFor = (k, over) => (k === "filters" ? preview(over) : String(count(k, "1x", { ...state(), ...over })));

/** A live preview count, refreshed on every change. */
const cnt = (bar, cls, fn) => {
  const el = h(`span.${cls}`);
  bar.counts.push({ el, fn });
  return el;
};

/** A chips facet's picks with `v` switched. */
const toggled = (k, v) => {
  const sel = state()[k];
  return sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v];
};

/** Drop under the button, left edges flush, clamped inside the plate. */
function place(panel, b) {
  const r = toPlate(b.getBoundingClientRect());
  panel.style.left = `${Math.round(Math.min(Math.max(22, r.x), PLATE_W - 22 - panel.offsetWidth))}px`;
  panel.style.top = `${Math.round(r.y + b.offsetHeight + 6)}px`;
}

function modeSeg(f) {
  if (!f.combine) return null;
  const st = state();
  return h(
    "span.mode",
    {},
    seg({
      tag: "span",
      cls: "mini",
      aria: `Combine ${f.label}`,
      attrs: { "data-mode": f.key },
      // Default leftmost: each facet's own default mode first (genre OR, focus AND).
      options:
        st[f.key + "Mode"] === "or"
          ? [
              { v: "or", label: "OR" },
              { v: "and", label: "AND" },
            ]
          : [
              { v: "and", label: "AND" },
              { v: "or", label: "OR" },
            ],
      value: st[f.key + "Mode"],
      onChange: (v) => change(f.key + "Mode", v),
    }),
  );
}

function chip(bar, o, onClick, n) {
  return h(
    "button.nchip",
    { type: "button", data: { v: o.v }, aria: { pressed: false }, on: { click: onClick } },
    o.label,
    cnt(bar, "c", n),
  );
}

/** One segmented row of a seg facet, each segment carrying the count its pick lands on. */
function segRow(bar, f, r) {
  const s = seg({
    tag: "span",
    aria: r.aria,
    attrs: { "data-facet": r.key },
    // Apodizing's segments speak the rows' own marks (v1's circled A / ½).
    options: f.apod
      ? r.options.map((o) => ({
          ...o,
          label:
            o.v === "only"
              ? h("span.amk", {}, apodMark("full"))
              : o.v === "half"
                ? h("span.amk", {}, apodMark("full"), "+", apodMark("half"))
                : o.label,
        }))
      : r.options,
    value: state()[r.key],
    onChange: (v) => change(r.key, typeof r.options[0].v === "number" ? Number(v) : v),
  });
  // Each segment carries the count its pick lands on: that stage's list for a staged row, 1x·Nx otherwise.
  s.querySelectorAll("button").forEach((b, i) => {
    const over = { [r.key]: r.options[i].v };
    b.append(
      cnt(bar, "c", () => (r.stage ? String(count(chainList(), r.stage, { ...state(), ...over })) : preview(over))),
    );
  });
  return h(
    "div.nrow",
    {},
    r.stage && r.showStage !== false && h("span.stg", { text: r.stage === "nx" ? "Nx" : "1x" }),
    s,
  );
}

function facetBody(bar, f, k) {
  switch (f.kind) {
    case "chips":
      return h(
        "div.nchips",
        { data: { facet: f.key } },
        f.options.map((o) =>
          chip(
            bar,
            o,
            () => change(f.key, toggled(f.key, o.v)),
            () => countFor(k, { [f.key]: toggled(f.key, o.v) }),
          ),
        ),
      );
    case "toggle":
      return h(
        "div.nchips",
        { data: { facet: f.key } },
        chip(
          bar,
          { v: "on", ...f.chip },
          () => change(f.key, !state()[f.key]),
          () => countFor(k, { [f.key]: !state()[f.key] }),
        ),
      );
    case "seg":
      return f.rows.map((r) => segRow(bar, f, r));
    case "checks":
      return f.items.map((i) =>
        h(
          "div.nrow",
          {},
          h(
            "label.chk",
            {},
            h("input", {
              type: "checkbox",
              data: { facet: i.key },
              on: { change: (e) => change(i.key, e.target.checked) },
            }),
            h("span", { text: i.label }),
            cnt(bar, "c", () => preview({ [i.key]: !state()[i.key] })),
          ),
        ),
      );
  }
}

/** One facet's button in the console for list kind `k`, with its popover appended to the plate. */
function facetButton(bar, plate, f, k) {
  const v = h("span.fv2");
  // Favorites: a plain On / Off switch, no popover (its hint rides as the tooltip).
  if (f.key === "fav") {
    const b = h(
      "button.fbtn",
      {
        type: "button",
        aria: { pressed: false },
        title: f.hint.join(" "),
        on: { click: () => change(f.key, !state()[f.key]) },
      },
      h("span.fl", { text: f.label }),
      v,
    );
    bar.btns.push({ f, b, v, kind: k });
    return b;
  }
  const b = h("button.fbtn", { type: "button", aria: { haspopup: "dialog" } }, h("span.fl", { text: f.label }), v);
  const panel = h(
    "div.pop.fpop2",
    { role: "dialog", "aria-label": f.label },
    h("div.fph", {}, h("span.t", { text: f.label }), modeSeg(f)),
    facetBody(bar, f, k),
    hint(f),
  );
  plate.append(panel);
  popover({ trigger: b, panel, onToggle: (open) => open && place(panel, b) });
  bar.btns.push({ f, b, v, kind: k });
  return b;
}

/** Size each visible button once to its longest possible state (call with the bar laid out, real fonts loaded). */
function fit(bar) {
  if (!bar.el.offsetParent) return;
  for (const { f, b, v } of bar.btns) {
    if (b.dataset.sized || !b.offsetParent) continue;
    b.dataset.sized = "1";
    const keep = [...v.childNodes];
    let w = 0;
    for (const sx of allStates(f)) {
      v.replaceChildren(...[sx].flat());
      w = Math.max(w, b.offsetWidth);
    }
    v.replaceChildren(...keep);
    b.style.width = `${Math.ceil(w)}px`;
  }
}

/** The popovers' controls read the state: chips pressed, segments and checks picked, dead chips disabled. */
function paintControls(st) {
  for (const g of document.querySelectorAll(".fpop2 .nchips[data-facet]")) {
    const k = g.dataset.facet;
    for (const c of g.querySelectorAll(".nchip"))
      c.setAttribute("aria-pressed", String(chipPressed(st, k, c.dataset.v)));
  }
  for (const g of document.querySelectorAll(".fpop2 .seg[data-facet]")) select(g, st[g.dataset.facet]);
  for (const g of document.querySelectorAll(".fpop2 .seg[data-mode]")) select(g, st[g.dataset.mode + "Mode"]);
  for (const i of document.querySelectorAll(".fpop2 input[data-facet]")) i.checked = !!st[i.dataset.facet];
  // A chip whose pick would empty both lists is dead (v1 labels.js tagRowOff, its 0/0 case), unless it is picked.
  for (const c of document.querySelectorAll(".fpop2 .nchip")) {
    c.disabled = deadChip(c.getAttribute("aria-pressed") === "true", c.querySelector(".c").textContent);
    c.title = c.disabled ? "No filters with this property match the current selections." : "";
  }
}

function render(bar, st) {
  for (const { f, b, v } of bar.btns) {
    const s = stateText(f, st, bar.stage);
    v.replaceChildren(...[s || idleText(f)].flat());
    b.classList.toggle("on", !!(Array.isArray(s) ? s.length : s));
    if (f.key === "fav") b.setAttribute("aria-pressed", String(!!st.fav));
    b.hidden = !facetShown(f, bar.stage);
  }
  const live = narrowing(stateKeys(SETS[bar.kind]), st, defaults());
  bar.resetBtn.classList.toggle("idle", !live); // its slot stays: nothing in the bar ever moves
  for (const c of bar.counts) c.el.textContent = c.fn();
  paintControls(st);
}

/** Show the console for a list kind ('filters' | 'modulators' | 'dithers') at a stage. */
function show(bar, k, s) {
  bar.kind = k;
  bar.stage = s;
  for (const c of bar.sets) c.hidden = c.dataset.kind !== k;
  render(bar, state());
}

/**
 * The facet bar: one button per facet in clusters (data BAR), each reading its state; tapping one opens its popover, the
 * facet's controls with its hint under them, verbatim. Favorites is the exception: the button itself switches it. Every count is live. Returns {el, setStage(stage)}.
 * @param {HTMLElement} plate
 */
export function mountFacetBar(plate) {
  // counts {el, fn}: live preview counts, refreshed on every change; btns {f, b, v, kind}.
  const bar = { counts: [], btns: [], stage: "1x", kind: "filters" };
  bar.resetBtn = h("button.fbreset", {
    type: "button",
    text: "Reset",
    on: { click: () => reset(stateKeys(SETS[bar.kind])) },
  });
  bar.sets = Object.entries(SETS).map(([k, fs]) =>
    h(
      "div.fbc",
      { data: { kind: k } },
      fs.map((f) => facetButton(bar, plate, f, k)),
    ),
  );
  bar.el = h("div.fbar", { role: "group", "aria-label": "Narrow" }, bar.sets, bar.resetBtn);
  subscribe((st) => render(bar, st));
  render(bar, state());
  return { el: bar.el, fit: () => fit(bar), show: (k, s) => show(bar, k, s) };
}
