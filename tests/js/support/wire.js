// Shared wire fakes for the component and store suites. Fakes speak the real
// REST paths with the real response shapes (docs/testing.md rule 4); no store
// function is ever stubbed.

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

// A refusal in the daemon's own shape: FastAPI answers every error with a
// `detail` string. `bad(status)` with no detail is the other real case — a
// response that is not our JSON at all, which `json()` rejects on.
/**
 * A 409's `detail` is a per-field object where a 502's is a sentence —
 * `livepresetapi.py:28` answers `str(exc)`, `:52` and `:90` answer a mapping.
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
// word (hqptuner/api/pendingapi.py). The bodies the fake was handed are
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
  const applyStage = (body) => {
    const drop = body.drop || {};
    const http = { ...w.staged.http, ...body.http };
    for (const name of drop.http || []) delete http[name];
    const live = dropLive({ ...w.staged.live, ...body.live }, drop.live || {});
    w.staged = { live, http };
    return w.staged;
  };
  const answer = async (/** @type {string} */ path, /** @type {FakeRequest} */ opts) => {
    if (path === "/api/config/stage") {
      const body = JSON.parse(String(opts.body));
      w.stages.push(body);
      return ok(applyStage(body));
    }
    if (path === "/api/config/pending" && opts.method === "DELETE") {
      w.staged = { live: {}, http: {} };
      return ok(w.staged);
    }
    if (path === "/api/config/pending") return ok(w.staged);
    const hit = routes && (await routes(path, opts, w));
    return hit === undefined ? (fallback ? fallback(w) : ok({})) : hit;
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
// one that fires a further request. Event-loop turns, never a duration, so a
// suite using it pins WHAT a sequence concludes and not how long it took
// (docs/testing.md rule 7). The fake answers immediately, so this settles in a
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
 * @param {StagingWire} w
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
    return hit === undefined ? ok({}) : hit;
  };
}
