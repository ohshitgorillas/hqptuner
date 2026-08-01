// The three-tree store. Source signals only; everything else is computed().
//
//   engine  — live runtime (4321 State/enums/status/health): authority for
//             live-lane control values + the per-mode enum lists + reachability
//   config  — GET /config form: authority for http-lane control values +
//             each field's min/max/enum constraints; the persistent-file baseline
//   staged  — server-side pending buffer ({live, http}); the client mirrors it
//
// Live changes are never persisted, so engine and config can disagree for the
// same setting — that divergence is why these are separate trees (architecture §2).

import { signal, computed, effect } from "@preact/signals";
import { api } from "../lib/api.js";
import { schema } from "./schema.js";
import { fastPollMs } from "./ui.js";
import { summarize } from "./apply-summary.js";
import { truthy } from "../lib/coerce.js";
import {
  health,
  engineState,
  engineStatus,
  enums,
  config,
  matrixConfig,
  metadata,
  volume,
  volumeRange,
} from "./signals.js";
// Re-exported whole so store/state.js stays the store's single import surface.
export * from "./signals.js";

// Preset preview: picking a preset loads its saved settings into the editor as
// the baseline (no daemon touch) so they can be tweaked before Apply commits the
// switch. pendingPreset = the previewed name; previewConfig = its field values.
export const pendingPreset = signal(null);
const previewConfig = signal(null);
const staged = signal({ live: {}, http: {} }); // mirrors server pending
// Transient client-only overrides, set live while a knob is dragged so controls
// and response plots update instantly with no server round-trip per pointer move.
// Committed to `staged` on release, then cleared. Highest priority in effective().
const liveOverride = signal({});

// A form's fields keyed by name — the baseline/constraint source a control
// reads from. Empty until that form has been polled at least once.
const byName = (form) =>
  computed(() => {
    const map = {};
    for (const f of (form.value && form.value.fields) || []) map[f.name] = f;
    return map;
  });

export const configByName = byName(config);
// /matrix fields — the source for the crossfeed/DAC-correction controls
// (endpoint "matrix" in the schema).
export const matrixByName = byName(matrixConfig);

// http-lane field source: /matrix for endpoint "matrix", /config otherwise.
export function httpFieldMap(entry) {
  return entry.endpoint === "matrix" ? matrixByName.value : configByName.value;
}

// The form field a control READS its baseline/options/constraints from. Usually
// entry.field (also the staged key), but the matrix globals stage under prefixed
// names (matrix_engine — the write lane's namespace) while the daemon's form
// field is bare (engine): entry.formField carries the read-side name.
export function formFieldName(entry) {
  return entry.formField || entry.field;
}

// Matrix tab read model: the pipeline rows as the backend parser grouped them.
// The saved-profile half of this model lives in store/profiles.js (round 5).
const matrixRows = computed(() => (matrixConfig.value && matrixConfig.value.rows) || []);

// --- pipeline set (matrix-spec.md "Pipeline flow rows"): staged as ONE atomic canonical-JSON
// field, matching the backend's read_pipelines serialization byte-for-byte
// (alphabetical keys, compact, all-string values) so dirty-compare and the
// apply's verify diff both reduce to string equality.
const canonRow = (r) => ({
  gain: String(r.gain ?? "0"),
  gainunit: r.gainunit || "dB",
  mixdown: String(r.mixdown ?? "0"),
  process: r.process || "",
  source: String(r.source ?? "0"),
});
export const canonPipelines = (rows) => JSON.stringify(rows.map(canonRow));

// Baseline: the file-truth canonical JSON (read_config's matrix_pipelines) when
// credentials allow it; the parsed /matrix form rows otherwise (read-only mode).
export const pipelineBaseline = computed(() => {
  const file = fileConfig.value.matrix_pipelines;
  if (file) {
    try {
      return JSON.parse(file);
    } catch {
      /* fall through to the form rows */
    }
  }
  return matrixRows.value.map(canonRow);
});

// What the pipeline editor renders: staged set if present, else baseline.
export const effectivePipelines = computed(() => {
  const stagedJson = staged.value.http.matrix_pipelines;
  if (stagedJson !== undefined) {
    try {
      return JSON.parse(stagedJson);
    } catch {
      /* corrupt staged value — render baseline */
    }
  }
  return pipelineBaseline.value;
});

// Stage the whole set (optimistic, like edit()). A set identical to baseline
// still stages — isDirty's string compare then reads clean, same as any field.
// Latest-wins: rapid successive edits (stage editor keystrokes) each POST; an
// EARLIER request's response must not clobber a LATER optimistic value, so only
// the newest in-flight call is allowed to adopt the server's echo.
let stageSeq = 0;
export async function stagePipelines(rows) {
  const json = canonPipelines(rows);
  staged.value = { live: staged.value.live, http: { ...staged.value.http, matrix_pipelines: json } };
  const seq = ++stageSeq;
  const echo = await api.stage({ live: {}, http: { matrix_pipelines: json } });
  if (seq === stageSeq) staged.value = echo;
}

// Running config read from the config XML, in form-field terms (manager.file_config).
// The /config form is lossy where a setting's XML domain is wider than the widget
// the daemon renders for it: volume_fixed is 0/1/2 in the XML (off / −3 dB / −6 dB)
// but a bare checkbox on the form, so the form cannot tell −3 from −6. Schema
// entries flagged `fileTruth` take their baseline from here.
const fileConfig = computed(() => (config.value && config.value.file) || {});

// The truly-loaded preset name (ConfigurationGet), as the daemon reports it.
const activePreset = computed(() => (config.value && config.value.active) || "");

// --- three-tree resolution ---
// Each source returns a one-element BOX rather than the value itself: a preset
// or a config file may legitimately ground a field to null or undefined, and
// "grounded to nothing" has to stay distinguishable from "not grounded here".

// A previewed preset's values are the baseline for its grounded fields, so the
// editor shows the preset before it's applied and tweaks read as dirty over it.
function previewedValue(entry) {
  const preview = previewConfig.value;
  return preview && entry.field in preview ? { value: preview[entry.field] } : null;
}

// The config XML is wider than the form for a few settings — volume_fixed is
// 0/1/2 in the file but a bare checkbox on the form — so fileTruth entries take
// the file when it has an answer.
// appliesLive entries ground here too, for the opposite reason: their edits go
// out over the Control API and never reach the XML, so the daemon's /config form
// keeps reporting the superseded value. `file` carries the running truth (the XML
// overlaid with the live lane's changes), which is what the control must show —
// otherwise the dropdown snaps back after Apply and re-selecting the previous
// filter reads as clean, leaving no way to go back to it.
function fileValue(entry) {
  if (!entry.fileTruth && !entry.appliesLive) return null;
  const fv = fileConfig.value[entry.field];
  return fv !== undefined ? { value: fv } : null;
}

// The daemon's own form, last. No file truth available (no credentials, or the
// backup read failed) means falling back to the form's boolean, normalized into
// the field's own domain so a staged "1" doesn't read as dirty against `true`.
function formValue(entry) {
  const f = httpFieldMap(entry)[formFieldName(entry)];
  if (!f) return undefined;
  if (entry.fileTruth && typeof f.value === "boolean") return f.value ? "1" : "0";
  return f.value;
}

function baseline(entry) {
  if (entry.lane === "live") return (engineState.value || {})[entry.stateField];
  // Not a form field: with no file truth (read-only mode) formValue finds nothing
  // and it reads permanently dirty against undefined. pipelineBaseline already
  // picks file-truth-or-form-rows; re-canonicalized to keep the compare a string.
  if (entry.field === "matrix_pipelines") return canonPipelines(pipelineBaseline.value);
  const grounded = previewedValue(entry) || fileValue(entry);
  return grounded ? grounded.value : formValue(entry);
}

function stagedValue(entry) {
  const st = staged.value;
  if (entry.lane === "live") {
    const bucket = st.live[entry.liveKey];
    return bucket ? bucket[entry.arg || "value"] : undefined;
  }
  return st.http[entry.field];
}

// runningValue(key) — the ACTIVE engine/daemon value only: live state or the
// running config forms, ignoring staged edits AND preset preview. For surfaces
// that must reflect what is actually processing right now (signal path, the
// live-volume banner), never the editor's pending picture.
export function runningValue(key) {
  const e = schema[key];
  if (!e) return undefined;
  if (e.lane === "live") return (engineState.value || {})[e.stateField];
  if (e.fileTruth || e.appliesLive) {
    const fv = fileConfig.value[e.field];
    if (fv !== undefined) return fv;
  }
  const f = httpFieldMap(e)[formFieldName(e)];
  return f ? f.value : undefined;
}

// effective(key) — what a control renders: staged edit if present, else baseline.
export function effective(key) {
  const e = schema[key];
  if (!e) return undefined;
  const lo = liveOverride.value[key];
  if (lo !== undefined) return lo; // active knob drag wins
  const sv = stagedValue(e);
  return sv !== undefined ? sv : baseline(e);
}

// Boolean values cross domains: config baseline is a bool, staged is "1"/"0".
// Compare in the control's own domain so a control toggled back to its original
// stops reading as dirty (else it stays highlighted until Discard). That is every
// checkbox plus every `bool` entry — the enable gates render as two-button
// segments but their value is a truth, not a token (see Field.js controlValue).
export function isDirty(key) {
  const e = schema[key];
  if (!e) return false;
  const sv = stagedValue(e);
  if (sv === undefined) return false;
  const base = baseline(e);
  if (e.widget === "checkbox" || e.bool) return truthy(sv) !== truthy(base);
  return String(sv) !== String(base);
}

// --- derived: the pending-changes bar ---
const dirtyKeys = computed(() => Object.keys(schema).filter(isDirty));
export const stagedCount = computed(() => dirtyKeys.value.length);
// Apply is warranted by staged tweaks OR a previewed preset waiting to commit.
export const hasPending = computed(() => stagedCount.value > 0 || pendingPreset.value !== null);
export const split = computed(() => {
  let live = 0;
  let restart = 0;
  for (const k of dirtyKeys.value) {
    // lane 'live' goes out over the Control API; so does an http-lane field the
    // write path routes to a Control API setter (schema appliesLive) — neither
    // restarts the daemon, so both count as live here.
    if (schema[k].lane === "live" || schema[k].appliesLive) live += 1;
    else restart += 1;
  }
  return { live, restart };
});

// --- actions ---
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

// --- polling: mirror the backend's already-polled snapshots ---
async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// Mirror one polled endpoint into its signal. A failed call leaves the last
// good value in place rather than blanking the UI. Most endpoints answer with
// the payload under `.data`; `unwrap` names the ones that answer raw.
const raw = (r) => r;
async function mirror(fn, sig, unwrap = (r) => r.data) {
  const r = await safe(fn);
  if (r) sig.value = unwrap(r);
}

async function refreshFast() {
  await mirror(api.health, health, raw);
  await mirror(api.state, engineState);
  await mirror(api.status, engineStatus);
  // the one endpoint feeding two signals: the level and the range it sits in
  const v = await safe(api.volume);
  if (v) {
    volume.value = v.volume;
    volumeRange.value = v;
  }
}

// Immediate live-volume write. Echoes the readback level into `volume` so the
// slider reflects the applied value without waiting for the next poll.
export async function setVolume(level) {
  const r = await api.setVolume(level);
  if (r && r.volume != null) volume.value = r.volume;
  return r;
}

// Trigger a daemon output-device rescan, then re-pull the config forms so the
// device dropdowns show a newly-present endpoint (an NAA powered back on).
export async function refreshDevices() {
  await api.refreshDevices();
  await refreshConfig();
}

export async function refreshConfig() {
  await mirror(api.enumerations, enums);
  await mirror(api.config, config);
  await mirror(api.matrix, matrixConfig);
  await mirror(api.pending, staged, raw);
}

export function startPolling(interval = 2000) {
  safe(api.metadata).then((m) => {
    if (m) metadata.value = m;
  });
  refreshFast();
  refreshConfig();
  // The fast (status/volume) cadence is reactive: a page's "quick updates" opt-in
  // drops it to 500 ms while that page is shown (store/ui.js). Reschedule the
  // timer whenever the derived cadence changes; the config poll stays fixed.
  let fastTimer;
  effect(() => {
    const ms = fastPollMs.value;
    if (fastTimer) clearInterval(fastTimer);
    fastTimer = setInterval(refreshFast, ms);
  });
  setInterval(refreshConfig, interval * 2);
}
