// Hardware-acceleration card + config restore. These live outside the staged
// config/matrix form: the four engine attributes (cuda/multicore/ecores/nblocks)
// are file-only (no /config field, no live setter), so they apply through their
// own POST /api/engine — a backup-edit-restore that self-restarts the daemon and
// preserves the active preset. Restore uploads a settings.zip the same way. Both
// interrupt playback, so the backend idle-gates (409 when playing).

import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { html } from "../store/dom.js";
import { api } from "../store/api.js";
import { metadata } from "../store/state.js";
import { notesVisible } from "../store/prefs.js";
import { RadioGroup, Checkbox, Slider } from "./controls/index.js";

// settings.json system-group prose (Phase 1 manual/readme extraction). These four
// engine attributes live outside the schema/Field path, so pull their notes here.
// Gated by the same show-descriptions pref as the Field notes.
const sysNote = (key) => {
  const s = metadata.value && metadata.value.settings && metadata.value.settings.system;
  return (s && s[key] && s[key].tooltip) || "";
};
const Note = ({ k }) => (notesVisible.value && sysNote(k) ? html`<div class="field-note">${sysNote(k)}</div>` : null);

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

// daemon defaults when the attribute is absent from the config (manual §1.2)
const DEFAULTS = { cuda: "0", multicore: "auto", ecores: "default", nblocks: "0" };

const cuda = signal(DEFAULTS.cuda);
const multicore = signal(DEFAULTS.multicore);
const ecores = signal(DEFAULTS.ecores);
const nblocks = signal(DEFAULTS.nblocks);
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
    };
    const r = await api.applyEngine({ overrides, all_presets: allPresets.value });
    status.value = r && r.verified && r.verified.applied ? "Applied." : "Submitted — not confirmed.";
  } catch (err) {
    status.value = String(err).includes("409") ? "Stop playback first (daemon busy)." : `Failed: ${err}`;
  }
}

const manual = () => nblocks.value !== "0";

export function HardwareCard() {
  useEffect(() => {
    if (!loaded.value) load().catch((e) => (status.value = `Load failed: ${e}`));
  }, []);
  return html`
    <section class="card">
      <div class="card-head">Hardware acceleration</div>
      <div class="card-body">
        <div class="field"><label>CUDA offload</label>
          <div class="control"><${RadioGroup} value=${cuda.value} options=${CUDA} onChange=${(v) => (cuda.value = v)} /></div>
          <${Note} k="cuda_offload" />
        </div>
        <div class="field"><label>Multicore DSP</label>
          <div class="control"><${RadioGroup} value=${multicore.value} options=${MULTICORE} onChange=${(v) => (multicore.value = v)} /></div>
          <${Note} k="multicore_dsp" />
        </div>
        <div class="field"><label>E-core allocation</label>
          <div class="control"><${RadioGroup} value=${ecores.value} options=${ECORES} onChange=${(v) => (ecores.value = v)} /></div>
          <${Note} k="ecore_allocation" />
        </div>
        <div class="field"><label>Blocks / cycle</label>
          <div class="control">
            <${Checkbox} value=${manual()} onChange=${(v) => (nblocks.value = v === "1" ? "8" : "0")} />
            <span class="unit">Manual</span>
            ${manual()
              ? html`<${Slider} value=${nblocks.value} min=${1} max=${16} step=${1} onChange=${(v) => (nblocks.value = String(v))} />`
              : html`<span class="unit">Default (auto)</span>`}
          </div>
          <${Note} k="blocks_per_cycle" />
        </div>
        <div class="hw-apply">
          <label class="hw-all"><${Checkbox} value=${allPresets.value} onChange=${(v) => (allPresets.value = v === "1")} /> Apply to all presets</label>
          <button type="button" class="btn" onClick=${apply}>Apply hardware settings</button>
          ${status.value ? html`<span class="hw-status">${status.value}</span>` : null}
        </div>
      </div>
    </section>
  `;
}

const restoreStatus = signal("");

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

export function RestoreCard() {
  return html`
    <section class="card">
      <div class="card-head">Restore</div>
      <div class="card-body">
        <label class="btn">Upload settings backup<input type="file" accept=".zip,.xml" style="display:none" onChange=${onRestore} /></label>
        ${restoreStatus.value ? html`<span class="hw-status">${restoreStatus.value}</span>` : null}
      </div>
    </section>
  `;
}
