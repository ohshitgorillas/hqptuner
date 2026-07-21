// Thin REST wrappers over the Phase 2/3 backend. Read endpoints that serve a
// daemon snapshot wrap it as {stale, loaded_at, data}; health/metadata/pending
// return their payload directly. Callers unwrap via `.data` where noted.

async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

async function send(path, method, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

async function upload(path, field, file) {
  const fd = new FormData();
  fd.append(field, file);
  const r = await fetch(path, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
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
