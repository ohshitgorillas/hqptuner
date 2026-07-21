// Matrix tab — step 3 of the delivery order (matrix-spec §8): pipeline row
// editing + apply. Each pipeline renders in a bordered flow-row container:
// source select → stage chips (read-only until the step-4 stage editor) → gain
// (value + dB/Lin unit) → target select, with remove / inert add-stage / plot
// slot (disabled until step 7). Edits stage the whole set as one atomic
// canonical-JSON field (stagePipelines). Profile card stays read-only (step 5).
import { html } from "../store/dom.js";
import { Field } from "../store/Field.js";
import {
  matrixProfiles,
  matrixActiveProfile,
  pipelineBaseline,
  effectivePipelines,
  canonPipelines,
  stagePipelines,
} from "../store/state.js";
import { parseProcess, stageLabel } from "../store/matrixspec.js";

const MAX_CH = 128;
const CH_OPTIONS = Array.from({ length: MAX_CH }, (_, i) => i);

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

function Chip({ kind, children, title }) {
  return html`<span class="pchip pchip-${kind}" title=${title || null}>${children}</span>`;
}

const Arrow = () => html`<span class="pconn" aria-hidden="true">→</span>`;

function ChannelSelect({ value, prefix, onChange }) {
  return html`
    <select class="mtx-ch pchip-ch" value=${String(value)} onChange=${(e) => onChange(e.target.value)}>
      ${CH_OPTIONS.map((i) => html`<option value=${String(i)}>${prefix} ${i + 1}</option>`)}
    </select>
  `;
}

// One editable pipeline row in its bordered container. `update(patch)` stages
// the whole set with this row patched; stage chips are display-only this phase.
function FlowRow({ row, index, dirty, summing, canRemove, update, remove }) {
  const stages = parseProcess(row.process);
  return html`
    <div class="mtx-row ${dirty ? "dirty" : ""}">
      <span class="mtx-flow-idx">${index + 1}</span>
      <div class="mtx-flow">
        <${ChannelSelect} value=${row.source} prefix="In" onChange=${(v) => update({ source: v })} />
        <${Arrow} />
        ${stages.map(
          (s) => html`
            <${Chip} kind=${STAGE_CLASS[s.kind] || "iir"} title=${s.raw}>${stageLabel(s)}<//>
            <${Arrow} />
          `,
        )}
        <button
          type="button"
          class="mtx-add-stage"
          disabled
          title="Stage editing lands in the next phase"
        >+ stage</button>
        <${Arrow} />
        <span class="pchip pchip-gain mtx-gain">
          <input
            type="number"
            step="0.01"
            value=${row.gain}
            onChange=${(e) => update({ gain: e.target.value })}
          />
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
  `;
}

function PipelinesCard() {
  const rows = effectivePipelines.value;
  const baseline = pipelineBaseline.value;
  const perTarget = {};
  for (const r of rows) perTarget[r.mixdown] = (perTarget[r.mixdown] || 0) + 1;
  const rowDirty = (i) => canonPipelines([rows[i]]) !== canonPipelines(baseline[i] ? [baseline[i]] : []);
  const update = (i, patch) => stagePipelines(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => stagePipelines(rows.filter((_, j) => j !== i));
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
