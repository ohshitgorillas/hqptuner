// Stage drawer with output-mode tabs: DSD Processing, Resampling, Shaping (data/conversion.js MODE_DRAWERS). Replaces the
// combined Resampling · Shaping drawer: one rail stage, one drawer, in signal order.
//   Head   title, then PCM out | SDM out tabs (the output modes; the engine keeps a chain per mode). It opens on the
//          running mode; the other mode's tab reads `idle`, and while it shows the head is hatched and the plate darker
//          (what can't run now), as the idle chain was.
//   Rows   the drawer row grammar: control column (label, control) | the setting's manual paragraph, then the picked
//          option's line full width under the row. Live rows (filters, shapers) apply at once and reach the page + rail
//          (`on`); restart rows stage (dirty dot on their tab), Apply / Discard in the head. FFT length shows only while
//          that mode picks an FFT-family filter.
// Page-held fields (the running mode's filters and shaper) show here too: two homes, one state (set(id, v) moves a pick in).

import { h } from "../../lib/shell/dom.js";
import { registerDrawer, applyGroup, drawerOpener } from "./drawer.js";
import { seg, select } from "../controls/seg.js";
import { vselect, optCopy } from "../lists/vselect.js";
import { xref } from "../../lib/controls/xref.js";
import { secHead, closeBtn, numBox } from "../../lib/controls/controls.js";
import { isFft, MODE_TABS } from "../../data/stages/conversion.js";

/** @typedef {import("../lists/vselect.js").CatalogOption} CatalogOption */
/** @typedef {import("./drawer/state.js").Store} Store */
/** @typedef {import("./drawer/apply.js").ApplyGroup} ApplyGroup */
/** @typedef {import("./drawer/registry.js").SetOpen} SetOpen */
/** @typedef {"pcm" | "sdm"} Mode */

/** @typedef {{ type: string, aria: string, options: CatalogOption[], min?: number, max?: number, hint?: string }} FieldControl */

/**
 * One item of a mode tab as MODE_DRAWERS gives it: a setting row, or a section header carrying only `head`.
 *
 * @typedef {object} ModeRow
 * @property {string} [head]
 * @property {string} [id]
 * @property {string} [label]
 * @property {string} [sub]
 * @property {string | (string | { text: string })[]} [man]
 * @property {{ type: string, aria?: string | null, options?: CatalogOption[], min?: number, max?: number, hint?: string }} [control]
 * @property {boolean} [restart]
 * @property {boolean} [live]
 * @property {string} [fft]
 */

/** @typedef {ModeRow & { id: string, label: string, man: NonNullable<ModeRow["man"]>, control: FieldControl }} ModeField */

/** @type {(r: ModeRow) => r is ModeField}  a setting row: id, label, manual copy, a labelled control with options */
const isField = (r) =>
  r.id !== undefined &&
  r.label !== undefined &&
  r.man !== undefined &&
  r.control?.options !== undefined &&
  typeof r.control.aria === "string";

/** @typedef {{ id: string, link: { to: string, label: string } }} ModeNote */

/**
 * A MODE_DRAWERS entry.
 *
 * @typedef {object} ModeSpec
 * @property {string} id
 * @property {string} title
 * @property {string} aria
 * @property {Record<Mode, ModeRow[]>} modes
 * @property {Partial<Record<Mode, ModeNote[]>>} [notes]
 */

/** @typedef {{ el: HTMLElement, copy: HTMLElement | null, ui: (v: string) => void }} ModeCtl */

/**
 * The drawer's state `d`: spec, on, onApplied; vals (current) and base (applied); run (the running mode) and shown (the
 * tab on view); ctls id → [{ui, copy, list}]; rowsOf mode → [{node, r}]; dirty (modes holding staged edits); notes id →
 * text span; and its elements (tabs, panels, grp, drawer, setOpen).
 *
 * @typedef {object} ModeState
 * @property {ModeSpec} spec
 * @property {((id: string, v: string) => void) | undefined} on
 * @property {((vals: Store) => void) | undefined} onApplied
 * @property {Store} vals
 * @property {Store} base
 * @property {Mode} run
 * @property {Mode} shown
 * @property {Map<string, { ui: (v: string) => void, copy: HTMLElement | null, list: CatalogOption[] }[]>} ctls
 * @property {Record<Mode, { node: HTMLElement, r: ModeField }[]>} rowsOf
 * @property {Set<string | undefined>} dirty
 * @property {Map<string, HTMLElement>} notes
 * @property {HTMLElement[]} tabs
 * @property {Record<Mode, HTMLElement>} panels
 * @property {ApplyGroup} grp
 * @property {HTMLElement} drawer
 * @property {SetOpen} setOpen
 */

/**
 * The api main.js and the conversion page call.
 *
 * @typedef {object} ModeApi
 * @property {SetOpen} setOpen
 * @property {(id: string) => boolean} has
 * @property {(id: string, v: string) => void} set
 * @property {(m: Mode) => void} setRunning
 * @property {(m: Mode) => void} openAt
 * @property {() => Store} values
 * @property {(id: string, text: string) => void} note
 */

/** @type {Mode[]} */
const MODES = ["pcm", "sdm"];

/** @typedef {(d: ModeState, r: ModeField, m: Mode, id: string) => ModeCtl} CtlOf  builds row r's control on tab m */

/** @type {CtlOf}  a select; its options' manual lines give it the picked option's line */
function selectControl(d, r, m, id) {
  const c = r.control;
  const el = vselect({ id, aria: c.aria, options: c.options, value: d.vals[r.id], onChange: (v) => pick(d, r, m, v) });
  const copy = c.options.some((x) => x.man) ? h("p.optman", {}, optCopy(c.options, d.vals[r.id])) : null;
  return {
    el,
    copy,
    ui: (v) => {
      el.value = v;
    },
  };
}

/** @type {CtlOf}  a number box; its setter rides on the element as `_ui` */
function numberControl(d, r, m, id) {
  const c = r.control;
  /** @type {{ el: HTMLElement & { _ui?: (v: string) => void }, input: HTMLInputElement }} */
  const { el, input } = numBox({ id, value: d.vals[r.id], min: c.min, max: c.max, aria: c.aria, hint: c.hint });
  input.addEventListener("change", () => pick(d, r, m, input.value));
  /** @param {string} v */
  const ui = (v) => {
    input.value = v;
  };
  el._ui = ui;
  return { el, copy: null, ui };
}

/**
 * One row's control and the setter that moves it to a value, plus the picked option's line when its options carry one.
 *
 * @type {CtlOf}
 */
function control(d, r, m, id) {
  const c = r.control;
  if (c.type === "select") return selectControl(d, r, m, id);
  if (c.type === "number") return numberControl(d, r, m, id);
  const el = seg({
    aria: c.aria,
    options: c.options,
    value: d.vals[r.id],
    attrs: { id },
    onChange: (v) => pick(d, r, m, v),
  });
  return { el, copy: null, ui: (v) => select(el, v) };
}

/** @type {(d: ModeState, r: ModeField, m: Mode) => HTMLElement} */
function row(d, r, m) {
  const { el, copy, ui } = control(d, r, m, `${d.spec.id}-${m}-${r.id}`);
  if (!d.ctls.has(r.id)) d.ctls.set(r.id, []);
  d.ctls.get(r.id)?.push({ ui, copy, list: r.control.options });
  const node = h(
    "div.drow.cvrow",
    { data: { id: r.id } },
    h("div.ctl", {}, h("div.fh", {}, h("b", { text: r.label }), r.sub && h("span.s", { text: r.sub })), el),
    h(
      "div.man",
      {},
      [r.man].flat().map((t) => h("p", { text: typeof t === "string" ? t : t.text })),
    ),
    copy && h("div.optfull", {}, copy),
  );
  d.rowsOf[m].push({ node, r });
  return node;
}

/** @type {(d: ModeState, r: ModeField, m: Mode, v: string) => void} */
function pick(d, r, m, v) {
  apply(d, r.id, v);
  if (r.restart) {
    d.dirty.add(m);
    paintDirty(d);
  }
  if (r.live) {
    d.base[r.id] = v;
    d.on?.(r.id, v);
  }
}

/** @type {(d: ModeState, id: string, v: string) => void} */
function apply(d, id, v) {
  d.vals[id] = v;
  for (const it of d.ctls.get(id) || []) {
    it.ui(v);
    if (it.copy) it.copy.replaceChildren(...optCopy(it.list, v).filter(Boolean));
  }
  paintRows(d);
}

/** @param {ModeState} d */
function discard(d) {
  for (const [id, v] of Object.entries(d.base)) if (d.vals[id] !== v) apply(d, id, v);
  d.dirty.clear();
  paintDirty(d);
}

/**
 * FFT length: only while its mode picks an FFT-family filter.
 *
 * @param {ModeState} d
 */
function paintRows(d) {
  for (const m of MODES)
    for (const { node, r } of d.rowsOf[m]) {
      if (r.fft) node.hidden = !(isFft(d.vals[m + "1x"]) || isFft(d.vals[m + "nx"]));
    }
}

/** @param {ModeState} d */
function paint(d) {
  d.drawer.classList.toggle("idle", d.shown !== d.run);
  for (const b of d.tabs) {
    const m = b.dataset.tab;
    b.setAttribute("aria-selected", String(m === d.shown));
    /** @type {HTMLElement} */ (b.querySelector(".cst")).textContent = m === d.run ? "" : "idle";
  }
  for (const m of MODES) d.panels[m].hidden = m !== d.shown;
  paintRows(d);
  paintDirty(d);
}

/** @param {ModeState} d */
function paintDirty(d) {
  for (const b of d.tabs) b.classList.toggle("dirty", d.dirty.has(b.dataset.tab));
  const restarts = d.rowsOf[d.shown].some(({ node, r }) => !node.hidden && r.restart);
  d.grp.paint(restarts || d.dirty.size > 0, d.dirty.size > 0);
}

// Notes: a read-only line under the rows naming a value that lives elsewhere, with a link there (Shaping: DAC bits).
/** @type {(d: ModeState, n: ModeNote) => HTMLElement} */
const noteEl = (d, n) => {
  const t = h("span");
  d.notes.set(n.id, t);
  return h("p.mnote", {}, t, " ", xref(n.link.to, n.link.label));
};

/**
 * The drawer: head (title, mode tabs, apply group, close) over one panel per mode, appended to `body`.
 *
 * @param {ModeState} d
 * @param {HTMLElement} body
 */
function build(d, body) {
  const { spec } = d;
  d.panels = /** @type {Record<Mode, HTMLElement>} */ ({});
  for (const m of MODES) {
    d.panels[m] = h(
      "div.dpanel.cvpanel",
      { role: "tabpanel", "aria-label": `${MODE_TABS[m].split(" ")[0]} ${spec.title}`, hidden: true },
      spec.modes[m].map((r) => (r.head ? secHead("msec", r.head) : isField(r) && row(d, r, m))),
      (spec.notes?.[m] || []).map((n) => noteEl(d, n)),
    );
  }
  d.tabs = MODES.map((m) =>
    h(
      "button",
      {
        type: "button",
        role: "tab",
        data: { tab: m },
        on: {
          click: () => {
            d.shown = m;
            paint(d);
          },
        },
      },
      h("span", { text: MODE_TABS[m] }),
      h("span.cst"),
    ),
  );

  const title = h("span.t", { text: spec.title });
  const tabHost = h("div.seg.dtabs.mtabs", { role: "tablist", "aria-label": `${spec.title}: output mode` }, d.tabs);
  const close = closeBtn(() => d.setOpen(false), "Close drawer");
  d.grp = applyGroup(
    () => {
      d.base = { ...d.vals };
      d.dirty.clear();
      paintDirty(d);
      d.onApplied?.({ ...d.vals });
    },
    () => discard(d),
  );
  const head = h("div.dhead.cvhead", {}, title, tabHost, h("span.grow"), d.grp.el, close);
  const frame = h("div.cvbody", {}, d.panels.pcm, d.panels.sdm);
  d.drawer = h(
    `aside.drawer.cvdrawer.mdrawer#drawer-${spec.id}`,
    { "aria-label": spec.aria, "data-closed": "" },
    head,
    frame,
  );
  body.append(d.drawer);
}

/**
 * Each rail stage toggles the drawer, opening it on the running mode.
 *
 * @param {ModeState} d
 * @param {HTMLElement[]} stages
 */
function wireStages(d, stages) {
  for (const st of stages) {
    st.setAttribute("aria-controls", d.drawer.id);
    st.addEventListener("click", () => {
      if (!d.drawer.hasAttribute("data-closed")) d.setOpen(false);
      else {
        d.shown = d.run;
        paint(d);
        d.setOpen(true);
      }
    });
  }
}

/**
 * @param {ModeState} d
 * @returns {ModeApi}
 */
function modeApi(d) {
  return {
    setOpen: d.setOpen,
    has: (id) => id in d.vals,
    /** A pick made on the page (its other home). */
    set: (id, v) => {
      if (!(id in d.vals)) return;
      d.base[id] = v;
      if (d.vals[id] !== v) apply(d, id, v);
    },
    /** Output mode moved: the running mode changes; a closed drawer will open on it. */
    setRunning: (m) => {
      d.run = m;
      d.shown = m;
      paint(d);
    },
    /** A cross-reference lands here: open on that mode's tab, running or idle. */
    openAt: (m) => {
      d.shown = m;
      paint(d);
      d.setOpen(true);
    },
    values: () => ({ ...d.vals }),
    /** A note's text (its link stays). */
    note: (id, text) => {
      const t = d.notes.get(id);
      if (t) t.textContent = text;
    },
  };
}

/**
 * Mount a mode drawer into `body`, opened by its rail stages, starting from the conversion values; returns its api.
 *
 * @param {HTMLElement} body
 * @param {HTMLElement[]} stages  rail stages that open it
 * @param {ModeSpec} spec        MODE_DRAWERS entry
 * @param {{values: Store, running: Mode, on?: (id: string, v: string) => void, onApplied?: (vals: Store) => void}} o
 *   values: CONV.values (initial)
 * @returns {ModeApi}
 */
export function mountModeDrawer(body, stages, spec, { values, running, on, onApplied }) {
  /** @type {Store} */
  const vals = {};
  for (const m of MODES) for (const r of spec.modes[m]) if (!r.head && isField(r)) vals[r.id] = values[r.id];
  // build() and drawerOpener fill in the elements and setOpen before anything reads them.
  const record = /** @type {unknown} */ ({
    spec,
    on,
    onApplied,
    vals,
    base: { ...vals },
    run: running,
    shown: running,
    ctls: new Map(),
    rowsOf: { pcm: [], sdm: [] },
    dirty: new Set(),
    notes: new Map(),
  });
  const d = /** @type {ModeState} */ (record);
  build(d, body);
  wireStages(d, stages);
  d.setOpen = drawerOpener(d.drawer, stages, () => api);

  paint(d);
  const api = modeApi(d);
  registerDrawer(api);
  return api;
}
