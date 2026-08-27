// Hardware-acceleration card + config restore. These live outside the staged
// config/matrix form: the four engine attributes (cuda/multicore/ecores/nblocks)
// are file-only (no /config field, no live setter), so they apply through their
// own POST /api/engine — a backup-edit-restore that self-restarts the daemon and
// preserves the active preset. Restore uploads a settings.zip the same way. Both
// interrupt playback — never refused for it; the user decides when.

import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { metadata } from "../store/signals.js";
import { notesVisible } from "../store/prefs.js";
import { RadioGroup, Checkbox, Slider, NumberBox } from "./controls/index.js";
import { Card } from "./common.js";
import { ChainPack } from "./ChainPack.js";

/**
 * @typedef {string | number} Edit
 *   What the controls in controls/index.js report an edit as: the DOM's own
 *   string, or an option list's value where that was a number.
 */

// settings.json system-group prose (Phase 1 manual/readme extraction). These four
// engine attributes live outside the schema/Field path, so pull their notes here.
// Gated by the same show-descriptions pref as the Field notes.
/**
 * @param {string} key a settings.json system-group key
 * @returns {string}
 */
const sysNote = (key) => {
  const s = metadata.value && metadata.value.settings && metadata.value.settings.system;
  return (s && s[key] && s[key].tooltip) || "";
};
/** @param {{ k: string }} props */
const Note = ({ k }) => (notesVisible.value && sysNote(k) ? html`<div class="field-note">${sysNote(k)}</div>` : null);
// Hover tooltip for these hand-rolled fields (the Field component wires this
// automatically; these live outside it). Mirrors Field: hover carries the prose
// only when the inline note is hidden, so a visible note isn't duplicated.
/**
 * @param {string} k
 * @returns {string}
 */
const hoverFor = (k) => (notesVisible.value ? "" : sysNote(k));

const CUDA = [
  { value: "0", label: "Disabled" },
  { value: "1", label: "Full offload" },
  { value: "convolution", label: "Convolution only" },
];
const MULTICORE = [
  { value: "auto", label: "Auto" },
  { value: "1", label: "Enabled" },
  { value: "0", label: "Disabled" },
];
const ECORES = [
  { value: "default", label: "Disabled" },
  { value: "pool", label: "DSP pool" },
  { value: "filter", label: "Resampling" },
];

// daemon defaults when the attribute is absent from the config (manual §1.2).
// cuda_dev / cuda_cdev: -1 = automatic device selection.
const DEFAULTS = { cuda: "0", multicore: "auto", ecores: "default", nblocks: "0", cuda_dev: "-1", cuda_cdev: "-1" };

const cuda = signal(DEFAULTS.cuda);
const multicore = signal(DEFAULTS.multicore);
const ecores = signal(DEFAULTS.ecores);
const nblocks = signal(DEFAULTS.nblocks);
const cudaDev = signal(DEFAULTS.cuda_dev);
const cudaCdev = signal(DEFAULTS.cuda_cdev);
const allPresets = signal(false);
const status = signal(""); // "", "applying", or a result message
const loaded = signal(false);

/**
 * @typedef {"" | "busy" | "ok" | "warn" | "err"} Outcome
 *   What the status message IS, beside what it says. The sentence is owner copy
 *   and gets reworded; this is the machine-readable half, and it is what decides
 *   the message's color and whether it expires on its own.
 */

const outcome = signal(/** @type {Outcome} */ (""));

// A confirmed apply is a receipt and expires; anything else carries a reason the
// user has to act on and stays until they edit, revert, or apply again.
const APPLIED_MS = 5000;

/**
 * Say something in the status line, or say nothing when called with two empties.
 *
 * @param {string} text
 * @param {Outcome} kind
 */
const say = (text, kind) => {
  status.value = text;
  outcome.value = kind;
};
// What the daemon last reported, or last accepted. A setting differing from this
// is a staged edit. The card sits outside the staged config form, so the pending
// bar never counts it and nothing else would mark it as changed.
const base = signal({ ...DEFAULTS });

/** @type {(keyof typeof DEFAULTS)[]} */
const KEYS = ["cuda", "multicore", "ecores", "nblocks", "cuda_dev", "cuda_cdev"];

/** The six settings as they stand, in the shape `base` holds and `apply` sends. */
const current = () => ({
  cuda: cuda.value,
  multicore: multicore.value,
  ecores: ecores.value,
  nblocks: nblocks.value,
  cuda_dev: cudaDev.value,
  cuda_cdev: cudaCdev.value,
});

// Diffed against the snapshot rather than accumulated as an edit set, so a value
// changed and changed back reads clean.
const dirty = () => {
  const now = current();
  const was = base.value;
  return KEYS.some((k) => now[k] !== was[k]);
};

/**
 * Assign one setting and drop any status left from an earlier apply: "Applied."
 * beside a field that has since changed states the opposite of what is true.
 *
 * @param {{ value: string }} sig the setting's signal
 * @param {string} v
 */
const set = (sig, v) => {
  sig.value = v;
  say("", "");
};

function revert() {
  const was = base.value;
  cuda.value = was.cuda;
  multicore.value = was.multicore;
  ecores.value = was.ecores;
  nblocks.value = was.nblocks;
  cudaDev.value = was.cuda_dev;
  cudaCdev.value = was.cuda_cdev;
  say("", "");
}

async function load() {
  const r = await api.engine();
  const e = (r && r.engine) || {};
  cuda.value = e.cuda ?? DEFAULTS.cuda;
  multicore.value = e.multicore ?? DEFAULTS.multicore;
  ecores.value = e.ecores ?? DEFAULTS.ecores;
  nblocks.value = e.nblocks ?? DEFAULTS.nblocks;
  cudaDev.value = e.cuda_dev ?? DEFAULTS.cuda_dev;
  cudaCdev.value = e.cuda_cdev ?? DEFAULTS.cuda_cdev;
  base.value = current();
  loaded.value = true;
}

async function apply() {
  say("applying", "busy");
  try {
    const overrides = current();
    const r = await api.applyEngine({ overrides, all_presets: allPresets.value });
    // The lane answers `submitted: false` with an `error` and no `verified` at
    // all when the restore itself was refused. Nothing reached the daemon, so
    // this is a failure to act on, not a submission waiting to be confirmed.
    if (r && r.submitted === false) {
      say(`Failed: ${r.error}`, "err");
      return;
    }
    const applied = Boolean(r && r.verified && r.verified.applied);
    // Only a confirmed apply re-snapshots: an unconfirmed one leaves the card
    // marked, which is the honest reading of a submission nothing verified.
    if (applied) base.value = overrides;
    if (applied) say("Applied.", "ok");
    else say("Submitted — not confirmed.", "warn");
  } catch (err) {
    if (String(err).includes("409")) say("Stop playback first (daemon busy).", "err");
    else say(`Failed: ${err}`, "err");
  }
}

const manual = () => nblocks.value !== "0";
// Device ids only bite when something is actually offloaded to a GPU.
const cudaOff = () => cuda.value === "0";
// Convolution-only mode offloads only convolution algorithms (manual, Advanced
// tab): cuda_dev drives "filters and other DSP tasks", so it goes unused there.
const convOnly = () => cuda.value === "convolution";

// The two device ids CUDA offload uses. Convolution-only mode leaves the DSP id
// unused, so it grays with its own reason rather than silently doing nothing.
function CudaDevicesField() {
  return html`
    <div class="field ${cudaOff() ? "off" : ""}" data-k="cuda_devices" title=${hoverFor("cuda_devices")}>
      <label>CUDA devices</label>
      <div class="control cuda-devs">
        <span class="cuda-dev ${convOnly() ? "off" : ""}" data-k="cuda_dev">
          <span class="unit">DSP</span>
          <${NumberBox}
            value=${cudaDev.value}
            min=${-1}
            disabled=${cudaOff() || convOnly()}
            onChange=${(/** @type {Edit} */ v) => set(cudaDev, String(v))}
          />
        </span>
        <span class="cuda-dev" data-k="cuda_cdev">
          <span class="unit">Convolution</span>
          <${NumberBox}
            value=${cudaCdev.value}
            min=${-1}
            disabled=${cudaOff()}
            onChange=${(/** @type {Edit} */ v) => set(cudaCdev, String(v))}
          />
        </span>
        <span class="field-hint">−1 = automatic</span>
      </div>
      ${convOnly() ? html`<div class="field-gray-reason">Convolution-only offload uses the convolution device only.</div>` : null}
      <${Note} k="cuda_devices" />
    </div>
  `;
}

// Automatic unless the user takes it over; taking it over seeds 8.
function BlocksPerCycleField() {
  return html`
    <div class="field" data-k="blocks_per_cycle" title=${hoverFor("blocks_per_cycle")}>
      <label>Blocks / cycle</label>
      <div class="control">
        <label class="inline-check">
          <${Checkbox} value=${manual()} onChange=${(/** @type {Edit} */ v) => set(nblocks, v === "1" ? "8" : "0")} />
          Set manually
        </label>
        ${
          manual()
            ? html`<${Slider}
                value=${nblocks.value}
                min=${1}
                max=${16}
                step=${1}
                onChange=${(/** @type {Edit} */ v) => set(nblocks, String(v))}
              />`
            : html`<span class="unit">Automatic — chosen from CPU cache size</span>`
        }
      </div>
      <${Note} k="blocks_per_cycle" />
    </div>
  `;
}

/** Renders the Hardware acceleration card — CUDA offload and devices, multicore DSP, E-cores, blocks per cycle, apply. */
export function HardwareCard() {
  useEffect(() => {
    if (!loaded.value) load().catch((e) => say(`Load failed: ${e}`, "err"));
  }, []);
  // A confirmed apply's message clears itself; every other outcome stays until
  // the user edits, reverts, or applies again. Keyed on the outcome rather than
  // the sentence so a re-apply that lands the same words restarts the clock.
  useEffect(() => {
    if (outcome.value !== "ok") return undefined;
    const t = setTimeout(() => say("", ""), APPLIED_MS);
    return () => clearTimeout(t);
  }, [outcome.value]);
  return html`
    <${Card} id="hardware-acceleration" title="Hardware acceleration">
        <!-- chain: CUDA offload + its device ids stack in the LEFT track, the CPU
             pair (Multicore DSP, E-core allocation) in the right, so each column
             is one subsystem instead of splitting them by source order. -->
        <${ChainPack}>
          <div class="field" data-k="cuda_offload" title=${hoverFor("cuda_offload")}>
            <label>CUDA offload</label>
            <div class="control">
              <${RadioGroup} value=${cuda.value} options=${CUDA} onChange=${(/** @type {Edit} */ v) => set(cuda, String(v))} />
            </div>
            <${Note} k="cuda_offload" />
          </div>
          <${CudaDevicesField} />
          <div class="field" data-k="multicore_dsp" title=${hoverFor("multicore_dsp")}>
            <label>Multicore DSP</label>
            <div class="control">
              <${RadioGroup} value=${multicore.value} options=${MULTICORE} onChange=${(/** @type {Edit} */ v) => set(multicore, String(v))} />
            </div>
            <${Note} k="multicore_dsp" />
          </div>
          <div class="field" data-k="ecore_allocation" title=${hoverFor("ecore_allocation")}>
            <label>E-core allocation</label>
            <div class="control">
              <${RadioGroup} value=${ecores.value} options=${ECORES} onChange=${(/** @type {Edit} */ v) => set(ecores, String(v))} />
            </div>
            <${Note} k="ecore_allocation" />
          </div>
        <//>
        <!-- outside the chain pack: it splits after the leading pair, so
             Blocks / cycle is a plain full-width row below instead. -->
        <${BlocksPerCycleField} />
        <!-- status first: it owns the row's flexible track, so a message that
             arrives or clears never moves the controls beside it. Rendered
             whether or not it has anything to say, for the same reason. -->
        <div class="hw-apply">
          <span class="hw-status ${outcome.value}">${status.value}</span>
          <label class="hw-all"
            ><${Checkbox} value=${allPresets.value} onChange=${(/** @type {Edit} */ v) => (allPresets.value = v === "1")} /> Apply to all
            presets</label
          >
          <button type="button" class="btn ${dirty() ? "primary" : ""}" data-testid="hw-apply" onClick=${apply}>Apply hardware settings</button>
          <button type="button" class="btn" data-testid="hw-revert" onClick=${revert}>Revert hardware settings</button>
        </div>
    <//>
  `;
}

const restoreStatus = signal("");

/**
 * @param {{ target: HTMLInputElement }} e the file input's change event
 */
async function onRestore(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  restoreStatus.value = "restoring…";
  try {
    await api.restore(file);
    restoreStatus.value = "Restored — daemon restarting.";
  } catch (err) {
    restoreStatus.value = String(err).includes("409") ? "Stop playback first (daemon busy)." : `Failed: ${err}`;
  }
}

// Backup & restore folded into the About card as a maintenance row (its own
// card was two buttons in a half-track of empty surface).
/** Renders the About card's maintenance row — download a config backup, upload one to restore, and the restore status. */
export function BackupRestoreRow() {
  return html`
    <div class="about-maint">
      <div class="backup-row">
        <a class="btn" href="/api/backup" download>Download backup</a>
        <label class="btn"
          >Upload backup<input type="file" accept=".zip,.xml" style="display:none" onChange=${onRestore}
        /></label>
      </div>
      ${restoreStatus.value ? html`<div class="hw-status">${restoreStatus.value}</div>` : null}
    </div>
  `;
}
