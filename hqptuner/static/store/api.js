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

export const api = {
  health: () => getJSON("/api/health"),
  state: () => getJSON("/api/state"),
  status: () => getJSON("/api/status"),
  enumerations: () => getJSON("/api/enumerations"),
  config: () => getJSON("/api/config"),
  metadata: () => getJSON("/api/metadata"),
  pending: () => getJSON("/api/config/pending"),
  stage: (body) => send("/api/config/stage", "POST", body),
  discard: () => send("/api/config/pending", "DELETE"),
  apply: () => send("/api/config/apply", "POST", {}),
  profile: (action, name) => send(`/api/profile/${action}`, "POST", { name }),
};
