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
  refreshConfig,
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
import { parseEqText } from "../store/eqimport.js";
import { registerIr } from "../store/dsp.js";
import { notesVisible } from "../store/prefs.js";
import { MatrixPlot, plottedRows, togglePlotted } from "./MatrixPlot.js";
import { LibraryPicker, clearLibrarySelection } from "./MatrixLibrary.js";

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

// Profile card (step 5): the picker + Switch rides the live 4321 lane (zero
// reload — the one lane the "applies live" indicator is true for, probe
// findings); Load/Save-as-new/Delete ride the form lane, which reloads the
// engine ~3 s and is idle-gated server-side. A named Load also replaces the
// post-process state — captioned, since the daemon gives no warning.
const profileSel = signal(null); // picker value; null = follow the active profile
const profileNewName = signal("");
const profileBusy = signal("");
const profileNote = signal("");

async function profileAct(action, name) {
  profileBusy.value = action;
  profileNote.value = "";
  try {
    await api.matrixProfile(action, name);
    profileNote.value = action === "switch" ? `switched — live, no reload` : `${action} done`;
    if (action === "delete") profileSel.value = null;
    if (action === "save") profileNewName.value = "";
    await refreshConfig();
  } catch (e) {
    profileNote.value = `${action} failed: ${e.message}`;
  } finally {
    profileBusy.value = "";
  }
}

// Two lanes, two visually distinct rows (design-pass item 5): the primary row is
// the live 4321 switch (zero reload); the secondary row is the form-lane
// load/delete (~3 s engine reload, idle-gated). Captions sit BELOW their row at
// caption measure, gated by the Feature-descriptions toggle like every tab.
function ProfileCard() {
  const saved = matrixProfiles.value;
  const active = matrixActiveProfile.value;
  const sel = profileSel.value ?? (active === "[Default]" ? "" : active);
  const busy = profileBusy.value;
  const newName = profileNewName.value.trim();
  return html`
    <section class="card">
      <div class="card-head">Profile</div>
      <div class="card-body mtx-profile">
        <div class="mtx-read-row"><dt>Active</dt><dd>${active}</dd></div>
        <div class="mtx-profile-row mtx-profile-primary">
          <select value=${sel} disabled=${!!busy} onChange=${(e) => (profileSel.value = e.target.value)}>
            <option value="">[Default]</option>
            ${saved.map((n) => html`<option value=${n}>${n}</option>`)}
          </select>
          <button
            type="button"
            class="mtx-tool mtx-primary"
            disabled=${!!busy}
            title="Switch the running matrix to this profile — live, no engine reload"
            onClick=${() => profileAct("switch", sel)}
          >Switch</button>
          <span class="mtx-live-tag">live — no reload</span>
        </div>
        ${notesVisible.value
          ? html`<div class="field-note">Profiles can be switched at any time, during playback as well — no engine reload. The switch is live-only: the daemon reverts to its saved configuration on restart.</div>`
          : null}
        <div class="mtx-profile-row">
          <button type="button" class="mtx-tool" disabled=${!!busy} title="Load this saved profile into the matrix configuration (~3 s engine reload)" onClick=${() => profileAct("load", sel)}>Load</button>
          <button
            type="button"
            class="mtx-tool mtx-remove"
            disabled=${!!busy || !sel}
            title="Delete this saved profile"
            onClick=${() => profileAct("delete", sel)}
          >Delete</button>
        </div>
        ${notesVisible.value
          ? html`<div class="field-note">Load replaces the whole matrix context — pipelines <em>and</em> post-processing (~3 s engine reload, engine must be idle).</div>`
          : null}
        <div class="mtx-profile-row">
          <input
            type="text"
            placeholder="new profile name"
            value=${profileNewName.value}
            disabled=${!!busy}
            onInput=${(e) => (profileNewName.value = e.target.value)}
          />
          <button
            type="button"
            class="mtx-tool"
            disabled=${!!busy || !newName || saved.includes(newName)}
            title=${saved.includes(newName)
              ? "That name exists — the daemon silently ignores a save to an existing profile (delete it first)"
              : "Save the current matrix as a new profile"}
            onClick=${() => profileAct("save", newName)}
          >Save as new</button>
        </div>
        ${notesVisible.value
          ? html`<div class="field-note">Saves the current matrix as a new named profile. The daemon silently ignores a save to an existing name — delete the old profile first.</div>`
          : null}
        ${profileNote.value ? html`<div class="mtx-issues">${profileNote.value}</div>` : null}
      </div>
    </section>
  `;
}

// Single column — a .pack's two tracks inside a half-width card would starve
// the selects below their longest option (the "over ⌄" defect). Selects here
// are content-sized via .mtx-global.
function GlobalCard() {
  return html`
    <section class="card">
      <div class="card-head">Matrix</div>
      <div class="card-body">
        <div class="mtx-global">
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
      registerIr(r.path, await file.arrayBuffer()); // enables the client-side response preview
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
          <button
            type="button"
            class="mtx-tool ${plottedRows.value.has(index) ? "active" : ""}"
            title="Plot this pipeline's response"
            onClick=${() => togglePlotted(index)}
          >${plottedRows.value.has(index) ? "◉" : "○"}</button>
          <button
            type="button"
            class="mtx-tool mtx-remove"
            disabled=${!row.process && Number(row.gain) === 0}
            title="Clear all processing stages and reset gain to 0 dB (keeps routing)"
            onClick=${() => {
              setSelected(null);
              update({ process: "", gain: "0", gainunit: "dB" });
            }}
          >∅</button>
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

// --- Headphone AutoEQ card (step 6 + library pass) ---------------------------
// Standing collapsible card between PIPELINES and RESPONSE. Default collapsed —
// not everyone is listening to headphones. Two lanes: the AutoEq library picker
// (search → preview on RESPONSE → apply) and the paste/.txt import; both append
// the parsed iir stages to the target row(s) (+ optional stereo-pair mirror =
// the adjacent row) and map a Preamp line onto the row gain (dB) — one atomic
// stagePipelines op, Discard undoes it.
const eqCardOpen = signal(false);
const importText = signal("");
const importTarget = signal(0);
const importMirror = signal(true);
const importNote = signal("");

function doImport(rows) {
  const { preamp, stages, skipped } = parseEqText(importText.value);
  if (!stages.length) {
    importNote.value = `no filters found${skipped.length ? ` — ${skipped.length} line(s) skipped` : ""}`;
    return;
  }
  const target = Math.min(importTarget.value, rows.length - 1);
  const pair = importMirror.value && rows.length > 1 ? (target % 2 === 0 ? target + 1 : target - 1) : null;
  const targets = new Set(pair !== null && pair < rows.length ? [target, pair] : [target]);
  const addition = serializeProcess(stages);
  const next = rows.map((r, i) => {
    if (!targets.has(i)) return r;
    const process = r.process ? `${r.process},${addition}` : addition;
    return { ...r, process, ...(preamp !== null ? { gain: preamp, gainunit: "dB" } : {}) };
  });
  stagePipelines(next);
  importNote.value =
    `${stages.length} filter(s) → pipeline ${[...targets].map((i) => i + 1).join(" + ")}` +
    (preamp !== null ? `, preamp ${preamp} dB → gain` : "") +
    (skipped.length ? ` · skipped: ${skipped.join("; ")}` : "");
}

function ImportPanel({ rows }) {
  const onFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => (importText.value = t));
  };
  // Library apply routes through the EXACT paste path: the profile's verbatim
  // ParametricEQ.txt lands in the textarea and goes through doImport, so the
  // staged stages are identical to pasting the file (acceptance criterion).
  const applyText = (text) => {
    importText.value = text;
    doImport(rows);
  };
  return html`
    <div class="mtx-import">
      <${LibraryPicker} applyText=${applyText} />
      <textarea
        rows="5"
        placeholder=${"Paste an AutoEq ParametricEQ.txt or a REW Generic EQ export…\nFilter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41"}
        value=${importText.value}
        onInput=${(e) => (importText.value = e.target.value)}
      ></textarea>
      <div class="mtx-profile-row">
        <input type="file" accept=".txt" onChange=${onFile} />
        <select value=${String(importTarget.value)} onChange=${(e) => (importTarget.value = Number(e.target.value))}>
          ${rows.map((_, i) => html`<option value=${String(i)}>pipeline ${i + 1}</option>`)}
        </select>
        <label class="mtx-import-mirror">
          <input
            type="checkbox"
            checked=${importMirror.value}
            onChange=${(e) => (importMirror.value = e.target.checked)}
          />
          mirror to stereo pair
        </label>
        <button type="button" class="mtx-tool" disabled=${!importText.value.trim()} onClick=${() => doImport(rows)}>
          Import
        </button>
      </div>
      ${importNote.value ? html`<div class="mtx-issues">${importNote.value}</div>` : null}
    </div>
  `;
}

function HeadphoneEqCard() {
  const rows = effectivePipelines.value;
  const open = eqCardOpen.value;
  const toggle = () => {
    eqCardOpen.value = !open;
    if (open) clearLibrarySelection(); // collapsing drops selection + preview — no residue
  };
  return html`
    <section class="card">
      <button type="button" class="card-head mtx-eq-head" onClick=${toggle}>
        <span class="tri">${open ? "▾" : "▸"}</span> Headphone AutoEQ
      </button>
      ${open ? html`<div class="card-body"><${ImportPanel} rows=${rows} /></div>` : null}
    </section>
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
      <div class="card-head">
        Pipelines <span class="mtx-count">${rows.length} / ${MAX_CH}</span>
      </div>
      <div class="card-body">
        ${notesVisible.value
          ? html`<div class="field-note mtx-pipelines-note">Each pipeline copies a source channel through a chain of processing stages — filter impulse-response files (convolution) or iir / delay / riaa plugin specs — then applies gain and mixes into an output channel. Pipelines sharing an output channel are summed (Σ). Gain applies in dB or linear scale; negative linear factors invert polarity (e.g. for M/S processing).</div>`
          : null}
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
    <${HeadphoneEqCard} />
    <${MatrixPlot} />
  </section>`;
}
