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

// The drawer's state `d`: spec, on, onApplied; vals (current) and base (applied); run (the running mode) and shown (the
// tab on view); ctls id → [{ui, copy, list}]; rowsOf mode → [{node, r}]; dirty (modes holding staged edits); notes id →
// text span; and its elements (tabs, panels, grp, drawer, setOpen).

/** One row's control and the setter that moves it to a value, plus the picked option's line when its options carry one. */
function control(d, r, m, id) {
  const c = r.control;
  let el,
    copy = null;
  if (c.type === "select") {
    el = vselect({ id, aria: c.aria, options: c.options, value: d.vals[r.id], onChange: (v) => pick(d, r, m, v) });
    if (c.options.some((x) => x.man)) copy = h("p.optman", {}, optCopy(c.options, d.vals[r.id]));
  } else if (c.type === "number") {
    const { el: num, input } = numBox({ id, value: d.vals[r.id], min: c.min, max: c.max, aria: c.aria, hint: c.hint });
    input.addEventListener("change", () => pick(d, r, m, input.value));
    el = num;
    el._ui = (v) => {
      input.value = v;
    };
  } else {
    el = seg({
      aria: c.aria,
      options: c.options,
      value: d.vals[r.id],
      attrs: { id },
      onChange: (v) => pick(d, r, m, v),
    });
  }
  const ui =
    c.type === "select"
      ? (v) => {
          el.value = v;
        }
      : c.type === "number"
        ? el._ui
        : (v) => select(el, v);
  return { el, copy, ui };
}

function row(d, r, m) {
  const { el, copy, ui } = control(d, r, m, `${d.spec.id}-${m}-${r.id}`);
  if (!d.ctls.has(r.id)) d.ctls.set(r.id, []);
  d.ctls.get(r.id).push({ ui, copy, list: r.control.options });
  const node = h(
    "div.drow.cvrow",
    { data: { id: r.id } },
    h("div.ctl", {}, h("div.fh", {}, h("b", { text: r.label }), r.sub && h("span.s", { text: r.sub })), el),
    h(
      "div.man",
      {},
      [].concat(r.man).map((t) => h("p", { text: t })),
    ),
    copy && h("div.optfull", {}, copy),
  );
  d.rowsOf[m].push({ node, r });
  return node;
}

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

function apply(d, id, v) {
  d.vals[id] = v;
  for (const it of d.ctls.get(id) || []) {
    it.ui(v);
    if (it.copy) it.copy.replaceChildren(...optCopy(it.list, v).filter(Boolean));
  }
  paintRows(d);
}

function discard(d) {
  for (const [id, v] of Object.entries(d.base)) if (d.vals[id] !== v) apply(d, id, v);
  d.dirty.clear();
  paintDirty(d);
}

/** FFT length: only while its mode picks an FFT-family filter. */
function paintRows(d) {
  for (const m of ["pcm", "sdm"])
    for (const { node, r } of d.rowsOf[m]) {
      if (r.fft) node.hidden = !(isFft(d.vals[m + "1x"]) || isFft(d.vals[m + "nx"]));
    }
}

function paint(d) {
  d.drawer.classList.toggle("idle", d.shown !== d.run);
  for (const b of d.tabs) {
    const m = b.dataset.tab;
    b.setAttribute("aria-selected", String(m === d.shown));
    b.querySelector(".cst").textContent = m === d.run ? "" : "idle";
  }
  for (const m of ["pcm", "sdm"]) d.panels[m].hidden = m !== d.shown;
  paintRows(d);
  paintDirty(d);
}

function paintDirty(d) {
  for (const b of d.tabs) b.classList.toggle("dirty", d.dirty.has(b.dataset.tab));
  const restarts = d.rowsOf[d.shown].some(({ node, r }) => !node.hidden && r.restart);
  d.grp.paint(restarts || d.dirty.size > 0, d.dirty.size > 0);
}

// Notes: a read-only line under the rows naming a value that lives elsewhere, with a link there (Shaping: DAC bits).
const noteEl = (d, n) => {
  const t = h("span");
  d.notes.set(n.id, t);
  return h("p.mnote", {}, t, " ", xref(n.link.to, n.link.label));
};

/** The drawer: head (title, mode tabs, apply group, close) over one panel per mode, appended to `body`. */
function build(d, body) {
  const { spec } = d;
  d.panels = {};
  for (const m of ["pcm", "sdm"]) {
    d.panels[m] = h(
      "div.dpanel.cvpanel",
      { role: "tabpanel", "aria-label": `${MODE_TABS[m].split(" ")[0]} ${spec.title}`, hidden: true },
      spec.modes[m].map((r) => (r.head ? secHead("msec", r.head) : row(d, r, m))),
      (spec.notes?.[m] || []).map((n) => noteEl(d, n)),
    );
  }
  d.tabs = ["pcm", "sdm"].map((m) =>
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

/** Each rail stage toggles the drawer, opening it on the running mode. */
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
 * @param {HTMLElement} body
 * @param {HTMLButtonElement[]} stages  rail stages that open it
 * @param {object} spec                 MODE_DRAWERS entry
 * @param {object} values               CONV.values (initial)
 * @param {{running: string, on?: (id: string, v: string) => void, onApplied?: (vals: object) => void}} o
 */
export function mountModeDrawer(body, stages, spec, values, { running, on, onApplied }) {
  const vals = {};
  for (const m of ["pcm", "sdm"]) for (const r of spec.modes[m]) if (!r.head) vals[r.id] = values[r.id];
  const d = {
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
  };
  build(d, body);
  wireStages(d, stages);
  d.setOpen = drawerOpener(d.drawer, stages, () => api);

  paint(d);
  const api = modeApi(d);
  registerDrawer(api);
  return api;
}
