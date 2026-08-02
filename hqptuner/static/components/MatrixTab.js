// Matrix tab — the tab shell: the global matrix card, the pipeline list, and
// the Headphone Auto EQ card (steps 3+6 of the delivery order, matrix-spec §8).
// The pipeline row itself lives in MatrixFlowRow.js and the docked stage editor
// in MatrixStageEditor.js; the profile card (step 5) in MatrixProfileCard.js.
// Plots stay reserved (step 7).
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { Field } from "./Field.js";
import { noteFor } from "../store/prose.js";
import { pipelineBaseline, effectivePipelines, canonPipelines } from "../store/resolve.js";
import { stagePipelines } from "../store/actions.js";
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
import { structuralBlock } from "../lib/xfmode.js";
import { Section, Card } from "./tabs/common.js";
import { BypassNote } from "./MatrixBypassNote.js";

const pipelinesCardOpen = signal(true);

// Single column — a .pack's two tracks inside a half-width card would starve
// the selects below their longest option (the "over ⌄" defect). Selects here
// are content-sized via .mtx-global.
function GlobalCard() {
  return html`
    <${Card} title="General" subtitle=${noteFor("matrix_enabled")}>
      <div class="mtx-global">
        <${Field} k="matrix_enabled" />
        <${Field} k="matrix_engine" />
        <${Field} k="matrix_expand_hf" />
        <${Field} k="matrix_iir2fir" />
      </div>
    <//>
  `;
}

// --- Headphone AutoEQ card (step 6 + library pass) ---------------------------
// Standing collapsible card between PIPELINES and RESPONSE. Default collapsed —
// not everyone is listening to headphones. Two lanes, one contract: the AutoEq
// library picker (search → preview on RESPONSE → apply) and the .txt load both
// REPLACE the profile on pipeline 1 — the library lane always onto its stereo
// pair too, the .txt lane per the mirror checkbox beside it — on a single
// click, mapping a Preamp line onto the row gain (dB)
// — one atomic stagePipelines op, Discard undoes it. A row's own "Import EQ"
// still APPENDS the loaded text to that row, for retargeting at an arbitrary
// pipeline.
const eqCardOpen = signal(true);
const importText = signal("");
// Mirroring is per DSP mode. A headphone profile is one curve for a headphone
// model, both ears, so headphones default it on; speaker correction is per
// channel — the two speakers measure differently — so speakers default it off.
// Each mode keeps its own answer, so switching across and back does not lose it.
const importMirrorHeadphones = signal(true);
const importMirrorSpeakers = signal(false);
const importMirror = () => (dspMode.value === "speakers" ? importMirrorSpeakers : importMirrorHeadphones);
// One note per card: the library lane writes libraryNote, which renders in the
// Headphone Auto EQ card; the .txt and per-row lanes write importNote, which
// renders in the Pipelines card. A lane never writes into a card the click did
// not come from — and the Pipelines card is on screen in both DSP modes, so its
// lanes can still report a parse failure with the headphone card unmounted.
const importNote = signal("");
const libraryNote = signal("");

// Import is PER PIPELINE: every source (paste / .txt load / library profile)
// only fills importText; the append happens from the target row's own
// "Import EQ" tool (+ optional stereo-pair mirror).
//
// Every decision here — target clamping, the mirror pair, replace-vs-append, the
// preamp fold, and routing into a recognized crossfeed compensation block rather
// than onto one of its eight rows — is pure, and lives in eqimport.js's
// planEqImport. This wrapper only reads the import text, stages the plan, and
// extends the plot selection. Mirroring arrives from the calling lane rather
// than being read here, and the note is returned rather than assigned, so each
// lane decides both for itself.
function doImport(rows, targetIndex, { replace = false, mirror }) {
  const { bs, rec } = xfeedBlock(rows);
  const plan = planEqImport(rows, targetIndex, {
    text: importText.value,
    replace,
    mirror,
    block: rec,
    bauer: bs,
    structural: structuralBlock(rows),
  });
  if (plan.rows) {
    stagePipelines(plan.rows);
    // auto-plot the rows the EQ just landed on, so the response curve (and its
    // drag dots) appears without hunting for the ◉ toggle. In default mode the
    // rows now carry stages, so they auto-plot already — only an explicit toggle
    // selection needs extending, or it would hide the freshly-imported rows.
    if (plottedRows.value.size) plottedRows.value = new Set([...plottedRows.value, ...plan.targets]);
  }
  return plan.note;
}

// Loading a .txt IS loading the EQ — one click, the same contract the library
// picker already had. It lands on pipeline 1 (+ its stereo pair per the mirror
// checkbox beside it), which covers both a headphone profile and a per-channel
// speaker measurement. Filling a textarea and waiting for a second press on some
// row's "Import EQ" reads as a button that did nothing. The parsed text stays in
// `importText` afterwards, so the per-row buttons still work for retargeting EQ
// at an arbitrary pipeline. Input value resets so the same file re-fires.
function loadEqFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((t) => {
    importText.value = t;
    // a load REPLACES the previous profile
    importNote.value = doImport(effectivePipelines.value, 0, { replace: true, mirror: importMirror().value });
  });
  e.target.value = "";
}

// Lives in the Pipelines card's action row, next to the mirror checkbox that
// decides where a load lands.
function LoadEqButton() {
  return html`<label class="btn mtx-file-btn">
    Load AutoEq / REW .txt…<input type="file" accept=".txt" style="display:none" onChange=${loadEqFile} />
  </label>`;
}

function ImportPanel({ rows }) {
  // Library "Load profile" is ONE click: the profile's verbatim ParametricEQ.txt
  // applies immediately to pipeline 1 and its stereo pair — always both, never
  // the mirror checkbox's answer. A library profile is one curve for a headphone
  // model, and there is no such thing as a left-ear-only one; the checkbox has
  // no meaningful answer on this lane, and it lives in another card besides.
  const loadText = (text) => {
    importText.value = text;
    // library load REPLACES the previous profile
    libraryNote.value = doImport(rows, 0, { replace: true, mirror: true });
  };
  return html`
    <div class="mtx-import">
      <${LibraryPicker} applyText=${loadText} />
      ${libraryNote.value ? html`<div class="mtx-issues">${libraryNote.value}</div>` : null}
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
    <${Card} title="Headphone Auto EQ" collapse=${{ open, onToggle: toggle }} headClass="mtx-eq-head">
      <${BypassNote} />
      <${ImportPanel} rows=${effectivePipelines.value} />
    <//>
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
    ? // htm has no <>...</> fragment shorthand — a template with several roots
      // already yields an array, and Card wraps it in the card body.
      html`
        <${BypassNote} />
        ${
          notesVisible.value
            ? html`<div class="field-note">
                Each pipeline copies a source channel through a chain of processing stages — filter impulse-response
                files (convolution) or iir / delay / riaa plugin specs — then applies gain and mixes into an output
                channel. Pipelines sharing an output channel are summed (Σ). Gain applies in dB or linear scale;
                negative linear factors invert polarity (e.g. for M/S processing).
              </div>`
            : null
        }
        <div class="mtx-global">
          <${Field} k="pipelines" />
        </div>
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
              importHere=${() => (importNote.value = doImport(rows, i, { mirror: importMirror().value }))}
            />
          `,
        )}
        <div class="mtx-pipelines-actions">
          <button type="button" class="mtx-add-row" disabled=${rows.length >= MAX_CH} onClick=${add}>
            + Add pipeline
          </button>
          <div class="mtx-file-actions">
            <label class="mtx-import-mirror">
              <input
                type="checkbox"
                checked=${importMirror().value}
                onChange=${(e) => (importMirror().value = e.target.checked)}
              />
              mirror to stereo pair
            </label>
            <${LoadEqButton} />
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
        ${importNote.value ? html`<div class="mtx-issues">${importNote.value}</div>` : null}
      `
    : null;
  return html`
    <${Card}
      title=${html`Pipelines <span class="mtx-count">${rows.length} / ${MAX_CH}</span>`}
      collapse=${{ open, onToggle: () => (pipelinesCardOpen.value = !open) }}
      headClass="mtx-eq-head"
    >
      ${body}
    <//>
  `;
}

// The switcher's two glyphs. Drawn, not typed: the app ships Inter + JetBrains
// Mono, so a 🔊/🎧 in a segment label renders as tofu wherever no emoji font is
// installed. They stroke in currentColor, so they take the seg's own colour on
// both sides of the switch, and are decoration beside a word that already says
// which mode this is — aria-hidden, no title.
const SEG_GLYPH = {
  class: "seg-glyph",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.75",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
};

function SpeakerGlyph() {
  return html`
    <svg ...${SEG_GLYPH}>
      <rect x="6" y="2.5" width="12" height="19" rx="2" />
      <circle cx="12" cy="15" r="3.5" />
      <circle cx="12" cy="7" r="1.25" />
    </svg>
  `;
}

function HeadphoneGlyph() {
  return html`
    <svg ...${SEG_GLYPH}>
      <path d="M4 16v-4a8 8 0 0 1 16 0v4" />
      <rect x="2.5" y="14.5" width="4" height="7" rx="2" />
      <rect x="17.5" y="14.5" width="4" height="7" rx="2" />
    </svg>
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
          { value: "speakers", label: html`<${SpeakerGlyph} />Speakers` },
          { value: "headphones", label: html`<${HeadphoneGlyph} />Headphones` },
        ]}
        onChange=${setDspMode}
      />
    </div>
  `;
}

export function MatrixTab() {
  const speakerMode = dspMode.value === "speakers";
  return html`<${Section}>
    <${DspSwitcher} />
    <div class="card-grid">
      <${GlobalCard} />
      <${ProfileCard} />
    </div>
    <${PipelinesCard} />
    ${speakerMode ? html`<${SpeakersCard} />` : html`<${HeadphoneEqCard} /><${CrossfeedCard} />`}
    <${MatrixPlot} />
  <//>`;
}
