// The staging lane itself: one POST to HQPTuner's pending buffer, then a
// readback that proves the buffer holds what was sent.
//
// This module deliberately knows only three routes. There is no code path to
// POST /api/config/apply, POST /api/config/live, or DELETE /api/config/pending:
// the agent stages, the user applies — flushing the buffer to the daemon is the
// user's click, always.

/**
 * What one stage POST carries: the two lanes the pending buffer keeps, each a
 * bag of control key -> staged value. Both lanes are always written — runJob
 * builds them with `job.live || {}` and a spread — so neither is optional, and
 * the values stay `unknown` because a lane holds whatever the control's widget
 * emits (string, number or bool) and this module only ever round-trips them
 * through JSON.stringify.
 *
 * @typedef {{ live: Record<string, unknown>, http: Record<string, unknown> }} StagePayload
 */

/**
 * The fetch this module is handed. Injected rather than closed over so the
 * tests can drive both routes without a live server.
 *
 * @typedef {typeof globalThis.fetch} FetchImpl
 */

/**
 * POST the payload to the pending buffer and return the store's echo.
 *
 * @param {string} base
 * @param {StagePayload} payload
 * @param {FetchImpl} fetchImpl
 * @returns {Promise<unknown>}
 */
export async function postStage(base, payload, fetchImpl) {
  const url = `${base}/api/config/stage`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Read the buffer back and confirm every key we staged is present with our
 * value. Key-wise rather than whole-buffer equality on purpose: the store
 * merges, so edits the user staged in the browser legitimately sit alongside
 * ours — but a key of ours holding someone else's value means our stage lost a
 * race, and the user's pending bar is no longer showing what this run built.
 *
 * @param {string} base
 * @param {StagePayload} payload
 * @param {FetchImpl} fetchImpl
 * @returns {Promise<boolean>}
 */
export async function verifyPending(base, payload, fetchImpl) {
  const url = `${base}/api/config/pending`;
  const res = await fetchImpl(url, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const pending = await res.json();
  for (const lane of /** @type {const} */ (["live", "http"])) {
    for (const [key, value] of Object.entries(payload[lane] || {})) {
      const got = (pending[lane] || {})[key];
      if (JSON.stringify(got) !== JSON.stringify(value)) {
        throw new Error(
          `pending buffer disagrees on ${lane}.${key} — staged value was overwritten between the POST and the readback`,
        );
      }
    }
  }
  return true;
}
