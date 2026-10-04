// The stage dock under the strip. One shape for every stage, read top to bottom under its chip (the chip names the
// stage, so no title):
//   row 1  what it is   (stage kind, band stepper, filter type, unit) ··· a locked stage's owner at the right end
//   row 2  its values   (labelled boxes with their units, in wire order)
//   copy   what they mean, full width under the controls it explains
// Hidden without a picked pipeline, or while its strip is in Raw. A crossfeed block's stage is read-only. The editors
// for each kind are editors.js's; which chip and band it docks on, and whether it is locked, is
// model/shell/pipelines-edit.js's `dockState`.

import { useRef } from "preact/hooks";
import { html } from "../../../../lib/dom.js";
import { NEW_STAGE } from "../../../../model/shell/pipelines.js";
import { dockState, lockedFields } from "../../../../model/shell/pipelines-edit.js";
import { setGain, setStages } from "../../../../store/faceplate/drawers/pipelines.js";
import { BLOCK_NAME, DELAY_ARGS, IIR_TYPES, KINDS, PMAN } from "./copy.js";
import { note, raws } from "./state.js";
import { land, uploadStage } from "./Strip.js";
import { delayEditor, fileDock, gainDock, iirEditor, riaaDock } from "./editors.js";
import { lab, paras, tline } from "./parts.js";
import { Xref } from "../../Xref.js";

/** @typedef {import("../../../../model/shell/pipelines.js").Pipe} Pipe */
/** @typedef {import("../../../../model/shell/pipelines.js").Stage} Stage */
/** @typedef {import("../../../../model/shell/pipelines.js").Group} Group */
/** @typedef {import("./editors.js").DockParts} DockParts */
/** @typedef {import("./Output.js").Tab} Tab */
/** @typedef {ReturnType<typeof dockState>} DockState */
/** @typedef {{ currentTarget: HTMLSelectElement }} SelectEv */

/** A fresh stage of each kind, by kind. */
const FRESH = /** @type {Record<string, () => Stage>} */ (NEW_STAGE);

/**
 * Pipeline `p`'s chain with stage `si` replaced.
 *
 * @param {Pipe} p
 * @param {number} si
 * @param {Stage} st
 */
const swapped = (p, si, st) => p.stages.map((s, k) => (k === si ? st : s));

/**
 * The band stepper of a PEQ chip: ‹ ›, the band shown of how many, + and − a band.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {DockState} ds
 */
function bandNav(t, p, ds) {
  const nb = ds.bands;
  const idx = /** @type {Group} */ (ds.group).idx;
  const i = t.cur.selPipe;
  const step = (/** @type {number} */ k) => t.put({ band: (ds.band + k + nb) % nb });
  const addBand = () => {
    const next = [...p.stages];
    next.splice(idx[nb - 1] + 1, 0, FRESH.iir());
    setStages(i, next);
    t.put({ band: nb });
  };
  const dropBand = () => {
    setStages(
      i,
      p.stages.filter((_, k) => k !== ds.si),
    );
    t.put({ band: Math.max(0, ds.band - 1) });
  };
  return [
    lab("Band"),
    html`
      <div class="pbnav">
        <button type="button" class="round pbn" aria-label="Previous band" disabled=${t.off} onClick=${() => step(-1)}>‹</button>
        <span class="pbl">${ds.band + 1} / ${nb}</span>
        <button type="button" class="round pbn" aria-label="Next band" disabled=${t.off} onClick=${() => step(1)}>›</button>
        <button type="button" class="round pbn" aria-label="Add a band" disabled=${t.off} onClick=${addBand}>+</button>
        <button type="button" class="round pbn" aria-label=${`Remove band ${ds.band + 1}`} disabled=${t.off} onClick=${dropBand}>
          −
        </button>
      </div>
    `,
  ];
}

/**
 * The stage kind picker: a change puts a fresh stage of that kind in its place; a convolution's comes from an upload.
 *
 * @param {{ t: Tab, p: Pipe, si: number }} props
 */
function KindPicker({ t, p, si }) {
  const file = useRef(/** @type {HTMLInputElement | null} */ (null));
  const cur = p.stages[si].kind;
  const opts = KINDS.some((k) => k.k === cur) ? KINDS : [...KINDS, { k: cur, label: "PEQ file" }];
  const put = (/** @type {Stage} */ st) => land(t, p, swapped(p, si, st), si);
  const change = (/** @type {SelectEv} */ e) => {
    const k = e.currentTarget.value;
    e.currentTarget.value = cur;
    if (k === "conv") file.current?.click();
    else if (FRESH[k]) put(FRESH[k]());
  };
  const picked = (/** @type {{ currentTarget: HTMLInputElement }} */ e) => {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = "";
    if (files.length) uploadStage(files, put);
  };
  return html`
    <select class="vfd pkind" aria-label="Stage kind" disabled=${t.off} onChange=${change}>
      ${opts.map((k) => html`<option value=${k.k} selected=${k.k === cur}>${k.label}</option>`)}
    </select>
    <input ref=${file} type="file" accept=".wav,.txt" hidden onChange=${picked} />
  `;
}

/**
 * The dock of a stage the pipeline owns: its kind's editor.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {DockState} ds
 * @returns {DockParts}
 */
function editDock(t, p, ds) {
  const i = t.cur.selPipe;
  const gr = /** @type {Group} */ (ds.group);
  const st = p.stages[ds.si];
  const put = (/** @type {Stage} */ next) => setStages(i, swapped(p, ds.si, next));
  if (gr.kind === "gain") return gainDock(p, (g, u) => setGain(i, g, u), t.off);
  if (gr.kind === "peq" || gr.kind === "iir") {
    const e = iirEditor(st, put, t.off);
    return {
      what: [gr.kind === "peq" ? bandNav(t, p, ds) : null, lab("Type"), e.type],
      values: e.values,
      copy: e.copy,
    };
  }
  if (gr.kind === "delay") {
    const e = delayEditor(st, put, t.off);
    return { what: [lab("Given in"), e.unit], values: e.values, copy: [...e.copy, ...paras(PMAN.delay)] };
  }
  if (gr.kind === "riaa") return riaaDock(st, put, t.off);
  return fileDock(st, (files) => uploadStage(files, put), t.off, note.value);
}

/**
 * A read-only value.
 *
 * @param {string} text
 */
const ro = (text) => html`<span class="vfd pfile pro">${text}</span>`;

/** The chip kinds a locked stage reads as fields; any other reads as its file. */
const LOCKED_FIELDS = new Set(["gain", "delay", "iir"]);

/**
 * A locked gain or delay's one field: its label, its value as the wire gives it, its unit.
 *
 * @param {string} label
 * @param {{ value: string, unit: string }} lf
 */
const roField = (label, lf) =>
  html`<div class="pfield">${lab(label)} ${ro(lf.value)} <span class="u pu">${lf.unit}</span></div>`;

/**
 * The fields of a locked gain, delay or iir stage.
 *
 * @param {Pipe} p
 * @param {Group} gr
 * @returns {DockParts}
 */
function lockedParts(p, gr) {
  const lf = lockedFields(p, gr, { types: IIR_TYPES, delays: DELAY_ARGS });
  if (lf.kind === "gain") return { values: [roField("Gain", lf)], copy: paras(PMAN.gain) };
  if (lf.arg) return { values: [roField("Delay", lf)], copy: [tline(lf.arg.a, lf.arg.d), ...paras(PMAN.delay)] };
  const type = String(p.stages[gr.idx[0]].type ?? "");
  return {
    what: [lab("Type"), ro(lf.def ? `${lf.def.d}: ${lf.def.t}` : type)],
    values: [html`<div class="pfield">${lab("Arguments")} ${ro(lf.value)}</div>`],
    copy: [tline(type, PMAN.iirUnits)],
  };
}

/**
 * The dock of a stage a crossfeed block owns: read-only, its owner named at the right end as the link to Crossfeed.
 *
 * @param {Pipe} p
 * @param {Group} gr
 * @returns {DockParts}
 */
function lockedDock(p, gr) {
  const gen = p.gen ?? "";
  const right = html`<${Xref} to="crossfeed" label=${BLOCK_NAME[gen] ?? gen} />`;
  const parts = LOCKED_FIELDS.has(gr.kind) ? lockedParts(p, gr) : fileDock(p.stages[gr.idx[0]], null, false, "");
  return { ...parts, right };
}

/**
 * The dock's rows: what it is with its right end, its values, its copy.
 *
 * @param {unknown[]} what
 * @param {DockParts} d
 */
function rows(what, d) {
  const head = what.length || d.right ? html`<div class="pdr">${what}<span class="grow"></span>${d.right}</div>` : null;
  const values = d.values?.length ? html`<div class="pfields">${d.values}</div>` : null;
  return html`<div class="pdock">${head}${values}<div class="pdcopy">${d.copy}</div></div>`;
}

/**
 * The stage dock for the picked pipeline's picked chip.
 *
 * @param {{ t: Tab, p: Pipe | undefined }} props
 */
export function Dock({ t, p }) {
  const i = t.cur.selPipe;
  const ds = dockState(p, !!p && !!raws.value[i], t.cur.chip, t.cur.band);
  if (!p || !ds.shown) return html`<div class="pdock" hidden></div>`;
  const gr = /** @type {Group} */ (ds.group);
  const d = ds.locked ? lockedDock(p, gr) : editDock(t, p, ds);
  const picker = ds.picker ? [lab("Stage"), html`<${KindPicker} t=${t} p=${p} si=${gr.idx[0]} />`] : [];
  return rows([...picker, ...(d.what ?? [])].flat().filter(Boolean), d);
}
