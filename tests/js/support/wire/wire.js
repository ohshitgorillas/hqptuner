// Shared wire fakes for the component and store suites. Fakes speak the real
// REST paths with the real response shapes.

/**
 * A response as these fakes serve it: the three members the client reads.
 *
 * @typedef {{ ok: boolean, status: number, json: () => Promise<unknown> }} FakeResponse
 */

/**
 * A request as these fakes are handed one — the two members the store sets.
 *
 * @typedef {{ method?: string, body?: string }} FakeRequest
 */

/**
 * The pending buffer, one bag per lane.
 *
 * @typedef {{ live: Record<string, unknown>, http: Record<string, unknown> }} StagedBuffer
 */

/**
 * A POST /api/config/stage body: the values to merge, and the entries to remove
 * once they are merged.
 *
 * @typedef {{
 *   live?: Record<string, unknown>,
 *   http?: Record<string, unknown>,
 *   drop?: { live?: Record<string, string[]>, http?: string[] },
 * }} StageBody
 */

/**
 * The globals a wire fake installs a `fetch` on, viewed as an optional member:
 * the DOM lib declares it returning a real `Response`, which these fakes do not
 * build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * @param {unknown} body
 * @returns {FakeResponse}
 */
export const ok = (body) => ({ ok: true, status: 200, json: async () => body });

/** The generation an unrouted GET /api/config reading is stamped with. */
const UNROUTED_CONFIG_GENERATION = 1;

/**
 * The answer to a request no route claimed: GET /api/config in its served shape, else an empty body.
 *
 * @param {string} path
 * @param {FakeRequest} opts
 * @returns {FakeResponse}
 */
const unrouted = (path, opts) =>
  ok(
    path === "/api/config" && (opts.method ?? "GET") === "GET"
      ? { generation: UNROUTED_CONFIG_GENERATION, fields: {} }
      : {},
  );

// A refusal in the daemon's own shape: FastAPI answers every error with a
// `detail` string. `bad(status)` with no detail is the other real case — a
// response that is not our JSON at all, which `json()` rejects on.
/**
 * A 409's `detail` is a per-field object where a 502's is a sentence —
 * `routes/livepreset.py` answers `str(exc)` for one, a mapping for the other.
 * The fake carries both because the wire does.
 *
 * @param {number} status
 * @param {string | Record<string, string>} [detail]
 * @returns {FakeResponse}
 */
export const bad = (status, detail) => ({
  ok: false,
  status,
  json: async () => {
    if (detail === undefined) throw new SyntaxError("not JSON");
    return { detail };
  },
});

// A staging server, not a stub of our own store: it holds the pending buffer
// the way the backend does and echoes it back, so edit() / stagePipelines() /
// discardAll() ride the real REST paths.
//
// Read the buffer back through the returned object (`w.staged`, `w.posts`),
// never through an alias captured at wire time: every change REPLACES the
// buffer object, because writing the same reference to a signal does not
// notify and the suites depend on that notification.
//
// `routes(path, opts, w)` answers suite-specific endpoints and falls through by
// returning undefined. `fallback(w)` answers whatever is left — `ok({})` unless
// a suite polls /api/config through this fake and wants the buffer instead.
//
// `w.inflight` holds the requests this fake has been handed and not yet
// answered, so a suite can wait for the wire to go quiet (`quiesce`) rather
// than for a stopwatch.
//
// A stage request may carry a `drop` member — `{live: {liveKey: [argName, …]},
// http: [fieldName, …]}` — and the server merges the request's own values first,
// THEN removes the named entries: one request both re-stages a field and reports
// it clean when an edit lands back on its baseline, and the drop is the later
// word (hqptuner/api/routes/pending.py). The bodies the fake was handed are
// recorded in `w.stages`, in arrival order, so a suite can assert on what the
// client asked for as well as on what the buffer became.

// Remove the named arguments from each live entry named in `drop`, and the
// entry itself once nothing is left of it — the live lane's entries are keyed by
// live key, each holding that setting's arguments.
/**
 * @param {Record<string, unknown>} staged
 * @param {Record<string, string[]>} drop
 * @returns {Record<string, unknown>}
 */
function dropLive(staged, drop) {
  const live = { ...staged };
  for (const [key, args] of Object.entries(drop)) {
    const entry = live[key];
    if (entry === null || typeof entry !== "object") {
      if (entry !== undefined) delete live[key];
      continue;
    }
    const kept = Object.fromEntries(Object.entries(entry).filter(([arg]) => !args.includes(arg)));
    if (Object.keys(kept).length === 0) delete live[key];
    else live[key] = kept;
  }
  return live;
}

// The server answers every staging route with the buffer reconciled against
// the readings it serves (a reading's `staged` member; core/pending.py
// `clean_pending`): an entry its destination store already holds is left out of
// the answer, while the full payload stays staged for the next Apply. The fake
// does the same against the readings the suite serves at GET /api/config. A
// suite that serves none leaves nothing to compare against, and its answers
// carry every entry.
//
// The destination is the store the served reading shows, and the comparison is
// made in the staged domain: a checkbox's bool reads "1"/"0" and a pipeline row
// set reads as the canonical JSON of the five editable columns.
const PIPELINE_COLUMNS = /** @type {const} */ (["gain", "gainunit", "mixdown", "process", "source"]);
const PIPELINE_COLUMN_DEFAULTS = { gain: "0", gainunit: "dB", mixdown: "0", process: "", source: "0" };

/**
 * @param {unknown} value
 * @returns {string}
 */
function inStagedDomain(value) {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (!Array.isArray(value)) return String(value);
  return JSON.stringify(
    value.map((row) =>
      Object.fromEntries(
        PIPELINE_COLUMNS.map((column) => [column, String(row[column] ?? PIPELINE_COLUMN_DEFAULTS[column])]),
      ),
    ),
  );
}

/**
 * The `fields` of the GET /api/config the suite serves, or null when it serves none.
 *
 * @param {((path: string, opts: FakeRequest, w: StagingWire) => FakeResponse | Promise<FakeResponse> | undefined) | undefined} routes
 * @param {StagingWire} w
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function servedFields(routes, w) {
  const hit = routes && (await routes("/api/config", { method: "GET" }, w));
  if (!hit || !hit.ok) return null;
  const body = /** @type {{ fields?: Record<string, unknown> } | null} */ (await hit.json());
  return body?.fields ?? null;
}

/**
 * @param {Record<string, unknown>} http
 * @param {Record<string, unknown> | null} fields
 * @returns {Record<string, unknown>}
 */
function reconcileHttp(http, fields) {
  if (fields === null) return http;
  return Object.fromEntries(
    Object.entries(http).filter(([name, value]) => {
      const reading = /** @type {Record<string, any> | undefined} */ (fields[name]);
      const held = reading?.[reading.show]?.value;
      return held === undefined || inStagedDomain(held) !== inStagedDomain(value);
    }),
  );
}

/**
 * @typedef {{
 *   staged: StagedBuffer,
 *   posts: unknown[],
 *   stages: StageBody[],
 *   inflight: Set<Promise<FakeResponse>>,
 * }} StagingWire
 */

/**
 * @param {{
 *   routes?: (path: string, opts: FakeRequest, w: StagingWire) => FakeResponse | Promise<FakeResponse> | undefined,
 *   fallback?: (w: StagingWire) => FakeResponse,
 * }} [seams]
 * @returns {StagingWire}
 */
export function stagingWire({ routes, fallback } = {}) {
  /** @type {StagingWire} */
  const w = { staged: { live: {}, http: {} }, posts: [], stages: [], inflight: new Set() };
  /** @param {StageBody} body */
  const applyStage = async (body) => {
    // Served first: the buffer is read and replaced in one synchronous turn, so two stages in flight never lose each other's entries.
    const fields = await servedFields(routes, w);
    const drop = body.drop || {};
    const merged = { ...w.staged.http, ...body.http };
    for (const name of drop.http || []) delete merged[name];
    const live = dropLive({ ...w.staged.live, ...body.live }, drop.live || {});
    w.staged = { live, http: merged };
    return { live, http: reconcileHttp(merged, fields) };
  };
  const answer = async (/** @type {string} */ path, /** @type {FakeRequest} */ opts) => {
    if (path === "/api/config/stage") {
      const body = JSON.parse(String(opts.body));
      w.stages.push(body);
      return ok(await applyStage(body));
    }
    if (path === "/api/config/pending" && opts.method === "DELETE") {
      w.staged = { live: {}, http: {} };
      return ok(w.staged);
    }
    if (path === "/api/config/pending") {
      return ok({ live: w.staged.live, http: reconcileHttp(w.staged.http, await servedFields(routes, w)) });
    }
    const hit = routes && (await routes(path, opts, w));
    if (hit !== undefined) return hit;
    if (fallback) return fallback(w);
    return path === "/api/config/apply" ? ok({ report: {} }) : unrouted(path, opts);
  };
  env.fetch = (/** @type {string} */ path, /** @type {FakeRequest} */ opts = {}) => {
    const req = answer(path, opts);
    w.inflight.add(req);
    req.then(
      () => w.inflight.delete(req),
      () => w.inflight.delete(req),
    );
    return req;
  };
  return w;
}

// Wait for a wire from `stagingWire` to go quiet: every request it has been
// handed answered, and every continuation waiting on an answer run — including
// one that fires a further request.
// The fake answers immediately, so this settles in a
// couple of turns.
//
// What it guarantees, exactly: no request is outstanding AT THIS INSTANT. That
// covers the promise chains the store hangs off a fetch, and a chain that fires
// a further request. It does NOT cover work parked behind a timer, nor an await
// chain that takes more than one macrotask to reach its next fetch — either
// slips past and the wire reads as quiet with the change still to come. Code
// that defers like that needs a seam to wait on, not a longer settle here.
//
// Exhausting the turn cap throws rather than returning: a runaway poll or a
// request nothing ever answers must not read as a quiet wire, which would hand
// the caller the half-settled state this helper exists to eliminate.
/**
 * Any fake that keeps its outstanding requests, `stagingWire`'s and the live
 * preset suites' alike — the member is the contract, not the fake.
 *
 * @param {{ inflight: Set<Promise<FakeResponse>> }} w
 * @param {number} [turns]
 * @returns {Promise<void>}
 */
export async function quiesce(w, turns = 100) {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.allSettled([...w.inflight]);
    await new Promise((resolve) => setImmediate(resolve));
    if (w.inflight.size === 0) return;
  }
  throw new Error(`wire never went quiet: ${w.inflight.size} request(s) still outstanding after ${turns} turns`);
}

// A fixed buffer rather than an accumulating one: the suite states what is
// staged and the fake answers with exactly that, unmoved by anything the
// component does. `routes` adds the endpoints a suite needs beyond it.
/**
 * @param {StagedBuffer} [staged]
 * @param {(path: string, opts: FakeRequest) => FakeResponse | Promise<FakeResponse> | undefined} [routes]
 * @returns {void}
 */
export function staticWire(staged = { live: {}, http: {} }, routes) {
  env.fetch = async (/** @type {string} */ path, /** @type {FakeRequest} */ opts = {}) => {
    if (path === "/api/config/stage" || path === "/api/config/pending") return ok(staged);
    const hit = routes && (await routes(path, opts));
    return hit === undefined ? unrouted(path, opts) : hit;
  };
}
