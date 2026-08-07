// One pipeline row of the Matrix tab — step 3 of the delivery order
// (matrix-spec §8): In → stages → gain → Out, plus the per-row tool cluster and
// the raw comma-string chain mode. The row's `{ }` toggle flips the chain half
// between chip view and an editable raw string, two-way synced on
// matrixspec.js's byte-identical round-trip; invalid raw input is committed
// verbatim and flagged — never dropped, never rewritten. Split out of
// MatrixTab.js verbatim; `rawRows` and `dragFrom` are private to this module.
import { signal } from "@preact/signals";
import { html, wheelGuard } from "../lib/dom.js";
import { parseProcess, serializeProcess, stageLabel, validateStage, newStage, editedStage } from "../lib/matrixspec.js";
import { rowToRewText } from "../lib/eqexport.js";
import { isPlotted, togglePlotted } from "./MatrixPlot.js";
import { selectedStage } from "./BandStrip.js";
import { StageEditor, setSelected } from "./MatrixStageEditor.js";

/**
 * @typedef {import("../lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../lib/matrixspec.js").MatrixStage} Stage
 * @typedef {(patch: Partial<PipelineRow>) => void} RowWriter
 *   Stages a partial edit of one pipeline row.
 * @typedef {(stages: Stage[]) => void} StageWriter
 *   Stages a whole replacement chain for one pipeline row.
 * @typedef {{ target: HTMLInputElement }} InputEv
 * @typedef {{ preventDefault: () => void }} Cancelable
 */

// Push text to the browser as a .txt download (the Export EQ tools). No server
// round-trip — the serialized REW text is built client-side. Shared with the
// Matrix tab's master export.
/**
 * Hands `text` to the browser as a .txt download under `filename`.
 *
 * @param {string} filename
 * @param {string} text
 * @returns {void}
 */
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const MAX_CH = 128;
export const CH_OPTIONS = Array.from({ length: MAX_CH }, (_, i) => i);

// selection: {row, stage} of the docked editor — the shared signal from
// MatrixPlot, so the selected chip's plot dot highlights in step.
// rawRows: row-index -> raw view
const selected = selectedStage;
const rawRows = signal({});
const dragFrom = signal(null); // {row, stage} of a chip drag in progress

/** @type {Record<string, string>} */
const STAGE_CLASS = { iir: "iir", conv: "conv", delay: "iir", riaa: "iir" };

const Arrow = () => html`<span class="pconn" aria-hidden="true">→</span>`;

/**
 * @param {{ value: string, prefix: string, onChange: (v: string) => void }} props
 */
function ChannelSelect({ value, prefix, onChange }) {
  return html`
    <select class="mtx-ch pchip-ch" value=${String(value)} onWheel=${wheelGuard} onChange=${(/** @type {InputEv} */ e) => onChange(e.target.value)}>
      ${CH_OPTIONS.map((i) => html`<option value=${String(i)}>${prefix} ${i + 1}</option>`)}
    </select>
  `;
}

/**
 * @param {{ stage: Stage, rowIndex: number, stageIndex: number, stages: Stage[],
 *           replaceStages: StageWriter }} props
 */
function StageChip({ stage, rowIndex, stageIndex, stages, replaceStages }) {
  const sel = selected.value;
  const isSel = sel && sel.row === rowIndex && sel.stage === stageIndex;
  const bad = validateStage(stage).length > 0;
  const onDrop = (/** @type {Cancelable} */ e) => {
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
      onDragOver=${(/** @type {Cancelable} */ e) => e.preventDefault()}
      onDrop=${onDrop}
      onClick=${() => setSelected(isSel ? null : { row: rowIndex, stage: stageIndex })}
    >
      ${stageLabel(stage)}
    </button>
  `;
}

/**
 * @param {{ row: PipelineRow, update: RowWriter }} props
 */
function RawEditor({ row, update }) {
  const commit = (/** @type {string} */ value) => update({ process: value });
  const issues = parseProcess(row.process).flatMap(validateStage);
  return html`
    <div class="mtx-raw">
      <input
        type="text"
        class="mtx-raw-input"
        value=${row.process}
        placeholder="iir:type=peak;f=1000;q=1;g=-3,impulse.wav"
        onChange=${(/** @type {InputEv} */ e) => commit(e.target.value)}
      />
      ${issues.length ? html`<div class="mtx-issues">${issues.join(" · ")}</div>` : null}
    </div>
  `;
}

// In → stages → gain → Out, left to right. The chain half flips between chip
// view and the raw comma-string on the row's own `{ }` toggle.
/**
 * @param {{ row: PipelineRow, index: number, raw: boolean, stages: Stage[], summing: boolean,
 *           update: RowWriter, replaceStages: StageWriter, addStage: () => void }} props
 */
function FlowChain({ row, index, raw, stages, summing, update, replaceStages, addStage }) {
  return html`
    <div class="mtx-flow">
      <${ChannelSelect} value=${row.source} prefix="In" onChange=${(/** @type {string} */ v) => update({ source: v })} />
      <${Arrow} />
      ${
        raw
          ? html`<${RawEditor} row=${row} update=${update} />`
          : stages.map(
              (s, j) => html`
                <${StageChip}
                  stage=${s}
                  rowIndex=${index}
                  stageIndex=${j}
                  stages=${stages}
                  replaceStages=${replaceStages}
                />
                <${Arrow} />
              `,
            )
      }
      ${
        raw
          ? html`<${Arrow} />`
          : html`
              <button type="button" class="mtx-add-stage" title="Add a processing stage" onClick=${addStage}>
                + stage
              </button>
              <${Arrow} />
            `
      }
      <span class="pchip pchip-gain mtx-gain">
        <input
          type="number"
          step="0.01"
          value=${row.gain}
          onWheel=${wheelGuard}
          onChange=${(/** @type {InputEv} */ e) => update({ gain: e.target.value })}
        />
        <select value=${row.gainunit} onWheel=${wheelGuard} onChange=${(/** @type {InputEv} */ e) => update({ gainunit: e.target.value })}>
          <option value="dB">dB</option>
          <option value="Lin">Lin</option>
        </select>
      </span>
      <${Arrow} />
      <${ChannelSelect} value=${row.mixdown} prefix="Out" onChange=${(/** @type {string} */ v) => update({ mixdown: v })} />
      ${summing ? html`<span class="psum" title="mixed with other pipelines on this output">Σ</span>` : null}
    </div>
  `;
}

// The per-row tool cluster, in render order: Import EQ, raw view, plot, clear,
// remove. Each explains its own disabled state in its title — a disabled tool
// with no reason reads as a hung one. `loaded` (is EQ text staged?) arrives as a
// prop for the same reason `importHere` does: the import signals are private to
// the Auto EQ card's module.
/**
 * @param {{ row: PipelineRow, index: number, loaded: boolean, importHere: () => void }} props
 */
function EqTools({ row, index, loaded, importHere }) {
  const eq = rowToRewText(row);
  return html`
    <button
      type="button"
      class="mtx-tool"
      disabled=${!loaded}
      title=${loaded ? "Append the loaded EQ to this pipeline" : "Load or paste EQ text first (Headphone AutoEQ card)"}
      onClick=${importHere}
    >
      Import EQ
    </button>
    <button
      type="button"
      class="mtx-tool"
      disabled=${!eq.count}
      title=${
        eq.count
          ? `Export this pipeline's EQ as REW / Equalizer APO text${
              eq.skipped.length ? ` (${eq.skipped.length} stage(s) not representable, omitted)` : ""
            }`
          : "No parametric EQ on this pipeline to export"
      }
      onClick=${() => downloadText(`hqptuner-pipeline-${index + 1}.txt`, eq.text)}
    >
      Export EQ
    </button>
  `;
}

/**
 * @param {{ row: PipelineRow, index: number, raw: boolean, canRemove: boolean, loaded: boolean,
 *           update: RowWriter, remove: () => void, toggleRaw: () => void, importHere: () => void }} props
 */
function RowTools({ row, index, raw, canRemove, loaded, update, remove, toggleRaw, importHere }) {
  const plotted = isPlotted(index);
  return html`
    <div class="mtx-row-tools">
      <${EqTools} row=${row} index=${index} loaded=${loaded} importHere=${importHere} />
      <button type="button" class="mtx-tool ${raw ? "active" : ""}" title="Edit the raw process string" onClick=${toggleRaw}>
        { }
      </button>
      <button
        type="button"
        class="mtx-tool ${plotted ? "active" : ""}"
        title="Plot this pipeline's response"
        onClick=${() => togglePlotted(index)}
      >
        ${plotted ? "◉" : "○"}
      </button>
      <button
        type="button"
        class="mtx-tool mtx-remove"
        disabled=${!row.process && Number(row.gain) === 0}
        title="Clear all processing stages and reset gain to 0 dB (keeps routing)"
        onClick=${() => {
          setSelected(null);
          update({ process: "", gain: "0", gainunit: "dB" });
        }}
      >
        ∅
      </button>
      <button
        type="button"
        class="mtx-tool mtx-remove"
        disabled=${!canRemove}
        title=${canRemove ? "Remove pipeline" : "At least one pipeline is required"}
        onClick=${remove}
      >
        ✕
      </button>
    </div>
  `;
}

/**
 * Renders one pipeline row — In → stage chain → gain → Out — with its tool cluster
 * and, when a chip is selected, the docked stage editor beneath it.
 *
 * @param {{ row: PipelineRow, index: number, dirty: boolean, summing: boolean, canRemove: boolean,
 *           eqLoaded: boolean, update: RowWriter, remove: () => void, importHere: () => void }} props
 */
export function FlowRow({ row, index, dirty, summing, canRemove, eqLoaded, update, remove, importHere }) {
  const stages = parseProcess(row.process);
  const raw = !!rawRows.value[index];
  const sel = selected.value;
  const editing = sel && sel.row === index && !raw;
  const replaceStages = (/** @type {Stage[]} */ next) => update({ process: serializeProcess(next) });
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
        <${FlowChain}
          row=${row}
          index=${index}
          raw=${raw}
          stages=${stages}
          summing=${summing}
          update=${update}
          replaceStages=${replaceStages}
          addStage=${addStage}
        />
        <${RowTools}
          row=${row}
          index=${index}
          raw=${raw}
          canRemove=${canRemove}
          loaded=${eqLoaded}
          update=${update}
          remove=${remove}
          toggleRaw=${toggleRaw}
          importHere=${importHere}
        />
      </div>
      ${editing ? html`<${StageEditor} stages=${stages} stageIndex=${sel.stage} replaceStages=${replaceStages} />` : null}
    </div>
  `;
}
