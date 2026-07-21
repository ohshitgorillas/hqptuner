// Matrix tab — steps 3+4 of the delivery order (matrix-spec §8): pipeline row
// editing + the inline stage editor. Selecting a stage chip outlines it and
// docks an editor panel under its row (no modal); a per-row toggle flips the
// chain between chip view and an editable raw comma-string, two-way synced on
// matrixspec.js's byte-identical round-trip. Invalid raw input is committed
// verbatim and flagged — never dropped, never rewritten. Profile card stays
// read-only (step 5); plots stay reserved (step 7).
import { signal } from "@preact/signals";
import { html } from "../store/dom.js";
import { Field } from "../store/Field.js";
import { api } from "../store/api.js";
import {
  matrixProfiles,
  matrixActiveProfile,
  pipelineBaseline,
  effectivePipelines,
  canonPipelines,
  stagePipelines,
} from "../store/state.js";
import {
  parseProcess,
  serializeProcess,
  stageLabel,
  validateStage,
  newStage,
  editedStage,
  IIR_TYPES,
  DELAY_ARGS,
} from "../store/matrixspec.js";

const MAX_CH = 128;
const CH_OPTIONS = Array.from({ length: MAX_CH }, (_, i) => i);

// selection: {row, stage} of the docked editor; rawRows: row-index -> raw view
const selected = signal(null);
const rawRows = signal({});
const dragFrom = signal(null); // {row, stage} of a chip drag in progress
// A conv stage with no file serializes to an empty raw and would vanish from
// the process string — so a kind-switch to convolution holds a DRAFT here (the
// old stage stays in the string) until the first file path commits it.
const convDraft = signal(null); // {row, stage} awaiting a file

function setSelected(v) {
  selected.value = v;
  convDraft.value = null;
}

function ProfileCard() {
  const saved = matrixProfiles.value;
  return html`
    <section class="card">
      <div class="card-head">Profile</div>
      <div class="card-body">
        <dl class="mtx-read">
          <div class="mtx-read-row"><dt>Active</dt><dd>${matrixActiveProfile.value}</dd></div>
          <div class="mtx-read-row"><dt>Saved</dt><dd>${saved.length ? saved.join(" · ") : "none"}</dd></div>
        </dl>
        <div class="field-note">Profile switching lands in a later phase.</div>
      </div>
    </section>
  `;
}

function GlobalCard() {
  return html`
    <section class="card">
      <div class="card-head">Matrix</div>
      <div class="card-body">
        <div class="pack">
          <${Field} k="matrix_enabled" />
          <${Field} k="matrix_engine" />
          <${Field} k="matrix_expand_hf" />
          <${Field} k="matrix_iir2fir" />
        </div>
      </div>
    </section>
  `;
}

const STAGE_CLASS = { iir: "iir", conv: "conv", delay: "iir", riaa: "iir" };

const Arrow = () => html`<span class="pconn" aria-hidden="true">→</span>`;

function ChannelSelect({ value, prefix, onChange }) {
  return html`
    <select class="mtx-ch pchip-ch" value=${String(value)} onChange=${(e) => onChange(e.target.value)}>
      ${CH_OPTIONS.map((i) => html`<option value=${String(i)}>${prefix} ${i + 1}</option>`)}
    </select>
  `;
}

// --- stage editor panel ------------------------------------------------------

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
      uploadNote.value =
        sr && sr !== 352800
          ? `uploaded · ${(sr / 1000).toFixed(1)} kHz — 352.8 kHz is recommended for full-band use`
          : "uploaded";
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

function StageEditor({ stages, stageIndex, replaceStages }) {
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

// --- flow row ----------------------------------------------------------------

function StageChip({ stage, rowIndex, stageIndex, stages, replaceStages }) {
  const sel = selected.value;
  const isSel = sel && sel.row === rowIndex && sel.stage === stageIndex;
  const bad = validateStage(stage).length > 0;
  const onDrop = (e) => {
    e.preventDefault();
    const from = dragFrom.value;
    dragFrom.value = null;
    if (!from || from.row !== rowIndex || from.stage === stageIndex) return;
    const next = [...stages];
    const [moved] = next.splice(from.stage, 1);
    next.splice(stageIndex, 0, moved);
    setSelected(null);
    replaceStages(next);
  };
  return html`
    <button
      type="button"
      class="pchip pchip-${STAGE_CLASS[stage.kind] || "iir"} mtx-stage ${isSel ? "selected" : ""} ${bad ? "bad" : ""}"
      title=${stage.raw}
      draggable="true"
      onDragStart=${() => (dragFrom.value = { row: rowIndex, stage: stageIndex })}
      onDragOver=${(e) => e.preventDefault()}
      onDrop=${onDrop}
      onClick=${() => (setSelected(isSel ? null : { row: rowIndex, stage: stageIndex }))}
    >${stageLabel(stage)}</button>
  `;
}

function RawEditor({ row, update }) {
  const commit = (value) => update({ process: value });
  const issues = parseProcess(row.process).flatMap(validateStage);
  return html`
    <div class="mtx-raw">
      <input
        type="text"
        class="mtx-raw-input"
        value=${row.process}
        placeholder="iir:type=peak;f=1000;q=1;g=-3,impulse.wav"
        onChange=${(e) => commit(e.target.value)}
      />
      ${issues.length ? html`<div class="mtx-issues">${issues.join(" · ")}</div>` : null}
    </div>
  `;
}

function FlowRow({ row, index, dirty, summing, canRemove, update, remove }) {
  const stages = parseProcess(row.process);
  const raw = !!rawRows.value[index];
  const sel = selected.value;
  const editing = sel && sel.row === index && !raw;
  const replaceStages = (next) => update({ process: serializeProcess(next) });
  const addStage = () => {
    const next = [...stages, editedStage(newStage("iir"), {})];
    replaceStages(next);
    setSelected({ row: index, stage: next.length - 1 });
  };
  const toggleRaw = () => {
    setSelected(null);
    rawRows.value = { ...rawRows.value, [index]: !raw };
  };
  return html`
    <div class="mtx-row ${dirty ? "dirty" : ""}">
      <div class="mtx-row-main">
        <span class="mtx-flow-idx">${index + 1}</span>
        <div class="mtx-flow">
          <${ChannelSelect} value=${row.source} prefix="In" onChange=${(v) => update({ source: v })} />
          <${Arrow} />
          ${raw
            ? html`<${RawEditor} row=${row} update=${update} />`
            : stages.map(
                (s, j) => html`
                  <${StageChip} stage=${s} rowIndex=${index} stageIndex=${j} stages=${stages} replaceStages=${replaceStages} />
                  <${Arrow} />
                `,
              )}
          ${raw
            ? html`<${Arrow} />`
            : html`
                <button type="button" class="mtx-add-stage" title="Add a processing stage" onClick=${addStage}>+ stage</button>
                <${Arrow} />
              `}
          <span class="pchip pchip-gain mtx-gain">
            <input type="number" step="0.01" value=${row.gain} onChange=${(e) => update({ gain: e.target.value })} />
            <select value=${row.gainunit} onChange=${(e) => update({ gainunit: e.target.value })}>
              <option value="dB">dB</option>
              <option value="Lin">Lin</option>
            </select>
          </span>
          <${Arrow} />
          <${ChannelSelect} value=${row.mixdown} prefix="Out" onChange=${(v) => update({ mixdown: v })} />
          ${summing ? html`<span class="psum" title="mixed with other pipelines on this output">Σ</span>` : null}
        </div>
        <div class="mtx-row-tools">
          <button type="button" class="mtx-tool ${raw ? "active" : ""}" title="Edit the raw process string" onClick=${toggleRaw}>{ }</button>
          <button type="button" class="mtx-tool" disabled title="Response plots land in a later phase">∿</button>
          <button
            type="button"
            class="mtx-tool mtx-remove"
            disabled=${!canRemove}
            title=${canRemove ? "Remove pipeline" : "At least one pipeline is required"}
            onClick=${remove}
          >✕</button>
        </div>
      </div>
      ${editing ? html`<${StageEditor} stages=${stages} stageIndex=${sel.stage} replaceStages=${replaceStages} />` : null}
    </div>
  `;
}

function PipelinesCard() {
  const rows = effectivePipelines.value;
  const baseline = pipelineBaseline.value;
  const perTarget = {};
  for (const r of rows) perTarget[r.mixdown] = (perTarget[r.mixdown] || 0) + 1;
  const rowDirty = (i) => canonPipelines([rows[i]]) !== canonPipelines(baseline[i] ? [baseline[i]] : []);
  const update = (i, patch) => stagePipelines(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => {
    setSelected(null);
    stagePipelines(rows.filter((_, j) => j !== i));
  };
  const add = () => {
    const used = new Set(rows.map((r) => String(r.source)));
    const source = String(CH_OPTIONS.find((i) => !used.has(String(i))) ?? 0);
    stagePipelines([...rows, { source, gain: "0", gainunit: "dB", mixdown: source, process: "" }]);
  };
  return html`
    <section class="card">
      <div class="card-head">Pipelines <span class="mtx-count">${rows.length} / ${MAX_CH}</span></div>
      <div class="card-body">
        ${rows.map(
          (r, i) => html`
            <${FlowRow}
              row=${r}
              index=${i}
              dirty=${rowDirty(i)}
              summing=${perTarget[r.mixdown] > 1}
              canRemove=${rows.length > 1}
              update=${(patch) => update(i, patch)}
              remove=${() => remove(i)}
            />
          `,
        )}
        <button type="button" class="mtx-add-row" disabled=${rows.length >= MAX_CH} onClick=${add}>
          + Add pipeline
        </button>
      </div>
    </section>
  `;
}

export function MatrixTab() {
  return html`<section class="tab-body">
    <div class="card-grid">
      <${GlobalCard} />
      <${ProfileCard} />
    </div>
    <${PipelinesCard} />
  </section>`;
}
