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
export const metadata = signal(null); // static: {filters, shapers, settings}
export const staged = signal({ live: {}, http: {} }); // mirrors server pending

// --- derived: connection ---
export const reachable = computed(() => !!(health.value && health.value.reachable));
export const alarm = computed(() => !!(health.value && health.value.alarm));
export const modeName = computed(() => (enums.value && enums.value.mode && enums.value.mode.name) || "");

export const configByName = computed(() => {
  const map = {};
  for (const f of (config.value && config.value.fields) || []) map[f.name] = f;
  return map;
});

// --- three-tree resolution ---
function baseline(entry) {
  if (entry.lane === "live") return (engineState.value || {})[entry.stateField];
  const f = configByName.value[entry.field];
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

export function isDirty(key) {
  const e = schema[key];
  if (!e) return false;
  const sv = stagedValue(e);
  return sv !== undefined && String(sv) !== String(baseline(e));
}

// --- derived: the pending-changes bar ---
export const dirtyKeys = computed(() => Object.keys(schema).filter(isDirty));
export const stagedCount = computed(() => dirtyKeys.value.length);
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
  staged.value = await api.discard();
}

// apply lifecycle, shared so the pill and the pending bar both reflect it
export const applying = signal(false);
export const lastApply = signal(null); // {ok, text} of the most recent apply

function summarize(report) {
  const live = report.live || [];
  const fails = live.filter((x) => !x.ok);
  if (fails.length) return { ok: false, text: `Failed: ${fails.map((f) => f.setting).join(", ")}` };
  const http = report.http;
  if (http && http.verified && !http.verified.applied) {
    return { ok: false, text: `Config not applied (${http.verified.reason})` };
  }
  const n = live.length + (http ? 1 : 0);
  return { ok: true, text: `Applied ${n} change${n === 1 ? "" : "s"}` };
}

// Apply the staged set. The backend keeps staging on a soft failure, so on
// return we re-mirror it: a failed/held edit stays staged and — once the poll
// loop marks the daemon reachable again — the Apply button re-enables itself.
export async function applyAll() {
  applying.value = true;
  try {
    const report = await api.apply();
    await refreshConfig(); // re-mirror pending + fresh values
    lastApply.value = summarize(report);
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
}

export async function refreshConfig() {
  const e = await safe(api.enumerations);
  if (e) enums.value = e.data;
  const c = await safe(api.config);
  if (c) config.value = c.data;
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
