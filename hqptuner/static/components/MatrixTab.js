// Matrix tab — the tab shell: the global matrix card, the pipeline list, and
// the Headphone Auto EQ card (steps 3+6 of the delivery order, matrix-spec §8).
// The pipeline row itself lives in MatrixFlowRow.js and the docked stage editor
// in MatrixStageEditor.js; the profile card (step 5) in MatrixProfileCard.js.
// Plots stay reserved (step 7).
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { Field } from "./Field.js";
import { pipelineBaseline, effectivePipelines, canonPipelines, stagePipelines } from "../store/state.js";
import { planEqImport } from "../lib/eqimport.js";
import { pipelinesToRewText } from "../lib/eqexport.js";
import { notesVisible } from "../store/prefs.js";
import { MatrixPlot, plottedRows } from "./MatrixPlot.js";
import { LibraryPicker, clearLibrarySelection } from "./MatrixLibrary.js";
import { XfeedBadge, xfeedBlock } from "./XfeedComp.js";
import { CrossfeedCard } from "./Crossfeed.js";
import { StructuralBadge } from "./StructuralXfeed.js";
import { ProfileCard } from "./MatrixProfileCard.js";
import { FlowRow, MAX_CH, CH_OPTIONS, downloadText } from "./MatrixFlowRow.js";
import { setSelected } from "./MatrixStageEditor.js";
import { SpeakersCard } from "./SpeakersCard.js";
import { Segment } from "./controls/index.js";
import { dspMode, setDspMode } from "../store/dspmode.js";

const pipelinesCardOpen = signal(true);

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
          <${Field} k="pipelines" />
        </div>
      </div>
    </section>
  `;
}

// --- Headphone AutoEQ card (step 6 + library pass) ---------------------------
// Standing collapsible card between PIPELINES and RESPONSE. Default collapsed —
// not everyone is listening to headphones. Two lanes: the AutoEq library picker
// (search → preview on RESPONSE → apply) and the paste/.txt import; both append
// the parsed iir stages to the target row(s) (+ optional stereo-pair mirror =
// the adjacent row) and map a Preamp line onto the row gain (dB) — one atomic
// stagePipelines op, Discard undoes it.
const eqCardOpen = signal(true);
const importText = signal("");
const importMirror = signal(true);
const importNote = signal("");

// Import is PER PIPELINE: every source (paste / .txt load / library profile)
// only fills importText; the append happens from the target row's own
// "Import EQ" tool (+ optional stereo-pair mirror).
//
// Every decision here — target clamping, the mirror pair, replace-vs-append, the
// preamp fold, and routing into a recognized crossfeed compensation block rather
// than onto one of its eight rows — is pure, and lives in eqimport.js's
// planEqImport. This wrapper only reads the private import signals, stages the
// plan, and extends the plot selection.
function doImport(rows, targetIndex, replace = false) {
  const { bs, rec } = xfeedBlock(rows);
  const plan = planEqImport(rows, targetIndex, {
    text: importText.value,
    replace,
    mirror: importMirror.value,
    block: rec,
    bauer: bs,
  });
  importNote.value = plan.note;
  if (!plan.rows) return;
  stagePipelines(plan.rows);
  // auto-plot the rows the EQ just landed on, so the response curve (and its
  // drag dots) appears without hunting for the ◉ toggle. In default mode the
  // rows now carry stages, so they auto-plot already — only an explicit toggle
  // selection needs extending, or it would hide the freshly-imported rows.
  if (plottedRows.value.size) plottedRows.value = new Set([...plottedRows.value, ...plan.targets]);
}

// Shared by the panel and the always-visible header button: load a .txt into
// the import textarea and make sure the card is open so the next step (target
// pick + Import) is in view. Input value resets so the same file re-fires.
function loadEqFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((t) => {
    importText.value = t;
    eqCardOpen.value = true;
  });
  e.target.value = "";
}

function ImportPanel({ rows }) {
  // Library "Load profile" is ONE click: the profile's verbatim ParametricEQ.txt
  // lands in the textarea and applies immediately to pipeline 1 (+ its stereo
  // pair per the mirror checkbox) — the standard headphone case. The paste /
  // .txt lanes stay per-row (arbitrary EQ needs an explicit target).
  const loadText = (text) => {
    importText.value = text;
    doImport(rows, 0, true); // library load REPLACES the previous profile
  };
  return html`
    <div class="mtx-import">
      <${LibraryPicker} applyText=${loadText} />
      <textarea
        rows="5"
        placeholder=${"Paste an AutoEq ParametricEQ.txt or a REW Generic EQ export…\nFilter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41"}
        value=${importText.value}
        onInput=${(e) => (importText.value = e.target.value)}
      ></textarea>
      <div class="mtx-profile-row">
        <label class="mtx-import-mirror">
          <input
            type="checkbox"
            checked=${importMirror.value}
            onChange=${(e) => (importMirror.value = e.target.checked)}
          />
          mirror to stereo pair
        </label>
      </div>
      ${importNote.value ? html`<div class="mtx-issues">${importNote.value}</div>` : null}
    </div>
  `;
}

function HeadphoneEqCard() {
  const open = eqCardOpen.value;
  const toggle = () => {
    eqCardOpen.value = !open;
    if (open) clearLibrarySelection(); // collapsing drops selection + preview — no residue
  };
  return html`
    <section class="card">
      <button type="button" class="card-head mtx-eq-head" onClick=${toggle}>
        <span class="tri">${open ? "▾" : "▸"}</span> Headphone Auto EQ
      </button>
      ${open ? html`<div class="card-body"><${ImportPanel} rows=${effectivePipelines.value} /></div>` : null}
    </section>
  `;
}

function PipelinesCard() {
  const open = pipelinesCardOpen.value;
  const rows = effectivePipelines.value;
  const baseline = pipelineBaseline.value;
  // The import signals are private to this module, so the row tools' "is EQ
  // text staged?" state rides down as a prop, the way `importHere` already does.
  const eqLoaded = !!importText.value.trim();
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
  const body = open
    ? html`<div class="card-body">
        ${
          notesVisible.value
            ? html`<div class="field-note mtx-pipelines-note">
                Each pipeline copies a source channel through a chain of processing stages — filter impulse-response
                files (convolution) or iir / delay / riaa plugin specs — then applies gain and mixes into an output
                channel. Pipelines sharing an output channel are summed (Σ). Gain applies in dB or linear scale;
                negative linear factors invert polarity (e.g. for M/S processing).
              </div>`
            : null
        }
        <${XfeedBadge} />
        <${StructuralBadge} />
        ${rows.map(
          (r, i) => html`
            <${FlowRow}
              row=${r}
              index=${i}
              dirty=${rowDirty(i)}
              summing=${perTarget[r.mixdown] > 1}
              canRemove=${rows.length > 1}
              eqLoaded=${eqLoaded}
              update=${(patch) => update(i, patch)}
              remove=${() => remove(i)}
              importHere=${() => doImport(rows, i)}
            />
          `,
        )}
        <div class="mtx-pipelines-actions">
          <button type="button" class="mtx-add-row" disabled=${rows.length >= MAX_CH} onClick=${add}>
            + Add pipeline
          </button>
          <div class="mtx-file-actions">
            <label class="btn mtx-file-btn">
              Load AutoEq / REW .txt…<input type="file" accept=".txt" style="display:none" onChange=${loadEqFile} />
            </label>
            ${(() => {
              const eqExport = pipelinesToRewText(rows);
              return html`<button
                type="button"
                class="btn mtx-file-btn"
                disabled=${!eqExport.count}
                title=${
                  eqExport.count
                    ? `Export all ${eqExport.count} pipeline(s)' EQ as REW / Equalizer APO text${
                        eqExport.skipped.length
                          ? ` (${eqExport.skipped.length} stage(s) not representable, omitted)`
                          : ""
                      }`
                    : "No parametric EQ in the pipeline set to export"
                }
                onClick=${() => downloadText("hqptuner-matrix-eq.txt", eqExport.text)}
              >
                Export AutoEq / REW .txt…
              </button>`;
            })()}
          </div>
        </div>
      </div>`
    : null;
  return html`
    <section class="card">
      <button type="button" class="card-head mtx-eq-head" onClick=${() => (pipelinesCardOpen.value = !open)}>
        <span class="tri">${open ? "▾" : "▸"}</span> Pipelines <span class="mtx-count">${rows.length} / ${MAX_CH}</span>
      </button>
      ${body}
    </section>
  `;
}

// The mode switcher. A VIEW selector: it decides which listening setup's
// controls are on screen and never turns processing on (store/dspmode.js). The
// matrix, the pipelines and the response plot are common to both and stay put
// below it — they are the signal path itself, not a headphone feature.
function DspSwitcher() {
  const mode = dspMode.value;
  return html`
    <div class="dsp-switcher">
      <${Segment}
        value=${mode}
        options=${[
          // Words only: the app ships Inter + JetBrains Mono, and a 🔊/🎧 in a
          // segment label renders as tofu wherever no emoji font is installed.
          { value: "speakers", label: "Speakers" },
          { value: "headphones", label: "Headphones" },
        ]}
        onChange=${setDspMode}
      />
    </div>
  `;
}

export function MatrixTab() {
  const speakerMode = dspMode.value === "speakers";
  return html`<section class="tab-body">
    <${DspSwitcher} />
    <div class="card-grid">
      <${GlobalCard} />
      <${ProfileCard} />
    </div>
    <${PipelinesCard} />
    ${speakerMode ? html`<${SpeakersCard} />` : html`<${HeadphoneEqCard} /><${CrossfeedCard} />`}
    <${MatrixPlot} />
  </section>`;
}
