// Thin REST wrappers over the Phase 2/3 backend. Read endpoints that serve a
// daemon snapshot wrap it as {stale, loaded_at, data}; health/metadata/pending
// return their payload directly. Callers unwrap via `.data` where noted.

// Every backend error carries FastAPI's `{"detail": "..."}` — the sentence that
// says what actually went wrong ("no hqplayerd credentials configured", "GET
// /matrix failed: …"). Throwing the status code alone discards it and leaves
// every tab reporting a bare number, so the detail IS the message whenever the
// body has one. A response with no usable detail (a proxy error page, a dropped
// daemon) is described by its HTTP status in plain English (`unexplained`).
// A backend sentence opens with its own clause, so a caller shows it alone; the
// client's own sentences name no operation, so a caller puts its "{what} failed: "
// in front of those (`failText` in errtext.js). `fromBackend` says which it is.
// The LIVE lane answers a refused batch with per-field reasons rather than one
// sentence — {"filter": "the pcm chain is not loaded (engine chain: sdm)"} —
// because it refuses field by field. Reading the values out keeps that sentence;
// the alternative is the bare status code, which tells the control nothing.
// A LIST detail is FastAPI's request-validation shape: one error per field, each
// with the field's location and pydantic's reason, described one sentence per
// error (`invalid`).
/**
 * @param {{ detail?: unknown } | null | undefined} body the parsed error body
 * @returns {string} the sentence to show, "" when the body carries none
 */
function detailOf(body) {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(invalid).filter(Boolean).join(" ");
  if (!d || typeof d !== "object") return "";
  return Object.values(d)
    .filter((v) => typeof v === "string")
    .join("; ");
}

// `loc` leads with where the field was read from ("body", "query", "path"); the
// rest is the field's name, dotted when it is nested.
/**
 * @param {unknown} error one entry of a request-validation list
 * @returns {string} the sentence for it, "" when it locates no field or gives no reason
 */
function invalid(error) {
  if (!error || typeof error !== "object") return "";
  const { loc, msg } = /** @type {{ loc?: unknown, msg?: unknown }} */ (error);
  if (!Array.isArray(loc) || typeof msg !== "string" || !msg) return "";
  const field = (loc.length > 1 ? loc.slice(1) : loc).join(".");
  if (!field) return "";
  return `HQPTuner could not use ${field} (${msg.charAt(0).toLowerCase()}${msg.slice(1)}).`;
}

// RFC 9110 section 15 reason phrases, plus the registered codes HQPTuner or a
// proxy in front of it can plausibly answer with.
/** @type {Record<number, string>} */
const REASON_PHRASES = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  421: "Misdirected Request",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  501: "Not Implemented",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  511: "Network Authentication Required",
};

/**
 * @param {string} path the request path, query string included
 * @param {number} status
 * @returns {string} the sentence for a failed response whose body explains nothing
 */
function unexplained(path, status) {
  if (status === 500) return "HQPTuner hit an unexpected error. The details are in its log.";
  if (status === 502 || status === 503 || status === 504) return "HQPlayer did not answer.";
  if (status === 404) return `This HQPTuner has no ${path.split("?")[0]}. Reload the page.`;
  const phrase = REASON_PHRASES[status];
  return `HQPTuner answered HTTP ${phrase ? `${status} ${phrase}` : status} with no explanation.`;
}

// A refusal from our own backend also carries `code`, a stable identifier
// beside the sentence (docs/architecture.md "API errors"). The sentence is for
// showing; `status` and `code` are what a control branches on, so both ride on
// the rejected error as properties instead of being fished back out of prose.
/** A non-OK answer from the backend: the sentence, the HTTP status, the body's code. */
class ApiFailure extends Error {
  /**
   * Keep the status, the code and the sentence's source beside the message.
   * @param {string} message
   * @param {number} status
   * @param {string} code "" when the body carried none
   * @param {boolean} fromBackend whether the message is the backend's own sentence
   */
  constructor(message, status, code, fromBackend) {
    super(message);
    this.status = status;
    this.code = code;
    this.fromBackend = fromBackend;
  }
}

/**
 * @param {string} path
 * @param {Response} r
 * @returns {Promise<ApiFailure>}
 */
async function failure(path, r) {
  let detail = "";
  let code = "";
  try {
    const body = await r.json();
    detail = detailOf(body);
    code = typeof body?.code === "string" ? body.code : "";
  } catch {
    detail = "";
  }
  return new ApiFailure(detail || unexplained(path, r.status), r.status, code, detail !== "");
}

// A fetch that rejects never reached HQPTuner; each browser words that rejection
// its own way, so the browser's text is replaced by one sentence. No response
// means no status: the failure carries 0, as a network-error Response does.
/**
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
async function reach(path, opts) {
  try {
    return await fetch(path, opts);
  } catch {
    throw new ApiFailure("HQPTuner is not reachable.", 0, "", false);
  }
}

/** @param {string} path */
async function getJSON(path) {
  const r = await reach(path);
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
  const r = await reach(path, opts);
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
  const r = await reach(path, { method: "POST", body: fd });
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
  // Live snapshots — HQPTuner's own record, never the daemon's. A save takes no
  // body: the backend snapshots the running engine itself, so the browser has
  // nothing to send that the daemon has not already reported.
  livePresets: () => getJSON("/api/livepresets"),
  liveSnapshot: () => getJSON("/api/livepresets/snapshot"),
  // `fields` names the settings the preset keeps; omitted, the backend keeps them all.
  saveLivePreset: (/** @type {string} */ name, /** @type {string[] | undefined} */ fields) =>
    send(`/api/livepresets/${encodeURIComponent(name)}`, "PUT", fields ? { fields } : undefined),
  applyLivePreset: (/** @type {string} */ name) => send(`/api/livepresets/${encodeURIComponent(name)}/apply`, "POST"),
  deleteLivePreset: (/** @type {string} */ name) => send(`/api/livepresets/${encodeURIComponent(name)}`, "DELETE"),
  // Where HQPTuner dials and who it says it is. The read never answers the
  // password, only whether one is held; the write saves before it verifies, so
  // its 200 says the record landed and nothing about what the daemon makes of it.
  connection: () => getJSON("/api/connection"),
  saveConnection: (/** @type {unknown} */ body) => send("/api/connection", "POST", body),
  // Which hqplayerds answer discovery. On demand only: the call waits on the
  // daemons for `discovery_timeout`, plus one `request_timeout` where nobody
  // answered and the container host is asked directly, and nothing polls it.
  discoverDaemons: () => getJSON("/api/discover"),
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
