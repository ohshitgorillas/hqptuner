// The DSP pipelines drawer's output tab: everything feeding one output, one input at a time. An input switch (each
// input feeding it with its count, `+` adding one that does not yet), `+ Pipeline`, that input's pipelines as a fixed
// page of lines with page buttons (a crossfeed block folds to one line); under the list the picked pipeline's strip
// and its stage dock, then the plot. The whole tab grays, its reason legible, while the matrix engine is bypassed.
//
// Every output tab mounts this one block, and it draws the output its own tab names (`out<n>`): it finds its panel
// once mounted, and draws only while that panel's tab is the one shown. Until it has found it (server rendered, or the
// first paint) it draws the shown tab's output.

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { html } from "../../../../lib/dom.js";
import { classNames } from "../../../../model/shell/format.js";
import { PAGE, crosspoint, listItems, outputView } from "../../../../model/shell/pipelines.js";
import { shownTab } from "../../../../store/faceplate/drawer.js";
import { addPipeline, chName, chShort, pipelinesView } from "../../../../store/faceplate/drawers/pipelines.js";
import { openBlocks, putSel, selOf } from "./state.js";
import { Menu, Seg } from "./parts.js";
import { List } from "./List.js";
import { Strip } from "./Strip.js";
import { Dock } from "./Dock.js";
import { PlotPanel } from "./Plot.js";

/** @typedef {import("../../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("./state.js").Sel} Sel */
/** @typedef {ReturnType<typeof pipelinesView>} View */
/** @typedef {ReturnType<typeof outputView>} OutputView */

/**
 * What an output tab's parts read: its output, the set's view and the output's, the picks as shown, how to change
 * them, and whether the tab is grayed.
 *
 * @typedef {object} Tab
 * @property {number} o
 * @property {View} v
 * @property {OutputView} ov
 * @property {Sel} cur
 * @property {(patch: Partial<Sel>) => void} put
 * @property {boolean} off
 */

/**
 * The output a tab id names, or null.
 *
 * @param {string | null} id
 * @returns {number | null}
 */
function outOf(id) {
  const m = /^out(\d+)$/.exec(id ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * `+ Pipeline`: a new pipeline on the input shown, picked, its page shown.
 *
 * @param {Tab} t
 */
function addHere(t) {
  const src = t.ov.src;
  if (src === null) return;
  const made = addPipeline(src, t.o);
  const lines = listItems(crosspoint(pipelinesView().pipes, src, t.o), openBlocks.value).length;
  t.put({ selPipe: made, chip: 0, band: 0, page: Math.floor((lines - 1) / PAGE) });
}

/**
 * The input switch, and `+` for an input not yet feeding this output.
 *
 * @param {Tab} t
 */
function inputSwitch(t) {
  const { ov, o } = t;
  const add = (/** @type {number} */ i) => {
    const made = addPipeline(i, o);
    t.put({ src: i, selPipe: made, page: 0, chip: 0, band: 0 });
  };
  return html`
    ${
      ov.ins.length
        ? html`<${Seg}
          aria="Input"
          cls="enum oinseg view"
          value=${String(ov.src)}
          options=${ov.ins.map((i, k) => ({ v: String(i), label: `${chShort(i)} · ${ov.counts[k]}` }))}
          onChange=${(/** @type {string} */ val) => t.put({ src: Number(val), selPipe: -1, page: 0 })}
          off=${t.off}
        />`
        : html`<span class="cap">—</span>`
    }
    ${
      ov.others.length > 0
        ? html`<${Menu}
          id=${`pl-addin-${o}`}
          aria="Add an input"
          rows=${ov.others.map((i) => [`In ${chShort(i)} — ${chName(i)}`, () => add(i)])}
          off=${t.off}
        />`
        : null
    }
  `;
}

/**
 * One output's tab body.
 *
 * @param {{ o: number }} props
 */
function OutTab({ o }) {
  const v = pipelinesView();
  const sel = selOf(o);
  const ov = outputView(v.pipes, v.nIn, o, {
    src: sel.src,
    selPipe: sel.selPipe,
    page: sel.page,
    open: openBlocks.value,
  });
  /** @type {Sel} */
  const cur = { ...sel, src: ov.src, selPipe: ov.selPipe, page: ov.paging.page };
  if (ov.reselect) Object.assign(cur, { chip: 0, band: 0 });
  /** @type {Tab} */
  const t = { o, v, ov, cur, put: (patch) => putSel(o, { ...cur, ...patch }), off: !!v.gray };
  const dim = t.off ? "grayed" : undefined;
  const p = v.pipes[cur.selPipe];
  return html`
    <div class="ohead">
      <span class=${classNames("cl", dim)}>In</span>
      <div class=${classNames("oin", dim)}>${inputSwitch(t)}</div>
      <span class="grow"></span>
      ${t.off ? html`<span class="gr">${v.gray}</span>` : null}
      <button
        type="button"
        class=${classNames("btn xs", dim)}
        disabled=${t.off || ov.src === null}
        onClick=${() => addHere(t)}
      >
        + Pipeline
      </button>
    </div>
    <div class=${classNames("olist", dim)}><${List} t=${t} /></div>
    <div class=${classNames("pedit", dim)}>
      <div class="pstrips">${p ? html`<${Strip} t=${t} p=${p} />` : null}</div>
      <${Dock} t=${t} p=${p} />
    </div>
    <${PlotPanel} t=${t} p=${p} dim=${dim} />
  `;
}

/**
 * An output tab of the DSP pipelines drawer.
 *
 * @param {{ schema: DrawerSchema }} props
 */
export function PipelinesOutput({ schema }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [own, setOwn] = useState(/** @type {string | null} */ (null));
  useLayoutEffect(() => {
    const id = ref.current?.closest(".dpanel")?.getAttribute("data-tab") ?? null;
    if (id !== own) setOwn(id);
  });
  const shown = shownTab(schema);
  const o = outOf(own ?? shown);
  const body = o !== null && (own === null || own === shown) ? html`<${OutTab} o=${o} />` : null;
  return html`<div class="oout" ref=${ref} hidden=${!body}>${body}</div>`;
}
