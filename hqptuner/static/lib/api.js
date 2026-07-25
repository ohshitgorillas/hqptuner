// Thin REST wrappers over the Phase 2/3 backend. Read endpoints that serve a
// daemon snapshot wrap it as {stale, loaded_at, data}; health/metadata/pending
// return their payload directly. Callers unwrap via `.data` where noted.

// Every backend error carries FastAPI's `{"detail": "..."}` — the sentence that
// says what actually went wrong ("no hqplayerd credentials configured", "GET
// /matrix failed: …"). Throwing the status code alone discards it and leaves
// every tab reporting a bare number, so the detail IS the message whenever the
// body has one; the path and status stay as the fallback for a response that is
// not our JSON at all (a proxy error page, a dropped daemon). A 422 from
// request validation answers with a list rather than a string — not a sentence
// we can show, so it takes the fallback too.
async function failure(path, r) {
  let detail = "";
  try {
    const body = await r.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    detail = "";
  }
  return new Error(detail || `${path} -> ${r.status}`);
}

async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw await failure(path, r);
  return r.json();
}

async function send(path, method, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  if (!r.ok) throw await failure(path, r);
  return r.json();
}

async function upload(path, field, file) {
  const fd = new FormData();
  fd.append(field, file);
  const r = await fetch(path, { method: "POST", body: fd });
  if (!r.ok) throw await failure(path, r);
  return r.json();
}

export const api = {
  health: () => getJSON("/api/health"),
  engine: () => getJSON("/api/engine"),
  applyEngine: (body) => send("/api/engine", "POST", body),
  restore: (file) => upload("/api/restore", "cfgfile", file),
  state: () => getJSON("/api/state"),
  status: () => getJSON("/api/status"),
  enumerations: () => getJSON("/api/enumerations"),
  config: () => getJSON("/api/config"),
  matrix: () => getJSON("/api/matrix"),
  speakers: () => getJSON("/api/speakers"),
  applySpeakers: (body) => send("/api/speakers", "POST", body),
  metadata: () => getJSON("/api/metadata"),
  pending: () => getJSON("/api/config/pending"),
  stage: (body) => send("/api/config/stage", "POST", body),
  discard: () => send("/api/config/pending", "DELETE"),
  apply: (body) => send("/api/config/apply", "POST", body || {}),
  refreshDevices: () => send("/api/config/refresh", "POST"),
  profile: (action, name) => send(`/api/profile/${action}`, "POST", { name }),
  preset: (name) => getJSON(`/api/preset/${encodeURIComponent(name)}`),
  deletePreset: (name) => send(`/api/preset/${encodeURIComponent(name)}`, "DELETE"),
  uploadFilter: (file) => upload("/api/matrix/filter", "file", file),
  matrixProfile: (action, name) => send("/api/matrix/profile", "POST", { action, name }),
  volume: () => getJSON("/api/volume"),
  setVolume: (level) => send("/api/volume", "POST", { level: String(level) }),
  log: (lines = 50) => getJSON(`/api/log?lines=${lines}`),
};
