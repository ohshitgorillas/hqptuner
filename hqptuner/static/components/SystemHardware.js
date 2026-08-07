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

async function load() {
  const r = await api.engine();
  const e = (r && r.engine) || {};
  cuda.value = e.cuda ?? DEFAULTS.cuda;
  multicore.value = e.multicore ?? DEFAULTS.multicore;
  ecores.value = e.ecores ?? DEFAULTS.ecores;
  nblocks.value = e.nblocks ?? DEFAULTS.nblocks;
  cudaDev.value = e.cuda_dev ?? DEFAULTS.cuda_dev;
  cudaCdev.value = e.cuda_cdev ?? DEFAULTS.cuda_cdev;
  loaded.value = true;
}

async function apply() {
  status.value = "applying";
  try {
    const overrides = {
      cuda: cuda.value,
      multicore: multicore.value,
      ecores: ecores.value,
      nblocks: nblocks.value,
      cuda_dev: cudaDev.value,
      cuda_cdev: cudaCdev.value,
    };
    const r = await api.applyEngine({ overrides, all_presets: allPresets.value });
    status.value = r && r.verified && r.verified.applied ? "Applied." : "Submitted — not confirmed.";
  } catch (err) {
    status.value = String(err).includes("409") ? "Stop playback first (daemon busy)." : `Failed: ${err}`;
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
    <div class="field ${cudaOff() ? "off" : ""}" title=${hoverFor("cuda_devices")}>
      <label>CUDA devices</label>
      <div class="control cuda-devs">
        <span class="cuda-dev ${convOnly() ? "off" : ""}">
          <span class="unit">DSP</span>
          <${NumberBox}
            value=${cudaDev.value}
            min=${-1}
            disabled=${cudaOff() || convOnly()}
            onChange=${(/** @type {Edit} */ v) => (cudaDev.value = String(v))}
          />
        </span>
        <span class="cuda-dev">
          <span class="unit">Convolution</span>
          <${NumberBox}
            value=${cudaCdev.value}
            min=${-1}
            disabled=${cudaOff()}
            onChange=${(/** @type {Edit} */ v) => (cudaCdev.value = String(v))}
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
    <div class="field" title=${hoverFor("blocks_per_cycle")}>
      <label>Blocks / cycle</label>
      <div class="control">
        <label class="inline-check">
          <${Checkbox} value=${manual()} onChange=${(/** @type {Edit} */ v) => (nblocks.value = v === "1" ? "8" : "0")} />
          Set manually
        </label>
        ${
          manual()
            ? html`<${Slider}
                value=${nblocks.value}
                min=${1}
                max=${16}
                step=${1}
                onChange=${(/** @type {Edit} */ v) => (nblocks.value = String(v))}
              />`
            : html`<span class="unit">Automatic — chosen from CPU cache size</span>`
        }
      </div>
      <${Note} k="blocks_per_cycle" />
    </div>
  `;
}

export function HardwareCard() {
  useEffect(() => {
    if (!loaded.value) load().catch((e) => (status.value = `Load failed: ${e}`));
  }, []);
  return html`
    <${Card} title="Hardware acceleration">
        <!-- chain: CUDA offload + its device ids stack in the LEFT track, the CPU
             pair (Multicore DSP, E-core allocation) in the right, so each column
             is one subsystem instead of splitting them by source order. -->
        <${ChainPack}>
          <div class="field" title=${hoverFor("cuda_offload")}>
            <label>CUDA offload</label>
            <div class="control">
              <${RadioGroup} value=${cuda.value} options=${CUDA} onChange=${(/** @type {Edit} */ v) => (cuda.value = v)} />
            </div>
            <${Note} k="cuda_offload" />
          </div>
          <${CudaDevicesField} />
          <div class="field" title=${hoverFor("multicore_dsp")}>
            <label>Multicore DSP</label>
            <div class="control">
              <${RadioGroup} value=${multicore.value} options=${MULTICORE} onChange=${(/** @type {Edit} */ v) => (multicore.value = v)} />
            </div>
            <${Note} k="multicore_dsp" />
          </div>
          <div class="field" title=${hoverFor("ecore_allocation")}>
            <label>E-core allocation</label>
            <div class="control">
              <${RadioGroup} value=${ecores.value} options=${ECORES} onChange=${(/** @type {Edit} */ v) => (ecores.value = v)} />
            </div>
            <${Note} k="ecore_allocation" />
          </div>
        <//>
        <!-- outside the chain pack: it splits after the leading pair, so
             Blocks / cycle is a plain full-width row below instead. -->
        <${BlocksPerCycleField} />
        <div class="hw-apply">
          <label class="hw-all"
            ><${Checkbox} value=${allPresets.value} onChange=${(/** @type {Edit} */ v) => (allPresets.value = v === "1")} /> Apply to all
            presets</label
          >
          <button type="button" class="btn" onClick=${apply}>Apply hardware settings</button>
          ${status.value ? html`<span class="hw-status">${status.value}</span>` : null}
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
