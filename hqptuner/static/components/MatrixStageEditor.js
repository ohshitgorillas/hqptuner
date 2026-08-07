// The docked inline stage editor — step 4 of the delivery order (matrix-spec
// §8). Selecting a stage chip outlines it and docks this panel under its row (no
// modal). Split out of MatrixTab.js verbatim; `convDraft` and `uploadNote` are
// private to this module, and `setSelected` lives here because clearing the
// draft is exactly what it is for.
import { signal } from "@preact/signals";
import { html, wheelGuard } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { errText } from "../lib/errtext.js";
import { registerIr } from "../lib/dsp/impulse.js";
import { IIR_TYPES, DELAY_ARGS, validateStage, newStage, editedStage, stageArgs } from "../lib/matrixspec.js";
import { selectedStage } from "./BandStrip.js";
import { hz } from "../lib/units.js";

/**
 * @typedef {import("../lib/matrixspec.js").MatrixStage} MatrixStage
 * @typedef {import("../lib/matrixspec.js").IirSchema} IirSchema
 * @typedef {{ row: number, stage: number }} StageRef
 *   Which stage the editor is docked under: pipeline row, then index within
 *   that row's parsed chain.
 * @typedef {(patch: Record<string, string>) => void} Commit
 *   Land an argument patch on the edited stage (or `file` on a conv stage) —
 *   the same patch shape lib/matrixspec.js editedStage takes.
 * @typedef {(props: { stage: MatrixStage, commit: Commit }) => unknown} EditorFn
 *   One per-kind editor body, dispatched on the stage's kind.
 */

// selection: {row, stage} of the docked editor — the shared signal from
// MatrixPlot, so the selected chip's plot dot highlights in step.
const selected = selectedStage;
// A conv stage with no file serializes to an empty raw and would vanish from
// the process string — so a kind-switch to convolution holds a DRAFT here (the
// old stage stays in the string) until the first file path commits it.
const convDraft = signal(null); // {row, stage} awaiting a file

/** @param {StageRef | null} v */
export function setSelected(v) {
  selected.value = v;
  convDraft.value = null;
}

/** @param {{ label: string, value: string | undefined, onInput: (v: string) => void }} props */
function ArgInput({ label, value, onInput }) {
  return html`
    <label class="mtx-arg">
      <span>${label}</span>
      <input
        type="text"
        value=${value ?? ""}
        onChange=${(/** @type {{ target: HTMLInputElement }} */ e) => onInput(e.target.value)}
      />
    </label>
  `;
}

// Sniff a WAV header's sample rate (fmt chunk) for the 352.8 kHz recommendation
// (manual §7). Returns null for non-WAV/undetectable — no warning then.
/**
 * @param {File} file
 * @returns {Promise<number | null>}
 */
async function wavSampleRate(file) {
  try {
    const buf = new DataView(await file.slice(0, 64).arrayBuffer());
    if (buf.getUint32(0, false) !== 0x52494646 || buf.getUint32(8, false) !== 0x57415645) return null;
    let off = 12;
    while (off + 8 < buf.byteLength) {
      if (buf.getUint32(off, false) === 0x666d7420) return buf.getUint32(off + 12, true);
      off += 8 + buf.getUint32(off + 4, true);
    }
  } catch {
    /* unreadable — skip the warning */
  }
  return null;
}

const uploadNote = signal("");

/** @param {{ stage: MatrixStage, commit: Commit }} props */
function ConvEditor({ stage, commit }) {
  const onFile = async (/** @type {{ target: HTMLInputElement }} */ e) => {
    // `files` is null on an input that is not type=file; this one always is
    const file = (e.target.files || [])[0];
    if (!file) return;
    uploadNote.value = "uploading…";
    try {
      const r = await api.uploadFilter(file);
      const sr = await wavSampleRate(file);
      registerIr(r.path, await file.arrayBuffer()); // enables the client-side response preview
      uploadNote.value =
        sr && sr !== 352800 ? `uploaded · ${hz(sr, 1)} — 352.8 kHz is recommended for full-band use` : "uploaded";
      commit({ file: r.path });
    } catch (err) {
      uploadNote.value = `upload failed: ${errText(err)}`;
    }
  };
  return html`
    <div class="mtx-editor-args">
      <label class="mtx-arg mtx-arg-wide">
        <span>file</span>
        <input
          type="text"
          value=${stage.file}
          onChange=${(/** @type {{ target: HTMLInputElement }} */ e) => commit({ file: e.target.value })}
        />
      </label>
      <label class="mtx-upload">
        <input type="file" accept=".wav,.txt" onChange=${onFile} />
      </label>
      ${uploadNote.value ? html`<div class="mtx-issues">${uploadNote.value}</div>` : null}
    </div>
  `;
}

/** @param {{ stage: MatrixStage, commit: Commit }} props */
function IirEditor({ stage, commit }) {
  const type = stageArgs(stage).type || "";
  const schema = /** @type {Record<string, IirSchema>} */ (IIR_TYPES)[type] || { args: [], oneOf: [] };
  const argNames = [...schema.args, ...(schema.oneOf || [])];
  return html`
    <div class="mtx-editor-args">
      <label class="mtx-arg">
        <span>type</span>
        <select
          value=${type}
          onWheel=${wheelGuard}
          onChange=${(/** @type {{ target: HTMLSelectElement }} */ e) => commit({ type: e.target.value })}
        >
          ${Object.keys(IIR_TYPES).map((t) => html`<option value=${t}>${t}</option>`)}
        </select>
      </label>
      ${argNames.map(
        (a) =>
          html`<${ArgInput}
            label=${a}
            value=${stageArgs(stage)[a]}
            onInput=${(/** @type {string} */ v) => commit({ [a]: v })}
          />`,
      )}
    </div>
  `;
}

/** @param {{ stage: MatrixStage, commit: Commit }} props */
function DelayEditor({ stage, commit }) {
  return html`
    <div class="mtx-editor-args">
      ${DELAY_ARGS.map(
        (a) =>
          html`<${ArgInput}
            label=${a}
            value=${stageArgs(stage)[a]}
            onInput=${(/** @type {string} */ v) => commit({ [a]: v })}
          />`,
      )}
    </div>
  `;
}

/** @param {{ stage: MatrixStage, commit: Commit }} props */
function RiaaEditor({ stage, commit }) {
  return html`
    <div class="mtx-editor-args">
      <label class="mtx-arg">
        <span>subsonic</span>
        <select
          value=${stageArgs(stage).subsonic ?? "1"}
          onWheel=${wheelGuard}
          onChange=${(/** @type {{ target: HTMLSelectElement }} */ e) => commit({ subsonic: e.target.value })}
        >
          <option value="1">on</option>
          <option value="0">off</option>
        </select>
      </label>
    </div>
  `;
}

/** @type {Record<string, EditorFn>} */
const EDITORS = { conv: ConvEditor, iir: IirEditor, delay: DelayEditor, riaa: RiaaEditor };
const KINDS = [
  ["iir", "Parametric (IIR)"],
  ["delay", "Delay"],
  ["riaa", "RIAA"],
  ["conv", "Convolution"],
];

/**
 * @param {{ stages: MatrixStage[], stageIndex: number, replaceStages: (stages: MatrixStage[]) => void }} props
 */
export function StageEditor({ stages, stageIndex, replaceStages }) {
  const committed = stages[stageIndex];
  if (!committed) return null;
  const sel = selected.value;
  const drafting = convDraft.value && sel && convDraft.value.row === sel.row && convDraft.value.stage === stageIndex;
  const stage = drafting ? { kind: "conv", file: "", raw: "" } : committed;
  /** @type {Commit} */
  const commit = (patch) => {
    convDraft.value = null; // a real edit lands the draft (or was never one)
    const base = drafting ? newStage("conv") : stage;
    replaceStages(stages.map((s, j) => (j === stageIndex ? editedStage(base, patch) : s)));
  };
  /** @param {string} kind */
  const setKind = (kind) => {
    if (kind === stage.kind) return;
    if (kind === "conv") {
      // no file yet — an empty conv raw would vanish from the string; draft it
      convDraft.value = { row: sel.row, stage: stageIndex };
      return;
    }
    convDraft.value = null;
    replaceStages(stages.map((s, j) => (j === stageIndex ? editedStage(newStage(kind), {}) : s)));
  };
  const remove = () => {
    setSelected(null);
    replaceStages(stages.filter((_, j) => j !== stageIndex));
  };
  const issues = validateStage(stage);
  const Editor = EDITORS[stage.kind];
  return html`
    <div class="mtx-editor">
      <div class="mtx-editor-head">
        <select
          value=${stage.kind}
          onWheel=${wheelGuard}
          onChange=${(/** @type {{ target: HTMLSelectElement }} */ e) => setKind(e.target.value)}
        >
          ${KINDS.map(([k, label]) => html`<option value=${k}>${label}</option>`)}
        </select>
        <button type="button" class="mtx-tool mtx-remove" title="Delete stage" onClick=${remove}>✕ stage</button>
      </div>
      <${Editor} stage=${stage} commit=${commit} />
      ${issues.length ? html`<div class="mtx-issues">${issues.join(" · ")}</div>` : null}
      <div class="mtx-editor-raw"><span>spec</span><code>${stage.raw !== undefined ? stage.raw : ""}</code></div>
    </div>
  `;
}
