// The docked inline stage editor — step 4 of the delivery order (matrix-spec
// §8). Selecting a stage chip outlines it and docks this panel under its row (no
// modal). Split out of MatrixTab.js verbatim; `convDraft` and `uploadNote` are
// private to this module, and `setSelected` lives here because clearing the
// draft is exactly what it is for.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { registerIr } from "../lib/dsp.js";
import { IIR_TYPES, DELAY_ARGS, validateStage, newStage, editedStage } from "../lib/matrixspec.js";
import { selectedStage } from "./BandStrip.js";
import { hz } from "../lib/units.js";

// selection: {row, stage} of the docked editor — the shared signal from
// MatrixPlot, so the selected chip's plot dot highlights in step.
const selected = selectedStage;
// A conv stage with no file serializes to an empty raw and would vanish from
// the process string — so a kind-switch to convolution holds a DRAFT here (the
// old stage stays in the string) until the first file path commits it.
const convDraft = signal(null); // {row, stage} awaiting a file

export function setSelected(v) {
  selected.value = v;
  convDraft.value = null;
}

function ArgInput({ label, value, onInput }) {
  return html`
    <label class="mtx-arg">
      <span>${label}</span>
      <input type="text" value=${value ?? ""} onChange=${(e) => onInput(e.target.value)} />
    </label>
  `;
}

// Sniff a WAV header's sample rate (fmt chunk) for the 352.8 kHz recommendation
// (manual §7). Returns null for non-WAV/undetectable — no warning then.
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

function ConvEditor({ stage, commit }) {
  const onFile = async (e) => {
    const file = e.target.files[0];
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
      uploadNote.value = `upload failed: ${err.message}`;
    }
  };
  return html`
    <div class="mtx-editor-args">
      <label class="mtx-arg mtx-arg-wide">
        <span>file</span>
        <input type="text" value=${stage.file} onChange=${(e) => commit({ file: e.target.value })} />
      </label>
      <label class="mtx-upload">
        <input type="file" accept=".wav,.txt" onChange=${onFile} />
      </label>
      ${uploadNote.value ? html`<div class="mtx-issues">${uploadNote.value}</div>` : null}
    </div>
  `;
}

function IirEditor({ stage, commit }) {
  const type = stage.args.type || "";
  const schema = IIR_TYPES[type] || { args: [], oneOf: [] };
  const argNames = [...schema.args, ...(schema.oneOf || [])];
  return html`
    <div class="mtx-editor-args">
      <label class="mtx-arg">
        <span>type</span>
        <select value=${type} onChange=${(e) => commit({ type: e.target.value })}>
          ${Object.keys(IIR_TYPES).map((t) => html`<option value=${t}>${t}</option>`)}
        </select>
      </label>
      ${argNames.map((a) => html`<${ArgInput} label=${a} value=${stage.args[a]} onInput=${(v) => commit({ [a]: v })} />`)}
    </div>
  `;
}

function DelayEditor({ stage, commit }) {
  return html`
    <div class="mtx-editor-args">
      ${DELAY_ARGS.map((a) => html`<${ArgInput} label=${a} value=${stage.args[a]} onInput=${(v) => commit({ [a]: v })} />`)}
    </div>
  `;
}

function RiaaEditor({ stage, commit }) {
  return html`
    <div class="mtx-editor-args">
      <label class="mtx-arg">
        <span>subsonic</span>
        <select value=${stage.args.subsonic ?? "1"} onChange=${(e) => commit({ subsonic: e.target.value })}>
          <option value="1">on</option>
          <option value="0">off</option>
        </select>
      </label>
    </div>
  `;
}

const EDITORS = { conv: ConvEditor, iir: IirEditor, delay: DelayEditor, riaa: RiaaEditor };
const KINDS = [
  ["iir", "Parametric (IIR)"],
  ["delay", "Delay"],
  ["riaa", "RIAA"],
  ["conv", "Convolution"],
];

export function StageEditor({ stages, stageIndex, replaceStages }) {
  const committed = stages[stageIndex];
  if (!committed) return null;
  const sel = selected.value;
  const drafting = convDraft.value && sel && convDraft.value.row === sel.row && convDraft.value.stage === stageIndex;
  const stage = drafting ? { kind: "conv", file: "", raw: "" } : committed;
  const commit = (patch) => {
    convDraft.value = null; // a real edit lands the draft (or was never one)
    const base = drafting ? newStage("conv") : stage;
    replaceStages(stages.map((s, j) => (j === stageIndex ? editedStage(base, patch) : s)));
  };
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
        <select value=${stage.kind} onChange=${(e) => setKind(e.target.value)}>
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
