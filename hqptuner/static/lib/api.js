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
// The LIVE lane answers a refused batch with per-field reasons rather than one
// sentence — {"filter": "the pcm chain is not loaded (engine chain: sdm)"} —
// because it refuses field by field. Reading the values out keeps that sentence;
// the alternative is the bare status code, which tells the control nothing. A
// LIST detail stays on the fallback: that is FastAPI's request-validation shape,
// a structure rather than prose.
/**
 * @param {{ detail?: unknown } | null | undefined} body the parsed error body
 * @returns {string} the sentence to show, "" when the body carries none
 */
function detailOf(body) {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (!d || typeof d !== "object" || Array.isArray(d)) return "";
  return Object.values(d)
    .filter((v) => typeof v === "string")
    .join("; ");
}

/**
 * @param {string} path
 * @param {Response} r
 * @returns {Promise<Error>}
 */
async function failure(path, r) {
  let detail = "";
  try {
    detail = detailOf(await r.json());
  } catch {
    detail = "";
  }
  return new Error(detail || `${path} -> ${r.status}`);
}

/** @param {string} path */
async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw await failure(path, r);
  return r.json();
}

/**
 * @param {string} path
 * @param {string} method
 * @param {unknown} [body] JSON-serializable payload; omitted sends no body
 */
async function send(path, method, body) {
  /** @type {RequestInit} */
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  if (!r.ok) throw await failure(path, r);
  return r.json();
}

/**
 * @param {string} path
 * @param {string} field the multipart field name
 * @param {File} file
 */
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
  applyEngine: (/** @type {unknown} */ body) => send("/api/engine", "POST", body),
  restore: (/** @type {File} */ file) => upload("/api/restore", "cfgfile", file),
  state: () => getJSON("/api/state"),
  status: () => getJSON("/api/status"),
  enumerations: () => getJSON("/api/enumerations"),
  config: () => getJSON("/api/config"),
  matrix: () => getJSON("/api/matrix"),
  speakers: () => getJSON("/api/speakers"),
  applySpeakers: (/** @type {unknown} */ body) => send("/api/speakers", "POST", body),
  metadata: () => getJSON("/api/metadata"),
  pending: () => getJSON("/api/config/pending"),
  stage: (/** @type {unknown} */ body) => send("/api/config/stage", "POST", body),
  discard: () => send("/api/config/pending", "DELETE"),
  apply: (/** @type {unknown} */ body) => send("/api/config/apply", "POST", body || {}),
  // the LIVE view's whole write path: applied on the spot, readback-verified,
  // never staged (store/live/write.js)
  live: (/** @type {Record<string, string>} */ fields) => send("/api/config/live", "POST", { fields }),
  // Live presets — HQPTuner's own record, never the daemon's. A save takes no
  // body: the backend snapshots the running engine itself, so the browser has
  // nothing to send that the daemon has not already reported.
  livePresets: () => getJSON("/api/livepresets"),
  saveLivePreset: (/** @type {string} */ name) => send(`/api/livepresets/${encodeURIComponent(name)}`, "PUT"),
  applyLivePreset: (/** @type {string} */ name) => send(`/api/livepresets/${encodeURIComponent(name)}/apply`, "POST"),
  deleteLivePreset: (/** @type {string} */ name) => send(`/api/livepresets/${encodeURIComponent(name)}`, "DELETE"),
  // Favorites — starred filter and modulator NAMES, stored for the install
  // rather than for one browser. Whole-set replace per kind: unstarring is a PUT
  // without the name, and a kind the body leaves out is left as it stands.
  favorites: () => getJSON("/api/favorites"),
  saveFavorites: (/** @type {{ filters?: string[], modulators?: string[] }} */ sets) =>
    send("/api/favorites", "PUT", sets),
  // Narrow-bar facets — which filters the dropdowns offer, stored for the
  // install. Whole-bar replace: a facet left out comes back at its default.
  narrowing: () => getJSON("/api/narrowing"),
  saveNarrowing: (/** @type {Record<string, unknown>} */ facets) => send("/api/narrowing", "PUT", { facets }),
  // Matrix-profile descriptions — what the user wrote about a saved profile,
  // stored for the install. One profile per write, unlike favorites: the text is
  // long and two browsers on different profiles must not overwrite each other.
  descriptions: () => getJSON("/api/descriptions"),
  saveDescription: (/** @type {string} */ name, /** @type {string} */ text) =>
    send("/api/descriptions", "PUT", { name, text }),
  // Per-preset Matrix-tab mode — which half of the tab a preset is listened
  // through, stored for the install. One preset per write, like descriptions:
  // two browsers on different presets must not undo each other's choice.
  matrixModes: () => getJSON("/api/matrixmodes"),
  saveMatrixMode: (/** @type {string} */ name, /** @type {string} */ mode) =>
    send("/api/matrixmodes", "PUT", { name, mode }),
  refreshDevices: () => send("/api/config/refresh", "POST"),
  setAutosave: (/** @type {boolean} */ enabled) => send("/api/autosave", "POST", { enabled }),
  // The high-frequency filter's auto-pilot. Write only: /api/status carries the flag on
  // every poll, because the backend switches it off by itself when the filter is set by hand.
  setAutopilot: (/** @type {boolean} */ enabled) => send("/api/autopilot", "POST", { enabled }),
  profile: (/** @type {string} */ action, /** @type {string} */ name) =>
    send(`/api/profile/${action}`, "POST", { name }),
  preset: (/** @type {string} */ name) => getJSON(`/api/preset/${encodeURIComponent(name)}`),
  deletePreset: (/** @type {string} */ name) => send(`/api/preset/${encodeURIComponent(name)}`, "DELETE"),
  autoeq: () => getJSON("/api/autoeq"),
  uploadFilter: (/** @type {File} */ file) => upload("/api/matrix/filter", "file", file),
  matrixProfile: (/** @type {string} */ action, /** @type {string} */ name) =>
    send("/api/matrix/profile", "POST", { action, name }),
  volume: () => getJSON("/api/volume"),
  setVolume: (/** @type {string | number} */ level) => send("/api/volume", "POST", { level: String(level) }),
  log: (/** @type {number} */ lines = 50) => getJSON(`/api/log?lines=${lines}`),
};
