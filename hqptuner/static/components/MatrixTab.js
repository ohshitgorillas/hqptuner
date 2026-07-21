// Matrix tab — READ-ONLY phase (matrix-spec §8 delivery order: rendering lands
// before editing). Global + Profile cards share the top row; pipelines render
// as signal-flow chip rows (source → stages → gain → target). Editing, the
// stage editor, import, and plots are later phases — nothing here stages edits.
import { html } from "../store/dom.js";
import { matrixByName, matrixRows, matrixProfiles, matrixActiveProfile } from "../store/state.js";
import { parseProcess, stageLabel } from "../store/matrixspec.js";

const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

function field(name) {
  return matrixByName.value[name] || null;
}

// A select field's human label for its current value (e.g. engine 1 → overlap-add).
function optionLabel(f) {
  if (!f) return "—";
  const opt = (f.options || []).find((o) => String(o.value) === String(f.value));
  return opt ? opt.label : String(f.value ?? "—");
}

function onOff(f) {
  return f ? (truthy(f.value) ? "On" : "Off") : "—";
}

function ReadRow({ label, value }) {
  return html`<div class="mtx-read-row"><dt>${label}</dt><dd>${value}</dd></div>`;
}

const IIR2FIR = { 0: "Off (keep parametric)", 1: "Direct (minimum-phase)", 2: "Linear-phase" };

function GlobalCard() {
  const iir = field("iir2fir");
  return html`
    <section class="card">
      <div class="card-head">Matrix</div>
      <div class="card-body">
        <dl class="mtx-read">
          <${ReadRow} label="Enabled" value=${onOff(field("enabled"))} />
          <${ReadRow} label="Engine" value=${optionLabel(field("engine"))} />
          <${ReadRow} label="Expand HF" value=${onOff(field("expand_hf"))} />
          <${ReadRow} label="IIR to FIR" value=${iir ? IIR2FIR[iir.value] || optionLabel(iir) : "—"} />
        </dl>
      </div>
    </section>
  `;
}

function ProfileCard() {
  const active = matrixActiveProfile.value;
  const saved = matrixProfiles.value;
  return html`
    <section class="card">
      <div class="card-head">Profile</div>
      <div class="card-body">
        <dl class="mtx-read">
          <${ReadRow} label="Active" value=${active} />
          <${ReadRow} label="Saved" value=${saved.length ? saved.join(" · ") : "none"} />
        </dl>
        <div class="field-note">Profile switching and editing land in a later phase — this tab is read-only.</div>
      </div>
    </section>
  `;
}

const STAGE_CLASS = { iir: "iir", conv: "conv", delay: "plug", riaa: "plug" };

function Chip({ kind, children, title }) {
  return html`<span class="pchip pchip-${kind}" title=${title || null}>${children}</span>`;
}

function Arrow() {
  return html`<span class="pconn" aria-hidden="true">→</span>`;
}

// One pipeline as a signal-flow row. `summing` marks a target channel fed by
// more than one pipeline (outputs mix together, manual §7).
function FlowRow({ row, summing }) {
  const stages = parseProcess(row.process);
  const gain = `${row.gain ?? "0"} ${row.gainunit || "dB"}`;
  return html`
    <div class="mtx-flow">
      <span class="mtx-flow-idx">${row.index + 1}</span>
      <${Chip} kind="ch">In ${Number(row.source) + 1}<//>
      <${Arrow} />
      ${stages.map(
        (s) => html`
          <${Chip} kind=${STAGE_CLASS[s.kind] || "plug"} title=${s.raw}>${stageLabel(s)}<//>
          <${Arrow} />
        `,
      )}
      <${Chip} kind="gain">${gain}<//>
      <${Arrow} />
      <${Chip} kind="ch">Out ${Number(row.mixdown) + 1}${summing ? html`<span class="psum" title="mixed with other pipelines on this output">Σ</span>` : null}<//>
    </div>
  `;
}

function PipelinesCard() {
  const rows = matrixRows.value;
  const perTarget = {};
  for (const r of rows) perTarget[r.mixdown] = (perTarget[r.mixdown] || 0) + 1;
  return html`
    <section class="card">
      <div class="card-head">
        Pipelines <span class="mtx-count">${rows.length} / 128</span>
      </div>
      <div class="card-body">
        ${rows.length
          ? rows.map((r) => html`<${FlowRow} row=${r} summing=${perTarget[r.mixdown] > 1} />`)
          : html`<div class="field-note">No pipelines — matrix form not loaded.</div>`}
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
