// Shared wire fakes for the component and store suites. Fakes speak the real
// REST paths with the real response shapes (docs/testing.md rule 4); no store
// function is ever stubbed.

export const ok = (body) => ({ ok: true, status: 200, json: async () => body });

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
export function stagingWire({ routes, fallback } = {}) {
  const w = { staged: { live: {}, http: {} }, posts: [] };
  globalThis.fetch = async (path, opts = {}) => {
    if (path === "/api/config/stage") {
      const body = JSON.parse(opts.body);
      w.staged = { live: { ...w.staged.live, ...body.live }, http: { ...w.staged.http, ...body.http } };
      return ok(w.staged);
    }
    if (path === "/api/config/pending" && opts.method === "DELETE") {
      w.staged = { live: {}, http: {} };
      return ok(w.staged);
    }
    if (path === "/api/config/pending") return ok(w.staged);
    const hit = routes && (await routes(path, opts, w));
    return hit === undefined ? (fallback ? fallback(w) : ok({})) : hit;
  };
  return w;
}

// A fixed buffer rather than an accumulating one: the suite states what is
// staged and the fake answers with exactly that, unmoved by anything the
// component does. `routes` adds the endpoints a suite needs beyond it.
export function staticWire(staged = { live: {}, http: {} }, routes) {
  globalThis.fetch = async (path, opts = {}) => {
    if (path === "/api/config/stage" || path === "/api/config/pending") return ok(staged);
    const hit = routes && (await routes(path, opts));
    return hit === undefined ? ok({}) : hit;
  };
}
