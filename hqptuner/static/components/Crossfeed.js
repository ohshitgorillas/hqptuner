/* eslint-disable hqptuner/no-hand-rolled-card -- an issues strip sits BETWEEN
   head and body. Expressing that through Card would mean a slot prop per
   position, which is a worse trade than one written-down exemption. */
// CROSSFEED — one card, two implementations behind a segmented toggle.
//
// Bauer is HQPlayer's own post-process (libbs2b) plus the compensation block.
// Structural is sixteen matrix rows modelling a head and a pair of speakers
// (docs/crossfeed-math.md). They are mutually exclusive by construction: the
// matrix runs before post-process, so both at once is two crossfeeds in series.
//
// The body opens with two switches: a card-level ENGAGE|BYPASS gate, and under
// it the Bauer|Structural toggle. The toggle is a VIEW selector that disables
// what it leaves. Selecting a mode switches off the other one — the block, or
// the post-process flag and its compensation rows — and turns NOTHING on:
// arriving at a view is a request to see its controls, not to have its
// processing switched on behind the user's back. Turning a mode on is the gate,
// acting on whichever view is showing. Everything stages like any other edit:
// the pending bar counts it, Discard undoes it, nothing reaches the daemon
// until Apply.
import { signal } from "@preact/signals";
import { html, wheelGuard } from "../lib/dom.js";
import { Field } from "./Field.js";
import { effective, effectivePipelines, isDirty } from "../store/resolve.js";
import { edit } from "../store/actions.js";
import { notesVisible } from "../store/prefs.js";
import { noteFor } from "../store/prose.js";
import { pathParams } from "../lib/binaural/geometry.js";
import { midSideResponse, magDb } from "../lib/binaural/response.js";
import { PRESETS, matchPreset } from "../lib/binaural-setup.js";
import {
  activeMode,
  setXfMode,
  structuralParams,
  structuralBlock,
  stageStructural,
  removeStructural,
  conflicts,
  remember,
  liveParams,
  pipelinesDirty,
} from "../store/xfmode.js";
import { BypassNote } from "./MatrixBypassNote.js";
import { CrossfeedGeometry } from "./CrossfeedGeometry.js";
import { XfeedStrip, CompMiniPlot, lensOn, lensShown, xfeedLensAvailable } from "./XfeedComp.js";
import { xfeedBlock } from "../store/xfeedblock.js";
import { uncompensatedRows } from "../lib/xfeed.js";
import { Segment, SliderNumber } from "./controls/index.js";
import { CrossfeedPlot, PlotFrame } from "./plots.js";
import { bandFreqs } from "../lib/dsp/curves.js";
import { truthy } from "../lib/coerce.js";
import { db, dbOffset } from "../lib/units.js";

/**
 * @typedef {import("../lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {{ lambda: number, angle: number, headRadius: number }} StructParams
 *   The three physical controls the structural block compiles from
 *   (store/xfmode.js DEFAULTS names the same trio).
 * @typedef {{ alphaNear: number, alphaFar: number, itd: number, cornerHz: number,
 *             groupDelayNear: number, groupDelayFar: number }} PathParams
 *   What lib/binaural/geometry.js pathParams() derives from that geometry.
 * @typedef {(patch: Partial<StructParams>, commit: boolean) => void} ParamWriter
 *   The owner's writer: commit false streams live, true remembers and stages.
 * @typedef {{ target: HTMLSelectElement }} SelectEv
 */

const cardOpen = signal(true);
const plotOpen = signal(false);
const structPlotOpen = signal(false);
const compOpen = signal(true);
const issueNote = signal("");

/**
 * @param {PipelineRow[]} rows
 * @returns {StructParams}
 */
function params(rows) {
  return structuralParams(rows);
}

// The "what you hear" lens: it adds the ear-level curves to the RESPONSE card's
// plot, further down the page, but the button belongs HERE — in the crossfeed's
// own card, on the row that already carries the gate and the mode segment. It
// governs whichever crossfeed is showing, so it sits above the Bauer|Structural
// fork rather than inside either arm, and switching modes neither moves it nor
// takes it away.
//
// Always rendered, never conditionally. A control that appears and disappears
// shifts everything beneath it. With nothing for either lens to draw it is
// simply disabled, and its title is one fixed string: a reason swapped in
// alongside would be the same defect one level down.
/**
 * @param {{ rows: PipelineRow[] }} props
 */
function LensToggle({ rows }) {
  const drawable = xfeedLensAvailable(rows) || !!structuralBlock(rows);
  return html`<button
    type="button"
    class="mtx-tool xfs-lens ${lensShown() ? "active" : ""}"
    disabled=${!drawable}
    title="Plot what actually reaches your ears through the crossfeed: centered sound and the stereo sides, with your EQ folded in"
    onClick=${() => (lensOn.value = !lensShown())}
  >
    ∿ what you hear
  </button>`;
}

// A compensation block occupies the same rows and carries Lin gains, so it has
// to be dismantled back to its plain EQ pair before the structural compiler can
// build from it. Doing that here rather than refusing is the difference between
// a gate that works and one that silently does nothing.
/**
 * @param {PipelineRow[]} rows
 * @returns {void}
 */
function installStructural(rows) {
  const comp = xfeedBlock(rows).rec;
  const base = comp ? uncompensatedRows(rows, comp) : rows;
  issueNote.value = stageStructural(base, params(base)) || "";
}

// --- card-level gate ---------------------------------------------------------

// One gate, two mechanisms. In the Bauer view it drives the daemon's
// crossfeed_enabled flag; in the Structural view "on" is not a config key at
// all — it is whether the sixteen-row matrix block is installed, so ENGAGE
// installs it and BYPASS removes it. Hand-rolled rather than a schema Field
// because no single key can carry both readings. Everything stages; Apply is
// the user's.
const GATE_OPTIONS = [
  { value: "1", label: "ENGAGE" },
  { value: "0", label: "BYPASS" },
];

/**
 * @param {{ rows: PipelineRow[], active: string }} props
 */
function Gate({ rows, active }) {
  const bauer = active !== "structural";
  const rec = structuralBlock(rows);
  const on = bauer ? truthy(effective("crossfeed_enabled")) : !!rec;
  const dirty = bauer ? isDirty("crossfeed_enabled") : pipelinesDirty();
  const toggle = (/** @type {string} */ v) => {
    if (bauer) {
      edit("crossfeed_enabled", v);
    } else if (v === "1") {
      installStructural(rows);
    } else {
      removeStructural(rows, rec);
      issueNote.value = "";
    }
  };
  // Both views run inside <matrix>: Bauer is a post-process plugin, structural
  // is sixteen pipeline rows. A bypassed engine runs neither, so the gate is not
  // a control the user can usefully reach until the engine is engaged.
  const bypassed = !truthy(effective("matrix_enabled"));
  return html`
    <div class="xfs-gate ${dirty ? "dirty" : ""}">
      <${Segment} value=${on ? "1" : "0"} options=${GATE_OPTIONS} onChange=${toggle} disabled=${bypassed} />
    </div>
  `;
}

// --- controls ----------------------------------------------------------------

// One physical parameter: label, the shared slider+box control, caption. The
// row is local (these are derived params, not schema fields, so Field.js cannot
// own them); the control itself is the shared one.
/**
 * @param {{ label: string, unit?: string, min: string | number, max: string | number,
 *           step: string | number, boxStep?: string | number, value: number,
 *           format: (v: number) => string, onDrag: (v: number) => void, onCommit: (v: number) => void,
 *           caption?: string, sub?: string }} props
 */
function Control({ label, unit, min, max, step, boxStep, value, format, onDrag, onCommit, caption, sub }) {
  return html`
    <div class="xfs-control">
      <label class="xfs-label">${label}</label>
      <${SliderNumber}
        anchor="min"
        min=${min}
        max=${max}
        step=${step}
        boxStep=${boxStep}
        value=${value}
        unit=${unit}
        sub=${sub}
        format=${format}
        onDrag=${(/** @type {string | number} */ v) => onDrag(Number(v))}
        onCommit=${(/** @type {string | number} */ v) => onCommit(Number(v))}
      />
      ${notesVisible.value && caption ? html`<div class="field-note xfs-caption">${caption}</div>` : null}
    </div>
  `;
}

// --- structural mode ---------------------------------------------------------

/**
 * @param {{ p: PathParams, lambda: number }} props
 */
function Readouts({ p, lambda }) {
  const farDb = 20 * Math.log10(p.alphaFar);
  const centerDb = 20 * Math.log10(lambda * ((p.alphaNear + p.alphaFar) / 2) + (1 - lambda));
  const lfItd = p.itd + p.groupDelayFar - p.groupDelayNear;
  return html`
    <dl class="xfs-readouts">
      <div>
        <dt>Ear-to-ear delay</dt>
        <dd>${Math.round(p.itd * 1e6)} µs<span> · ${Math.round(lfItd * 1e6)} µs at low frequencies</span></dd>
      </div>
      <div>
        <dt>Far ear, treble</dt>
        <dd>${db(farDb, 1)}</dd>
      </div>
      <div>
        <dt>Center shift</dt>
        <dd>${dbOffset(centerDb, 2)}</dd>
      </div>
    </dl>
  `;
}

// The three geometry knobs and the preset picker that drives them. `set(patch,
// commit)` is the owner's writer: false streams live, true remembers and stages.
/**
 * @param {{ p0: StructParams, set: ParamWriter }} props
 */
function StructuralControls({ p0, set }) {
  return html`
      <div class="xfs-controls">
        <div class="xfs-preset">
          <label class="xfs-label">Preset</label>
          <select
            value=${matchPreset(p0)}
            onWheel=${wheelGuard}
            onChange=${(/** @type {SelectEv} */ e) => {
              const hit = PRESETS.find((x) => x.id === e.target.value);
              if (hit) set({ angle: hit.angle, lambda: hit.lambda }, true);
            }}
          >
            ${PRESETS.map((x) => html`<option value=${x.id}>${x.label}</option>`)}
            ${matchPreset(p0) === "custom" ? html`<option value="custom">Custom</option>` : null}
          </select>
        </div>
        <${Control}
          label="Speaker angle"
          unit="°"
          min="5"
          max="60"
          step="0.5"
          value=${p0.angle}
          format=${(/** @type {number} */ v) => v.toFixed(1)}
          onDrag=${(/** @type {number} */ v) => set({ angle: v }, false)}
          onCommit=${(/** @type {number} */ v) => set({ angle: v }, true)}
          caption="How far apart the speakers being simulated are. Narrower blends the channels more; wider approaches plain headphones."
        />
        <${Control}
          label="Head circumference"
          unit=" cm"
          min="41"
          max="66"
          step="0.25"
          boxStep="any"
          value=${p0.headRadius * 2 * Math.PI * 100}
          format=${(/** @type {number} */ v) => v.toFixed(2)}
          sub=${`${(p0.headRadius * 100).toFixed(2)} cm radius`}
          onDrag=${(/** @type {number} */ v) => set({ headRadius: v / 100 / (2 * Math.PI) }, false)}
          onCommit=${(/** @type {number} */ v) => set({ headRadius: v / 100 / (2 * Math.PI) }, true)}
          caption="Measure with a tape around your head just above the ears — the same figure hat sizes use. The model works from the radius, shown under the value. A larger head means a longer path around it: more delay between the ears and more treble shadowing."
        />
        <${Control}
          label="Center character"
          unit="%"
          min="0"
          max="150"
          step="1"
          value=${Math.round(p0.lambda * 100)}
          format=${(/** @type {number} */ v) => String(Math.round(v))}
          onDrag=${(/** @type {number} */ v) => set({ lambda: v / 100 }, false)}
          onCommit=${(/** @type {number} */ v) => set({ lambda: v / 100 }, true)}
          caption="Speakers color centered sound — vocals, bass, most of a mix — slightly darker than the sides. 100% reproduces that; 0% leaves the center tonally neutral. The stereo image is identical at every setting: only the tone of centered sound changes."
        />
      </div>
  `;
}

/**
 * @param {{ rows: PipelineRow[] }} props
 */
function StructuralMode({ rows }) {
  const rec = structuralBlock(rows);
  const p0 = params(rows);
  const p = pathParams(p0.angle, p0.headRadius);
  const blockers = conflicts();

  // Drag updates the shared live params so the card AND the response plot track
  // without restaging sixteen rows per pixel. Release remembers the value whether
  // or not a block is installed — otherwise the slider springs back to the
  // default the moment you let go, with nothing to hold the new position.
  /** @type {ParamWriter} */
  const set = (patch, commit) => {
    const next = { ...params(rows), ...patch };
    if (!commit) {
      liveParams.value = next;
      return;
    }
    liveParams.value = null;
    remember(next);
    if (rec) issueNote.value = stageStructural(rows, next) || "";
  };

  return html`
    <div class="xfs-cols">
      <${StructuralControls} p0=${p0} set=${set} />
      <span class="col-rule" aria-hidden="true"></span>
      <div class="xfs-right">
        <div class="xfs-diagram">
          <${CrossfeedGeometry} angle=${p0.angle} headRadius=${p0.headRadius} />
        </div>
        <${Readouts} p=${p} lambda=${p0.lambda} />
      </div>
    </div>
    ${
      blockers.length && !rec
        ? html`<div class="field-note xfs-blocked">
            Turning this on will also ${blockers.map((b) => b.reason).join(" ")} These land as staged changes you can
            review before applying.
          </div>`
        : null
    }
    <button type="button" class="card-head" onClick=${() => (structPlotOpen.value = !structPlotOpen.value)}>
      <span class="tri">${structPlotOpen.value ? "▾" : "▸"}</span> Crossfeed response
      ${
        structPlotOpen.value
          ? html`<span class="xfs-legend">
              <span class="lg lg-cur">center (at ${Math.round(p0.lambda * 100)}%)</span>
              <span class="lg lg-ghost">center (as speakers)</span>
              <span class="lg lg-side">sides</span>
            </span>`
          : null
      }
    </button>
    ${structPlotOpen.value ? html`<${StructuralPlot} p0=${p0} />` : null}
    ${issueNote.value ? html`<div class="mtx-issues xfs-actions">${issueNote.value}</div>` : null}
  `;
}

// The crossfeed's own response. Collapsed by default and deliberately so: three
// near-flat dB curves are unreadable to anyone who does not already know what
// they are looking at, and everything a listener needs from them is in the
// readouts above, in words. Kept for those who do want curves — the same
// affordance Bauer mode has in this card.
//
// It belongs here rather than on the shared RESPONSE chart, which shows the
// headphone EQ; an earlier arrangement put these there and buried the EQ behind
// a 2 dB story.
/**
 * @param {{ p0: StructParams }} props
 */
function StructuralPlot({ p0 }) {
  const freqs = bandFreqs(140);
  const at = (/** @type {number} */ lambda) => (/** @type {number} */ f) => midSideResponse(f, { ...p0, lambda });
  const cur = at(p0.lambda);
  const lit = at(1);
  const trace = (/** @type {(f: number) => number} */ fn) => freqs.map((f) => [f, fn(f)]);
  // labels live in the section header, not on the curves: three traces converge
  // where the labels would sit and overlapped each other illegibly
  const traces = [
    { points: trace((/** @type {number} */ f) => magDb(lit(f).mid)), kind: "ghost", label: "" },
    { points: trace((/** @type {number} */ f) => magDb(cur(f).mid)), kind: "xfm", label: "" },
    { points: trace((/** @type {number} */ f) => magDb(cur(f).side)), kind: "xfs", label: "" },
  ];
  return html`
    <div>
      <${PlotFrame} traces=${traces} yMin=${-6} yMax=${3} dbStep=${1} height=${200} handles=${[]} />
    </div>
  `;
}

// --- bauer mode --------------------------------------------------------------

function BauerMode() {
  const on = truthy(effective("crossfeed_enabled"));
  const open = plotOpen.value;
  return html`
    <div class="dsp-card">
      ${
        // The crossfeed card holds two mutually exclusive implementations, so
        // this note belongs to the BAUER view and not to the card's head — in
        // the head it would describe libbs2b while the structural block is
        // showing. Same class, same prose source, one level down.
        noteFor("crossfeed_enabled")
          ? html`<span class="card-sub t-caption">${noteFor("crossfeed_enabled")}</span>`
          : null
      }
      <div class="pack split">
        <${Field} k="crossfeed_preset" />
      </div>
      <div class="dsp-body ${on ? "" : "off"}">
        <div class="knob-cluster">
          <${Field} k="crossfeed_frequency" />
          <span class="col-rule" aria-hidden="true"></span>
          <${Field} k="crossfeed_level" />
        </div>
        <button type="button" class="card-head" onClick=${() => (plotOpen.value = !open)}>
          <span class="tri">${open ? "▾" : "▸"}</span> Response plot
        </button>
        ${open ? html`<div class="dsp-plot"><${CrossfeedPlot} /></div>` : null}
      </div>
      <button
        type="button"
        class="card-head"
        title="Crossfeed makes centered sound — vocals, bass, most of the mix — slightly duller in the treble than the sides, much as real speakers do. This brings the centered part back to neutral, without touching the crossfeed's stereo effect."
        onClick=${() => (compOpen.value = !compOpen.value)}
      >
        <span class="tri">${compOpen.value ? "▾" : "▸"}</span> Crossfeed compensation
      </button>
      ${
        compOpen.value
          ? html`
              <${XfeedStrip} />
              <${CompMiniPlot} />
            `
          : null
      }
    </div>
  `;
}

// --- card --------------------------------------------------------------------

export function CrossfeedCard() {
  const rows = effectivePipelines.value;
  const active = activeMode(rows);
  const open = cardOpen.value;

  return html`
    <section class="card">
      <button type="button" class="card-head" onClick=${() => (cardOpen.value = !open)}>
        <span class="tri">${open ? "▾" : "▸"}</span> Crossfeed
      </button>
      ${issueNote.value ? html`<div class="mtx-issues">${issueNote.value}</div>` : null}
      ${
        open
          ? html`<div class="card-body">
              <${BypassNote} />
              <div class="xfs-top">
                <${Gate} rows=${rows} active=${active} />
                <${Segment}
                  value=${active}
                  options=${[
                    { value: "bauer", label: "Bauer" },
                    { value: "structural", label: "Structural" },
                  ]}
                  onChange=${(/** @type {string} */ v) => setXfMode(v, rows)}
                />
                <${LensToggle} rows=${rows} />
                <span class="row-break" aria-hidden="true"></span>
                <div class="field-note">
                  Bauer crossfeed is built into HQPlayer and is the default. Structural crossfeed is HQPTuner's own and
                  uses the Matrix pipelines.
                </div>
              </div>
              ${active === "structural" ? html`<${StructuralMode} rows=${rows} />` : html`<${BauerMode} />`}
            </div>`
          : null
      }
    </section>
  `;
}
