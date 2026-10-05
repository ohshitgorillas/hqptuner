// The picked pipeline's strip: one chip per stage group (a run of peak and shelf stages is one PEQ chip), `+` to add
// a stage, the gain last, `Raw` for the process string, `×` to remove the pipeline. Every removable chip carries its
// own ×. A crossfeed block's row is read locked: its chips pick but never remove, it takes no stage, and its Raw is
// read-only. A convolution stage is added by uploading its file. The decisions are model/shell/pipelines.js's.

import { useRef } from "preact/hooks";
import { html, TypedInput } from "../../../../lib/dom.js";
import { classNames } from "../../../../model/shell/format.js";
import { NEW_STAGE, chipText, groups, stageAt } from "../../../../model/shell/pipelines.js";
import { effectivePipelines } from "../../../../store/resolve.js";
import { pipelinesView, removePipeline, setRaw, setStages } from "../../../../store/faceplate/drawers/pipelines.js";
import { KINDS } from "./copy.js";
import { clearRaws, note, putRaw, raws } from "./state.js";
import { uploadFilter } from "./upload.js";
import { Menu } from "./parts.js";

/** @typedef {import("../../../../model/shell/pipelines.js").Pipe} Pipe */
/** @typedef {import("../../../../model/shell/pipelines.js").Stage} Stage */
/** @typedef {import("../../../../model/shell/pipelines.js").Group} Group */
/** @typedef {import("./state.js").Raw} Raw */
/** @typedef {import("./Output.js").Tab} Tab */
/** @typedef {{ currentTarget: HTMLInputElement }} InputEv */

/** A fresh stage of each kind, by kind. */
const FRESH = /** @type {Record<string, () => Stage>} */ (NEW_STAGE);

/**
 * A file stage for the path the daemon stored a file under: a REW / AutoEq text, else a convolution filter.
 *
 * @param {string} path
 * @returns {Stage}
 */
const fileStage = (path) => ({ kind: /\.txt$/i.test(path) ? "peqfile" : "conv", file: path });

/**
 * Stage pipeline `i`'s chain as `next`, and pick the chip (and band) stage `si` sits in.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {Stage[]} next
 * @param {number} si
 */
export function land(t, p, next, si) {
  setStages(t.cur.selPipe, next);
  const f = stageAt(groups({ ...p, stages: next }), si);
  t.put({ chip: Math.max(0, f.chip), band: f.band });
}

/**
 * Upload a filter and hand its stage to `put`, saying what happened.
 *
 * @param {File[]} files
 * @param {(st: Stage) => void} put
 */
export async function uploadStage(files, put) {
  const r = await uploadFilter(files[0]);
  note.value = r.note;
  if (r.path) put(fileStage(r.path));
}

/**
 * The strip in Raw: its process string, editable unless a block owns the row, and why it did not parse.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {number} i
 * @param {Raw} r
 */
function rawParts(t, p, i, r) {
  const commit = (/** @type {InputEv} */ e) => {
    const text = e.currentTarget.value;
    const error = setRaw(i, text);
    putRaw(i, { text, error });
    if (!error) t.put({ chip: 0, band: 0 });
  };
  return html`
    <${TypedInput}
      class="vfd praw"
      type="text"
      value=${r.text}
      spellcheck="false"
      readonly=${!!p.gen}
      disabled=${t.off}
      aria-label=${`Pipeline ${i + 1} process string`}
      onChange=${commit}
    />
    ${r.error ? html`<span class="gr prerr">${r.error}</span>` : null}
  `;
}

/**
 * One chip: a pick target, and its own × unless it is the gain or a block's.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {Group} gr
 * @param {number} gi  its place in the strip
 */
function chip(t, p, gr, gi) {
  const i = t.cur.selPipe;
  const locked = !!p.gen && (gr.kind === "gain" || !!p.stages[gr.idx[0]]?.blk);
  const cls = classNames("chip", `k-${gr.kind}`, gi === t.cur.chip && "sel", locked && "lock");
  const text = chipText(p, gr);
  const pick = () => t.put({ chip: gi, band: 0 });
  if (p.gen || gr.kind === "gain") {
    return html`<button type="button" class=${cls} data-chip=${String(gi)} disabled=${t.off} onClick=${pick}>${text}</button>`;
  }
  const remove = () => {
    setStages(
      i,
      p.stages.filter((_, k) => !gr.idx.includes(k)),
    );
    putRaw(i, null);
    t.put({ chip: gi < t.cur.chip ? t.cur.chip - 1 : t.cur.chip, band: 0 });
  };
  return html`
    <span class=${classNames(cls, "chipw")} data-chip=${String(gi)}>
      <button type="button" class="chipl" disabled=${t.off} onClick=${pick}>${text}</button>
      <button
        type="button"
        class="chipx"
        aria-label=${`Remove ${text}`}
        data-testid="pl-chipx"
        data-chip=${String(gi)}
        disabled=${t.off}
        onClick=${remove}
      >
        ×
      </button>
    </span>
  `;
}

/**
 * The strip's chips: one per stage group, `+` to add a stage, the gain last.
 *
 * @param {{ t: Tab, p: Pipe }} props
 */
function Chips({ t, p }) {
  const file = useRef(/** @type {HTMLInputElement | null} */ (null));
  const gs = groups(p);
  const append = (/** @type {Stage} */ st) => {
    const now = pipelinesView().pipes[t.cur.selPipe] ?? p;
    land(t, now, [...now.stages, st], now.stages.length);
  };
  const addKind = (/** @type {string} */ k) => (k === "conv" ? file.current?.click() : append(FRESH[k]()));
  const picked = (/** @type {InputEv} */ e) => {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = "";
    if (files.length) uploadStage(files, append);
  };
  return html`
    <div class="pchips">
      ${gs.slice(0, -1).map((gr, gi) => chip(t, p, gr, gi))}
      ${
        p.gen
          ? null
          : html`
            <${Menu}
              id=${`pl-addstage-${t.o}`}
              aria="Add a stage"
              rows=${KINDS.map((k) => [k.label, () => addKind(k.k)])}
              off=${t.off}
            />
            <input ref=${file} type="file" accept=".wav,.txt" hidden onChange=${picked} />
          `
      }
      <span class="pwire"></span>
    </div>
    ${chip(t, p, gs[gs.length - 1], gs.length - 1)}
  `;
}

/**
 * The picked pipeline's strip.
 *
 * @param {{ t: Tab, p: Pipe }} props
 */
export function Strip({ t, p }) {
  const i = t.cur.selPipe;
  const r = raws.value[i];
  const toggle = () => putRaw(i, r ? null : { text: effectivePipelines.value[i]?.process ?? "", error: "" });
  const drop = () => {
    removePipeline(i);
    clearRaws();
    t.put({ selPipe: -1 });
  };
  return html`
    <div class="pstrip ped">
      <span class="ppn">#${i + 1}</span>
      ${r ? rawParts(t, p, i, r) : html`<${Chips} t=${t} p=${p} />`}
      <button
        type="button"
        class="btn xs praw-t"
        aria-pressed=${String(!!r)}
        data-testid="pl-raw"
        disabled=${t.off}
        onClick=${toggle}
      >
        Raw
      </button>
      ${
        p.gen
          ? null
          : html`<button
            type="button"
            class="round px"
            aria-label=${`Remove pipeline ${i + 1}`}
            disabled=${t.off}
            onClick=${drop}
          >
            ×
          </button>`
      }
    </div>
  `;
}
