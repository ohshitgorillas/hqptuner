// CROSSFEED — one card, two implementations behind a segmented toggle.
//
// Bauer is HQPlayer's own post-process (libbs2b) plus the compensation block.
// Structural is sixteen matrix rows modelling a head and a pair of speakers
// (docs/crossfeed-math.md). They are mutually exclusive by construction: the
// matrix runs before post-process, so both at once is two crossfeeds in series.
//
// The toggle is a STAGED DSP swap, not a view switch. Selecting a mode stages
// the rows and the settings that mode needs, exactly like any other edit — the
// pending bar counts it, Discard undoes it, nothing reaches the daemon until
// Apply. Mode is derived from the rows rather than stored, so what the toggle
// shows is always what is actually installed.
import { signal } from "@preact/signals";
import { html, wheelGuard } from "../lib/dom.js";
import { Field } from "./Field.js";
import { effective, effectivePipelines, edit } from "../store/state.js";
import { notesVisible } from "../store/prefs.js";
import { pathParams, midSideResponse, magDb, PRESETS, matchPreset } from "../lib/binaural.js";
import {
  mode,
  structuralParams,
  structuralBlock,
  stageStructural,
  removeStructural,
  conflicts,
  remember,
  liveParams,
} from "../lib/xfmode.js";
import { SpeakerDiagram } from "./SpeakerDiagram.js";
import { XfeedStrip, CompMiniPlot, xfeedBlock } from "./XfeedComp.js";
import { uncompensatedRows } from "../lib/xfeed.js";
import { Segment } from "./controls/index.js";
import { CrossfeedPlot, PlotFrame } from "./plots.js";
import { logFreqs } from "../lib/dsp.js";
import { truthy } from "./tabs/common.js";

const cardOpen = signal(true);
const plotOpen = signal(false);
const structPlotOpen = signal(false);
const compOpen = signal(true);
const issueNote = signal("");

// Removal has two paths and only one of them is lossless. When the stash is gone
// the pair is rebuilt from the block instead, which is the single place this card
// changes bytes the user did not ask it to touch — so it says so rather than
// letting the rows quietly come back different.
function noteFor({ restored }) {
  return restored
    ? ""
    : "The rows this block was built over were no longer available, so they have been rebuilt from the block: one row per ear, In 1 first, gains rounded to two decimals. Check rows 1 and 2 before applying.";
}
function params(rows) {
  return structuralParams(rows);
}

// --- controls ----------------------------------------------------------------

function Control({ label, unit, min, max, step, value, format, onDrag, onCommit, caption, sub }) {
  return html`
    <div class="xfs-control">
      <label class="xfs-label">${label}</label>
      <div class="xfs-input">
        <input
          type="range"
          min=${min}
          max=${max}
          step=${step}
          value=${value}
          onWheel=${wheelGuard}
          onInput=${(e) => onDrag(Number(e.target.value))}
          onChange=${(e) => onCommit(Number(e.target.value))}
        />
        <span class="xfs-readbox">
          <label class="xfs-readout">
            <input
              type="number"
              min=${min}
              max=${max}
              step=${step}
              value=${format(value)}
              onWheel=${wheelGuard}
              onChange=${(e) => onCommit(Number(e.target.value))}
            />
            <span class="xfs-unit">${unit}</span>
          </label>
          ${sub ? html`<span class="xfs-sub">${sub}</span>` : null}
        </span>
      </div>
      ${notesVisible.value && caption ? html`<div class="field-note xfs-caption">${caption}</div>` : null}
    </div>
  `;
}

// --- structural mode ---------------------------------------------------------

function Readouts({ p, lambda }) {
  const farDb = 20 * Math.log10(p.alphaFar);
  const centerDb = 20 * Math.log10(lambda * ((p.alphaNear + p.alphaFar) / 2) + (1 - lambda));
  const lfItd = p.itd + p.groupDelayFar - p.groupDelayNear;
  return html`
    <dl class="xfs-readouts">
      <div><dt>Ear-to-ear delay</dt><dd>${Math.round(p.itd * 1e6)} µs<span> · ${Math.round(lfItd * 1e6)} µs at low frequencies</span></dd></div>
      <div><dt>Far ear, treble</dt><dd>${farDb.toFixed(1)} dB</dd></div>
      <div><dt>Center shift</dt><dd>${centerDb >= 0 ? "+" : ""}${centerDb.toFixed(2)} dB</dd></div>
    </dl>
  `;
}

function StructuralMode({ rows }) {
  const rec = structuralBlock(rows);
  const p0 = params(rows);
  const p = pathParams(p0.angle, p0.headRadius);
  const blockers = conflicts();

  // Drag updates the shared live params so the card AND the response plot track
  // without restaging sixteen rows per pixel. Release remembers the value whether
  // or not a block is installed — otherwise the slider springs back to the
  // default the moment you let go, with nothing to hold the new position.
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

  const install = () => {
    issueNote.value = stageStructural(rows, params(rows)) || "";
  };

  return html`
    <div class="xfs-cols">
      <div class="xfs-controls">
        <div class="xfs-preset">
          <label class="xfs-label">Preset</label>
          <select
            value=${matchPreset(p0)}
            onChange=${(e) => {
              const hit = PRESETS.find((x) => x.id === e.target.value);
              if (hit) set({ angle: hit.angle, lambda: hit.lambda }, true);
            }}
          >
            ${PRESETS.map((x) => html`<option value=${x.id}>${x.label}</option>`)}
            ${matchPreset(p0) === "custom" ? html`<option value="custom">Custom</option>` : null}
          </select>
          ${rec
            ? html`<button
                type="button"
                class="mtx-tool mtx-remove"
                onClick=${() => (issueNote.value = noteFor(removeStructural(rows, rec)))}
              >
                Turn off
              </button>`
            : html`<button type="button" class="mtx-tool mtx-primary" onClick=${install}>Turn on</button>`}
        </div>
        <${Control}
          label="Speaker angle"
          unit="°"
          min="5"
          max="60"
          step="0.5"
          value=${p0.angle}
          format=${(v) => v.toFixed(1)}
          onDrag=${(v) => set({ angle: v }, false)}
          onCommit=${(v) => set({ angle: v }, true)}
          caption="How far apart the speakers being simulated are. Narrower blends the channels more; wider approaches plain headphones."
        />
        <${Control}
          label="Head circumference"
          unit=" cm"
          min="41"
          max="66"
          step="0.5"
          value=${p0.headRadius * 2 * Math.PI * 100}
          format=${(v) => v.toFixed(1)}
          sub=${`${(p0.headRadius * 100).toFixed(2)} cm radius`}
          onDrag=${(v) => set({ headRadius: v / 100 / (2 * Math.PI) }, false)}
          onCommit=${(v) => set({ headRadius: v / 100 / (2 * Math.PI) }, true)}
          caption="Measure with a tape around your head just above the ears — the same figure hat sizes use. The model works from the radius, shown under the value. A larger head means a longer path around it: more delay between the ears and more treble shadowing."
        />
        <${Control}
          label="Center character"
          unit="%"
          min="0"
          max="150"
          step="1"
          value=${Math.round(p0.lambda * 100)}
          format=${(v) => String(Math.round(v))}
          onDrag=${(v) => set({ lambda: v / 100 }, false)}
          onCommit=${(v) => set({ lambda: v / 100 }, true)}
          caption="Speakers color centered sound — vocals, bass, most of a mix — slightly darker than the sides. 100% reproduces that; 0% leaves the center tonally neutral. The stereo image is identical at every setting: only the tone of centered sound changes."
        />
      </div>
      <span class="col-rule" aria-hidden="true"></span>
      <div class="xfs-right">
        <div class="xfs-diagram">
          <${SpeakerDiagram} angle=${p0.angle} headRadius=${p0.headRadius} />
        </div>
        <${Readouts} p=${p} lambda=${p0.lambda} />
      </div>
    </div>
    ${blockers.length && !rec
      ? html`<div class="field-note xfs-blocked">
          Turning this on will also ${blockers.map((b) => b.reason).join(" ")} These land as staged changes you can review before applying.
        </div>`
      : null}
    <button type="button" class="collapsible-head" onClick=${() => (structPlotOpen.value = !structPlotOpen.value)}>
      <span class="tri">${structPlotOpen.value ? "▾" : "▸"}</span> Crossfeed response
      ${structPlotOpen.value
        ? html`<span class="xfs-legend">
            <span class="lg lg-cur">center (at ${Math.round(p0.lambda * 100)}%)</span>
            <span class="lg lg-ghost">center (as speakers)</span>
            <span class="lg lg-side">sides</span>
          </span>`
        : null}
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
function StructuralPlot({ p0 }) {
  const freqs = logFreqs(20, 20000, 140);
  const at = (lambda) => (f) => midSideResponse(f, { ...p0, lambda });
  const cur = at(p0.lambda);
  const lit = at(1);
  const trace = (fn) => freqs.map((f) => [f, fn(f)]);
  // labels live in the section header, not on the curves: three traces converge
  // where the labels would sit and overlapped each other illegibly
  const traces = [
    { points: trace((f) => magDb(lit(f).mid)), kind: "ghost", label: "" },
    { points: trace((f) => magDb(cur(f).mid)), kind: "xfm", label: "" },
    { points: trace((f) => magDb(cur(f).side)), kind: "xfs", label: "" },
  ];
  return html`
    <div class="xfs-plot">
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
      <div class="pack split">
        <${Field} k="crossfeed_enabled" />
        <${Field} k="crossfeed_preset" />
      </div>
      <div class="dsp-body ${on ? "" : "off"}">
        <div class="knob-cluster">
          <${Field} k="crossfeed_frequency" />
          <span class="col-rule" aria-hidden="true"></span>
          <${Field} k="crossfeed_level" />
        </div>
        <button type="button" class="collapsible-head" onClick=${() => (plotOpen.value = !open)}>
          <span class="tri">${open ? "▾" : "▸"}</span> Response plot
        </button>
        ${open ? html`<div class="dsp-plot"><${CrossfeedPlot} /></div>` : null}
      </div>
      <button
        type="button"
        class="collapsible-head"
        title="Crossfeed makes centered sound — vocals, bass, most of the mix — slightly duller in the treble than the sides, much as real speakers do. This brings the centered part back to neutral, without touching the crossfeed's stereo effect."
        onClick=${() => (compOpen.value = !compOpen.value)}
      >
        <span class="tri">${compOpen.value ? "▾" : "▸"}</span> Crossfeed compensation
      </button>
      ${compOpen.value
        ? html`
            <${XfeedStrip} />
            <${CompMiniPlot} />
          `
        : null}
    </div>
  `;
}

// --- card --------------------------------------------------------------------

export function CrossfeedCard() {
  const rows = effectivePipelines.value;
  const active = mode(rows);
  const open = cardOpen.value;
  const rec = structuralBlock(rows);

  const toBauer = () => {
    if (rec) issueNote.value = noteFor(removeStructural(rows, rec));
    edit("crossfeed_enabled", "1");
  };
  // A compensation block occupies the same rows and carries Lin gains, so it has
  // to be dismantled back to its plain EQ pair before the structural compiler can
  // build from it. Doing that here rather than refusing is the difference between
  // a toggle that works and one that silently does nothing.
  const toStructural = () => {
    const comp = xfeedBlock(rows).rec;
    const base = comp ? uncompensatedRows(rows, comp) : rows;
    issueNote.value = stageStructural(base, params(base)) || "";
  };

  return html`
    <section class="card">
      <div class="card-head xfs-head">
        <button type="button" class="xfs-head-toggle" onClick=${() => (cardOpen.value = !open)}>
          <span class="tri">${open ? "▾" : "▸"}</span> Crossfeed
        </button>
        <${Segment}
          value=${active}
          options=${[
            { value: "bauer", label: "Bauer" },
            { value: "structural", label: "Structural" },
          ]}
          onChange=${(v) => (v === "bauer" ? toBauer() : toStructural())}
        />
      </div>
      ${issueNote.value ? html`<div class="mtx-issues xfs-issue">${issueNote.value}</div>` : null}
      ${open
        ? html`<div class="card-body">
            ${active === "structural" ? html`<${StructuralMode} rows=${rows} />` : html`<${BauerMode} />`}
          </div>`
        : null}
    </section>
  `;
}
