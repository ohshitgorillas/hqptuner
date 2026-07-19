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

import { signal, computed } from "@preact/signals";
import { api } from "./api.js";
import { schema } from "./schema.js";

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
export const previewConfig = signal(null);
export const matrixConfig = signal(null); // /api/matrix data {fields} (crossfeed/correction)
export const metadata = signal(null); // static: {filters, shapers, settings}
export const staged = signal({ live: {}, http: {} }); // mirrors server pending

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

// --- three-tree resolution ---
function baseline(entry) {
  if (entry.lane === "live") return (engineState.value || {})[entry.stateField];
  // a previewed preset's values are the baseline for its grounded fields, so the
  // editor shows the preset before it's applied and tweaks read as dirty over it
  const preview = previewConfig.value;
  if (preview && entry.field in preview) return preview[entry.field];
  const f = httpFieldMap(entry)[entry.field];
  return f ? f.value : undefined;
}

function stagedValue(entry) {
  const st = staged.value;
  if (entry.lane === "live") {
    const bucket = st.live[entry.liveKey];
    return bucket ? bucket[entry.arg || "value"] : undefined;
  }
  return st.http[entry.field];
}

// effective(key) — what a control renders: staged edit if present, else baseline.
export function effective(key) {
  const e = schema[key];
  if (!e) return undefined;
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
export const dirtyKeys = computed(() => Object.keys(schema).filter(isDirty));
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
  staged.value = await api.stage(body);
}

export async function discardAll() {
  clearPreview();
  staged.value = await api.discard();
}

// Load a preset's saved settings into the editor as the baseline (no daemon
// touch) — the user tweaks, then Apply commits the switch.
export async function previewPreset(name) {
  const r = await api.preset(name);
  previewConfig.value = (r && r.config) || {};
  pendingPreset.value = name;
}

export function clearPreview() {
  pendingPreset.value = null;
  previewConfig.value = null;
}

// apply lifecycle, shared so the pill and the pending bar both reflect it
export const applying = signal(false);
export const lastApply = signal(null); // {ok, text} of the most recent apply

// `count` is the number of staged edits captured before apply — the http/matrix
// lanes each collapse many field edits into a single POST, so counting reports
// (the old bug: "2 staged" -> "Applied 1 change") undercounts the real changes.
function summarize(report, count) {
  const live = report.live || [];
  const fails = live.filter((x) => !x.ok);
  if (fails.length) return { ok: false, text: `Failed: ${fails.map((f) => f.setting).join(", ")}` };
  const sw = report.switched;
  if (sw && !sw.active) return { ok: false, text: `Switch to "${sw.name}" did not take` };
  const p = report.persistent;
  if (p && !p.applied) {
    const nd = p.unfixable && p.unfixable.net_device;
    if (nd) return { ok: false, text: `Endpoint "${nd.want}" not present — config not applied` };
    if (p.error) return { ok: false, text: `Config not applied: ${p.error}` };
    return { ok: false, text: `Config not applied (${p.reason || "unconfirmed"})` };
  }
  const changes = count ? `${count} change${count === 1 ? "" : "s"}` : "";
  const base = sw ? `Switched to "${sw.name}"${changes ? ` + ${changes}` : ""}` : `Applied ${changes || "no changes"}`;
  const saved = report.saved;
  if (saved && !saved.ok) return { ok: false, text: `${base} — save to "${saved.name}" failed: ${saved.error}` };
  if (saved) return { ok: true, text: `${base} · saved to "${saved.name}"` };
  return { ok: true, text: base };
}

// Apply the staged set. The backend keeps staging on a soft failure, so on
// return we re-mirror it: a failed/held edit stays staged and — once the poll
// loop marks the daemon reachable again — the Apply button re-enables itself.
export async function applyAll(save) {
  applying.value = true;
  const count = stagedCount.value; // capture before apply clears the staged set
  const switchTo = pendingPreset.value;
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
  setInterval(refreshFast, interval);
  setInterval(refreshConfig, interval * 2);
}
