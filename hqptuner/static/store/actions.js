// The store's write side: staging an edit, discarding, previewing a preset, and
// the apply/save lifecycle. Everything here mutates a signal in store/signals.js
// and/or POSTs through lib/api.js; the read side is store/resolve.js.

import { signal, computed } from "@preact/signals";
import { api } from "../lib/api.js";
import { schema } from "./schema.js";
import { summarize } from "./apply-summary.js";
import { truthy } from "../lib/coerce.js";
import { config, volume, staged, liveOverride, previewConfig, pendingPreset } from "./signals.js";
import { canonPipelines, stagedCount, activePreset } from "./resolve.js";
import { mirror, refreshConfig } from "./sync.js";

// Stage the whole pipeline set (optimistic, like edit()). A set identical to
// baseline still stages — isDirty's string compare then reads clean, same as any
// field. Latest-wins: rapid successive edits (stage editor keystrokes) each POST;
// an EARLIER request's response must not clobber a LATER optimistic value, so only
// the newest in-flight call is allowed to adopt the server's echo.
let stageSeq = 0;
export async function stagePipelines(rows) {
  const json = canonPipelines(rows);
  staged.value = { live: staged.value.live, http: { ...staged.value.http, matrix_pipelines: json } };
  const seq = ++stageSeq;
  const echo = await api.stage({ live: {}, http: { matrix_pipelines: json } });
  if (seq === stageSeq) staged.value = echo;
}

// Stage one edit. Live edits merge into their liveKey bucket (so a control that
// shares a setter — e.g. filter 1x/Nx — keeps its sibling's arg). Pushes to the
// server pending store so staging survives a browser reload, then re-mirrors it.
// Live knob-drag override (see liveOverride): setLive updates instantly with no
// server hit; the commit path (edit) stages the value then clears the override.
export function setLive(key, value) {
  liveOverride.value = { ...liveOverride.value, [key]: String(value) };
}

function clearLive(key) {
  if (!(key in liveOverride.value)) return;
  const next = { ...liveOverride.value };
  delete next[key];
  liveOverride.value = next;
}

// Bauer crossfeed preset <-> params coupling: selecting a named preset loads its
// frequency/level (so the graph shows that preset); adjusting either param
// switches the preset to "custom". Values are the libbs2b canonical parameter
// sets HQPlayer's Bauer plugin is built on. Applied within the same stage POST
// as the primary edit, so the coupled fields move together.
const BAUER_PRESETS = { default: ["700", "4.5"], cmoy: ["700", "6.0"], jmeier: ["650", "9.5"] };

function applyBauerCoupling(key, value, http) {
  if (key === "crossfeed_preset" && BAUER_PRESETS[value]) {
    const [f, l] = BAUER_PRESETS[value];
    http.post_bauer_frequency = f;
    http.post_bauer_level = l;
  } else if (key === "crossfeed_frequency" || key === "crossfeed_level") {
    http.post_bauer_preset = "custom";
  }
}

// Fixed volume and Auto headroom (volume_fixed) are mutually exclusive fixed-
// volume modes, and either one on bypasses the live volume control. Graying one
// from the other is the trap that already shipped once: a grayed-but-nonzero
// Auto headroom kept the volume control locked with no reachable control left to
// clear it. So enabling either mode CLEARS the other, as a visible staged edit
// in the same POST — the pending bar shows both moves, nothing happens silently.
function applyFixedVolumeCoupling(key, value, http) {
  const on = truthy(value);
  if (key === "fixed_volume_enabled" && on) http.volume_fixed = "0";
  else if (key === "optimal_iso" && String(value) !== "0") http.fixed_volume_enabled = "0";
}

export async function edit(key, value) {
  const e = schema[key];
  if (!e) return;
  // The last apply's verdict is about the set the user just changed, so it stops
  // being true here. The pending bar shows a FAILED verdict alongside the staged
  // count (a failed apply keeps its staging), and a stale one sitting next to a
  // fresh edit would read as this edit having failed before it was ever sent.
  lastApply.value = null;
  const body = { live: {}, http: {} };
  if (e.lane === "live") {
    const prior = staged.value.live[e.liveKey] || {};
    body.live[e.liveKey] = { ...prior, [e.arg || "value"]: String(value) };
  } else {
    body.http[e.field] = String(value);
  }
  applyBauerCoupling(key, value, body.http);
  applyFixedVolumeCoupling(key, value, body.http);
  // optimistic local merge so a knob release reflects instantly (no flicker to
  // baseline during the stage round-trip), then drop the live-drag override.
  staged.value = {
    live: { ...staged.value.live, ...body.live },
    http: { ...staged.value.http, ...body.http },
  };
  clearLive(key);
  staged.value = await api.stage(body);
}

export async function discardAll() {
  clearPreview();
  staged.value = await api.discard();
}

/** @public — symmetric half of previewPreset; the clearer for a previewed preset. */
// Load a preset's saved settings into the editor as the baseline (no daemon
// touch) — the user tweaks, then Apply commits the switch.
//
// Selecting the ALREADY-ACTIVE preset is not a switch: its values are already
// the baseline, so pending it would light Apply for a no-op and — worse — Apply
// would then fire a destructive `switch_to` reload of the preset already loaded.
// Treat it as clearing the preview instead. Any staged field edits stand on
// their own and still read as dirty over the active baseline.
export async function previewPreset(name) {
  if (name === activePreset.value) {
    clearPreview();
    return;
  }
  const r = await api.preset(name);
  previewConfig.value = (r && r.config) || {};
  pendingPreset.value = name;
}

// Kept exported with no current caller: it is the symmetric half of the exported
// previewPreset, and a preview API that can start but not clear is a trap.
/** @public */
export function clearPreview() {
  pendingPreset.value = null;
  previewConfig.value = null;
}

// Delete a stored preset (store + daemon mirror), then refresh so the picker
// drops it. Clears the preview if the deleted preset was the one being previewed.
export async function deletePreset(name) {
  if (!name) return;
  await api.deletePreset(name);
  if (pendingPreset.value === name) clearPreview();
  await refreshConfig();
}

// apply lifecycle, shared so the pill and the pending bar both reflect it
export const applying = signal(false);
export const lastApply = signal(null); // {ok, text} of the most recent apply

// Both write lanes share a lifecycle: hold `applying` for the duration so the
// pill and the pending bar can show it, and report a thrown failure as a
// `lastApply` the user can read rather than a rejected promise nobody catches.
// The lane still rethrows — the caller decides what a hard failure means.
async function applyLane(run, what) {
  applying.value = true;
  try {
    return await run();
  } catch (e) {
    lastApply.value = { ok: false, text: `${what} failed: ${e.message}` };
    throw e;
  } finally {
    applying.value = false;
  }
}

// Apply the staged set. The backend keeps staging on a soft failure, so on
// return we re-mirror it: a failed/held edit stays staged and — once the poll
// loop marks the daemon reachable again — the Apply button re-enables itself.
export async function applyAll(save) {
  const count = stagedCount.value; // capture before apply clears the staged set
  // never send a switch to the preset already loaded — that reload is a no-op
  // that trips the daemon's empty-/backup bug and leaves Apply stuck lit.
  // Tested against null, not truthiness: "(no preset)" IS a previewed target and
  // its name is the empty string, so a falsy test dropped it silently and left
  // the picker showing a switch Apply would never send.
  const previewed = pendingPreset.value;
  const switchTo = previewed !== null && previewed !== activePreset.value ? previewed : null;
  return applyLane(async () => {
    const body = {};
    if (save) body.save = save;
    if (switchTo !== null) body.switch_to = switchTo;
    const report = await api.apply(Object.keys(body).length ? body : undefined);
    await refreshConfig(); // re-mirror pending + fresh values (dropdown picks up a new preset)
    lastApply.value = summarize(report, count);
    if (lastApply.value.ok) clearPreview(); // switch committed — drop the preview
    return report;
  }, "Apply");
}

// Standalone save — persist the CURRENT running config to a named preset with
// nothing staged (the "I like this, keep it" path). Reuses the applying signal:
// the save lane POSTs /restore, so the daemon briefly restarts just like an apply.
export async function savePresetOnly(name) {
  return applyLane(async () => {
    const r = await api.profile("save", name);
    lastApply.value = r.ok
      ? { ok: true, text: `Saved to "${r.name}"` }
      : { ok: false, text: `Save to "${r.name}" failed: ${r.error}` };
    await refreshConfig();
    return r;
  }, "Save");
}

// Auto-save: with this preset-store flag on, the backend folds every successful apply/live write into the active preset.
export const autosave = computed(() => !!(config.value && config.value.autosave));
export async function setAutosave(enabled) {
  await api.setAutosave(enabled);
  await mirror(api.config, config);
}

// Immediate live-volume write. Echoes the readback level into `volume` so the
// slider reflects the applied value without waiting for the next poll.
export async function setVolume(level) {
  const r = await api.setVolume(level);
  if (r && r.volume != null) volume.value = r.volume;
  return r;
}
