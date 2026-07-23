// The three-tree store. Source signals only; everything else is computed().
//
//   engine  — live runtime (4321 State/enums/status/health): authority for
//             live-lane control values + the per-mode enum lists + reachability
//   config  — GET /config form: authority for http-lane control values +
//             each field's min/max/enum constraints; the persistent-file baseline
//   staged  — server-side pending buffer ({live, http}); the client mirrors it
//
// Live changes are never persisted, so engine and config can disagree for the
// same setting — that divergence is why these are separate trees (outline §2).

import { signal, computed, effect } from "@preact/signals";
import { api } from "../lib/api.js";
import { schema } from "./schema.js";
import { fastPollMs } from "./ui.js";
import { summarize } from "./apply-summary.js";

// --- source signals ---
export const health = signal(null); // {reachable, alarm, unreachable_since, info}
export const engineState = signal(null); // /api/state data (live indices)
export const engineStatus = signal(null); // /api/status data
export const enums = signal(null); // /api/enumerations data (merged w/ static)
export const config = signal(null); // /api/config data {fields, profiles}
// Preset preview: picking a preset loads its saved settings into the editor as
// the baseline (no daemon touch) so they can be tweaked before Apply commits the
// switch. pendingPreset = the previewed name; previewConfig = its field values.
export const pendingPreset = signal(null);
const previewConfig = signal(null);
// exported as part of the store surface: components read it via runningValue,
// and tests/js drive the matrix-fed chips by assigning it directly.
export const matrixConfig = signal(null); // /api/matrix data {fields} (crossfeed/correction)
export const metadata = signal(null); // static: {filters, shapers, settings}
const staged = signal({ live: {}, http: {} }); // mirrors server pending
// Transient client-only overrides, set live while a knob is dragged so controls
// and response plots update instantly with no server round-trip per pointer move.
// Committed to `staged` on release, then cleared. Highest priority in effective().
const liveOverride = signal({});

// live playback volume — NOT a staged control: it lives in its own signals and
// writes immediately via the Control API (never through the staged/apply flow).
export const volume = signal(null); // engine-reported current volume (dB, string)
export const volumeRange = signal(null); // {min, max, enabled, adaptive} from VolumeRange

// --- derived: connection ---
export const reachable = computed(() => !!(health.value && health.value.reachable));
export const alarm = computed(() => !!(health.value && health.value.alarm));
export const modeName = computed(() => (enums.value && enums.value.mode && enums.value.mode.name) || "");

export const configByName = computed(() => {
  const map = {};
  for (const f of (config.value && config.value.fields) || []) map[f.name] = f;
  return map;
});

// /matrix fields, keyed by name — the baseline/constraint source for the
// crossfeed/DAC-correction controls (endpoint "matrix" in the schema).
export const matrixByName = computed(() => {
  const map = {};
  for (const f of (matrixConfig.value && matrixConfig.value.fields) || []) map[f.name] = f;
  return map;
});

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

// Matrix tab read model: pipeline rows (grouped by the backend parser), saved
// profile names (4321 MatrixListProfiles, falling back to the form datalist),
// and the active profile ("" / "[Default]" = the unnamed default).
const matrixRows = computed(() => (matrixConfig.value && matrixConfig.value.rows) || []);
export const matrixProfiles = computed(() => {
  const m = matrixConfig.value || {};
  if (m.live_profiles && m.live_profiles.length) return m.live_profiles;
  return ((m.profiles && m.profiles.options) || []).map((o) => o.value).filter(Boolean);
});
export const matrixActiveProfile = computed(() => {
  const m = matrixConfig.value || {};
  const name = m.live_active || (m.active !== "[Default]" ? m.active : "");
  return name || "[Default]";
});

// --- pipeline set (matrix-spec step 3): staged as ONE atomic canonical-JSON
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
export const activePreset = computed(() => (config.value && config.value.active) || "");

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
function fileValue(entry) {
  if (!entry.fileTruth) return null;
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
  if (e.fileTruth) {
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

// checkbox values cross domains: config baseline is a bool, staged is "1"/"0".
// Compare in the control's own domain so a checkbox toggled back to its original
// stops reading as dirty (else it stays highlighted until Discard).
const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

export function isDirty(key) {
  const e = schema[key];
  if (!e) return false;
  const sv = stagedValue(e);
  if (sv === undefined) return false;
  const base = baseline(e);
  if (e.widget === "checkbox") return truthy(sv) !== truthy(base);
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
  for (const k of dirtyKeys.value) schema[k].lane === "live" ? (live += 1) : (restart += 1);
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
  const on = value === true || value === 1 || value === "1" || value === "on" || value === "true";
  if (key === "fixed_volume_enabled" && on) http.volume_fixed = "0";
  else if (key === "optimal_iso" && String(value) !== "0") http.fixed_volume_enabled = "0";
}

export async function edit(key, value) {
  const e = schema[key];
  if (!e) return;
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

// Apply the staged set. The backend keeps staging on a soft failure, so on
// return we re-mirror it: a failed/held edit stays staged and — once the poll
// loop marks the daemon reachable again — the Apply button re-enables itself.
export async function applyAll(save) {
  applying.value = true;
  const count = stagedCount.value; // capture before apply clears the staged set
  // never send a switch to the preset already loaded — that reload is a no-op
  // that trips the daemon's empty-/backup bug and leaves Apply stuck lit
  const switchTo = pendingPreset.value && pendingPreset.value !== activePreset.value ? pendingPreset.value : null;
  try {
    const body = {};
    if (save) body.save = save;
    if (switchTo) body.switch_to = switchTo;
    const report = await api.apply(Object.keys(body).length ? body : undefined);
    await refreshConfig(); // re-mirror pending + fresh values (dropdown picks up a new preset)
    lastApply.value = summarize(report, count);
    if (lastApply.value.ok) clearPreview(); // switch committed — drop the preview
    return report;
  } catch (e) {
    lastApply.value = { ok: false, text: `Apply failed: ${e.message}` };
    throw e;
  } finally {
    applying.value = false;
  }
}

// Standalone save — persist the CURRENT running config to a named preset with
// nothing staged (the "I like this, keep it" path). Reuses the applying signal:
// the save lane POSTs /restore, so the daemon briefly restarts just like an apply.
export async function savePresetOnly(name) {
  applying.value = true;
  try {
    const r = await api.profile("save", name);
    lastApply.value = r.ok
      ? { ok: true, text: `Saved to "${r.name}"` }
      : { ok: false, text: `Save to "${r.name}" failed: ${r.error}` };
    await refreshConfig();
    return r;
  } catch (e) {
    lastApply.value = { ok: false, text: `Save failed: ${e.message}` };
    throw e;
  } finally {
    applying.value = false;
  }
}

// --- polling: mirror the backend's already-polled snapshots ---
async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function refreshFast() {
  const h = await safe(api.health);
  if (h) health.value = h;
  const s = await safe(api.state);
  if (s) engineState.value = s.data;
  const st = await safe(api.status);
  if (st) engineStatus.value = st.data;
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
  const e = await safe(api.enumerations);
  if (e) enums.value = e.data;
  const c = await safe(api.config);
  if (c) config.value = c.data;
  const m = await safe(api.matrix);
  if (m) matrixConfig.value = m.data;
  const p = await safe(api.pending);
  if (p) staged.value = p;
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
