// The staging lane itself: one POST to HQPTuner's pending buffer, then a
// readback that proves the buffer holds what was sent.
//
// This module deliberately knows only three staging routes, plus the login that
// every gated route needs. There is no code path to POST /api/config/apply,
// POST /api/config/live, or DELETE /api/config/pending: the agent stages, the
// user applies — flushing the buffer to the daemon is the user's click, always.

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

/** The cookie `hqptuner/api/gate.py` sets at login. */
const LOGIN_COOKIE = "hqptuner_login";

/**
 * The username and password `hqpcreds` exports, or a rejection naming the
 * variable that is not set.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ username: string, password: string }}
 */
export function credentialsFromEnv(env) {
  const username = env.HQPTUNER_HQP_USERNAME;
  const password = env.HQPTUNER_HQP_PASSWORD;
  if (username === undefined) throw new Error("HQPTUNER_HQP_USERNAME is not set; source hqpcreds first");
  if (password === undefined) throw new Error("HQPTUNER_HQP_PASSWORD is not set; source hqpcreds first");
  return { username, password };
}

/**
 * Log in with a session login (never "remember", so nothing is written to the
 * app's store) and return a fetch that sends the login cookie on every request
 * it is given. Rejects, naming the login, when the login is refused or
 * unanswered, so no later request is sent.
 *
 * @param {string} base
 * @param {{ username: string, password: string }} credentials
 * @param {FetchImpl} fetchImpl
 * @returns {Promise<FetchImpl>}
 */
export async function loggedInFetch(base, credentials, fetchImpl) {
  const url = `${base}/api/login`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...credentials, remember: false }),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`login at ${url} failed: no answer (${reason})`, { cause });
  }
  if (!res.ok) throw new Error(`login at ${url} failed: ${res.status} ${res.statusText}`);
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${LOGIN_COOKIE}=`));
  if (!header) throw new Error(`login at ${url} failed: answered ${res.status} with no ${LOGIN_COOKIE} cookie`);
  const cookie = header.split(";")[0];
  return (input, init = {}) => fetchImpl(input, { ...init, headers: { ...init.headers, Cookie: cookie } });
}
