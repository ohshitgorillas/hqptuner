// The store's write side: staging an edit, discarding, previewing a preset, and
// the apply/save lifecycle. Everything here mutates a signal in store/signals.js
// and/or POSTs through lib/api.js; the read side is store/resolve.js.

import { signal, computed } from "@preact/signals";
import { api } from "../lib/api.js";
import { errText } from "../lib/errtext.js";
import { schema } from "./schema.js";
import { summarize } from "./apply-summary.js";
import { truthy } from "../lib/coerce.js";
import { config, volume, staged, liveOverride, previewConfig, pendingPreset } from "./signals.js";
import { canonPipelines, stagedCount, activePreset, cleanStagedKeys } from "./resolve.js";
import { mirror, refreshConfig } from "./sync.js";
import { guard } from "./guards.js";

// Latest-wins on the pipelines path: rapid successive edits (stage editor
// keystrokes) each POST, and an EARLIER request's response must not clobber a
// LATER optimistic value, so only the newest in-flight call is allowed to adopt
// the server's echo.
let stageSeq = 0;

// Every stage POST also carries the entries that have gone clean (`drop`), which
// the server removes from its buffer. Computed AFTER the optimistic merge below,
// so the edit being staged is judged in the state the user just put it in: an
// edit returning a control to its baseline reports itself, in the same request
// that stages it, and the server's merge-then-drop order settles it.
/**
 * @typedef {object} StageBody
 *   One stage POST's edits, in the two lanes' own key domains: `live` is nested
 *   one level (setter key -> arg -> value), `http` is flat form-field names.
 * @property {Record<string, Record<string, string>>} live
 * @property {Record<string, string>} http
 */

const stageBody = (/** @type {StageBody} */ body) => ({ ...body, drop: cleanStagedKeys() });

// Stage the whole pipeline set (optimistic, like edit()). A set identical to
// baseline still stages — isDirty's string compare then reads clean, same as any
// field, and `drop` is what stops that clean entry sitting in the buffer.
/**
 * Stage the whole pipeline set as one canonical-JSON http-lane field.
 *
 * @param {import("./resolve.js").PipelineRow[]} rows
 * @param {Record<string, string>} [extra] further http-lane fields, same POST
 * @returns {Promise<void>}
 */
export async function stagePipelines(rows, extra = {}) {
  await stageHttp({ matrix_pipelines: canonPipelines(rows), ...extra });
}

// Stage http-lane fields under their WIRE names, no schema lookup. `edit()` takes
// a schema key and resolves `e.field` from it; a saved profile's post-process
// mapping is already keyed by wire names (matrix_pipelines, post_bauer_*), so it
// has no schema key to go through. Latest-wins like stagePipelines.
/**
 * @param {Record<string, string>} fields
 * @returns {Promise<void>}
 */
async function stageHttp(fields) {
  staged.value = { live: staged.value.live, http: { ...staged.value.http, ...fields } };
  const seq = ++stageSeq;
  const echo = await api.stage(stageBody({ live: {}, http: fields }));
  if (seq === stageSeq) staged.value = echo;
}

// Stage one edit. Live edits merge into their liveKey bucket (so a control that
// shares a setter — e.g. filter 1x/Nx — keeps its sibling's arg). Pushes to the
// server pending store so staging survives a browser reload, then re-mirrors it.
// Live knob-drag override (see liveOverride): setLive updates instantly with no
// server hit; the commit path (edit) stages the value then clears the override.
/**
 * Record a knob's in-drag value as a local override, with no server hit.
 *
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {void}
 */
export function setLive(key, value) {
  liveOverride.value = { ...liveOverride.value, [key]: String(value) };
}

/**
 * @param {string} key
 * @returns {void}
 */
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
/** @type {Record<string, [string, string]>} */
const BAUER_PRESETS = { default: ["700", "4.5"], cmoy: ["700", "6.0"], jmeier: ["650", "9.5"] };

/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @param {Record<string, string>} http the same POST's http lane, written in place
 * @returns {void}
 */
function applyBauerCoupling(key, value, http) {
  if (key === "crossfeed_preset" && BAUER_PRESETS[String(value)]) {
    const [f, l] = BAUER_PRESETS[String(value)];
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
/**
 * @param {string} key
 * @param {string | number | boolean} value
 * @param {Record<string, string>} http the same POST's http lane, written in place
 * @returns {void}
 */
function applyFixedVolumeCoupling(key, value, http) {
  const on = truthy(value);
  if (key === "fixed_volume_enabled" && on) http.volume_fixed = "0";
  else if (key === "optimal_iso" && String(value) !== "0") http.fixed_volume_enabled = "0";
}

/**
 * Stage one schema-key edit into its lane, with the coupled fields it drags along.
 *
 * @param {string} key
 * @param {string | number | boolean} value
 * @returns {Promise<void>}
 */
export async function edit(key, value) {
  const e = schema[key];
  if (!e) return;
  const ask = guard(key, value);
  if (ask && !(await ask)) {
    // Declining stages nothing, but the control's DOM already shows the value
    // the user picked. Nothing here changed a signal, so no re-render would
    // snap it back until the next poll tick — a visible seconds-long lag.
    // Bump the staged identity (contents untouched) so every field re-renders
    // now and the control returns to its baseline immediately.
    staged.value = { ...staged.value };
    return;
  }
  // The last apply's verdict is about the set the user just changed, so it stops
  // being true here. The pending bar shows a FAILED verdict alongside the staged
  // count (a failed apply keeps its staging), and a stale one sitting next to a
  // fresh edit would read as this edit having failed before it was ever sent.
  lastApply.value = null;
  /** @type {StageBody} */
  const body = { live: {}, http: {} };
  // liveKey/field are optional on SchemaField for want of a lane discriminator
  // (store/resolve.js); each lane's own entries always carry theirs.
  if (e.lane === "live") {
    const liveKey = e.liveKey || "";
    const prior = staged.value.live[liveKey] || {};
    body.live[liveKey] = { ...prior, [e.arg || "value"]: String(value) };
  } else {
    body.http[e.field || ""] = String(value);
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
  staged.value = await api.stage(stageBody(body));
}

/** Throw away every staged edit and the previewed preset with them. */
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
/**
 * Load a preset's saved settings in as the editor's baseline, pending Apply.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
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
/**
 * Drop the previewed preset, leaving the editor back on the active baseline.
 *
 * @public
 */
export function clearPreview() {
  pendingPreset.value = null;
  previewConfig.value = null;
}

// Delete a stored preset (store + daemon mirror), then refresh so the picker
// drops it. Clears the preview if the deleted preset was the one being previewed.
/**
 * Delete a stored preset and refresh the config so the picker drops it.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function deletePreset(name) {
  if (!name) return;
  await api.deletePreset(name);
  if (pendingPreset.value === name) clearPreview();
  await refreshConfig();
}

// apply lifecycle, shared so the pill and the pending bar both reflect it
export const applying = signal(false);
export const lastApply = /** @type {{ value: import("./apply-summary.js").Verdict | null }} */ (signal(null));

// Both write lanes share a lifecycle: hold `applying` for the duration so the
// pill and the pending bar can show it, and report a thrown failure as a
// `lastApply` the user can read rather than a rejected promise nobody catches.
// The lane still rethrows — the caller decides what a hard failure means.
/**
 * @template T
 * @param {() => Promise<T>} run
 * @param {string} what lane name, for the failure sentence
 * @returns {Promise<T>}
 */
async function applyLane(run, what) {
  applying.value = true;
  try {
    return await run();
  } catch (e) {
    lastApply.value = { ok: false, code: "lane-failed", text: `${what} failed: ${errText(e)}` };
    throw e;
  } finally {
    applying.value = false;
  }
}

// Apply the staged set. The backend keeps staging on a soft failure, so on
// return we re-mirror it: a failed/held edit stays staged and — once the poll
// loop marks the daemon reachable again — the Apply button re-enables itself.
/**
 * Apply the staged set, committing any previewed preset switch with it, and
 * record the outcome in `lastApply`.
 *
 * @param {{ name: string }} [save] preset to save into as part of the apply. An
 *   OBJECT, not a bare name: it goes out as the request body's `save`, and the
 *   backend reads `body.save.name` (api/routes/apply.py:58, models.py SaveTarget).
 * @returns {Promise<import("./apply-summary.js").ApplyReport>}
 */
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
    /** @type {{ save?: { name: string }, switch_to?: string }} */
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
/**
 * Persist the running config to a named preset without applying anything staged.
 *
 * @param {string} name
 * @returns {Promise<import("./apply-summary.js").SaveResult>}
 */
export async function savePresetOnly(name) {
  return applyLane(async () => {
    const r = await api.profile("save", name);
    lastApply.value = r.ok
      ? { ok: true, code: "saved", text: `Saved to "${r.name}"`, preset: r.name, save: "ok" }
      : { ok: false, code: "saved", text: `Save to "${r.name}" failed: ${r.error}`, preset: r.name, save: "failed" };
    await refreshConfig();
    return r;
  }, "Save");
}

// Auto-save: with this preset-store flag on, the backend folds every successful apply/live write into the active preset.
export const autosave = computed(() => !!(config.value && config.value.autosave));
/**
 * Turn the preset store's auto-save flag on or off, then re-mirror the config.
 *
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setAutosave(enabled) {
  await api.setAutosave(enabled);
  await mirror(api.config, config);
}

// Immediate live-volume write. Echoes the readback level into `volume` so the
// slider reflects the applied value without waiting for the next poll.
/**
 * Write the volume level to the daemon immediately and echo the readback into
 * the `volume` signal.
 *
 * @param {string | number} level dB
 * @returns {Promise<{ volume?: string }>}
 */
export async function setVolume(level) {
  const r = await api.setVolume(level);
  if (r && r.volume != null) volume.value = r.volume;
  return r;
}
