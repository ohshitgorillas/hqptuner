// The connection panel's own state: whether it is showing, what discovery
// found, what the user has typed, and what the daemon said after a save.
//
// Two things open the panel. A user opening it from the status pill, and this
// module deciding an install cannot use its daemon. The second reading is taken
// off the health poll and is deliberately not symmetric:
//
//   `credentials_ok` false is a verdict. It is only ever written when the 8088
//   lane has actually answered (lanes/http/forms.py), so there is nothing to
//   wait for and the panel opens on the reading that carries it.
//
//   `reachable` false is not, on its own, evidence of anything: the backend
//   constructs its connection manager unreachable and connects asynchronously,
//   so the first reading of a perfectly healthy install says exactly that. The
//   panel waits GRACE_MS of elapsed browser time before believing it.
//
// The grace is elapsed time rather than a count of polls because the poll's
// cadence is not a constant — store/sync.js reschedules the fast timer off
// `fastPollMs`, 1 s on the volume page, in LIVE and on System with quick
// updates, 2 s otherwise. Counting polls would buy one user twice the grace of
// the next. It is browser time rather than the age of `unreachable_since`,
// which is a server wall-clock stamp: subtracting it here would put two clocks
// in one comparison.
//
// A page that has seen the daemon connected is never auto-opened again. The
// pill and the alert strip already report a daemon that goes away mid-session,
// and a panel thrown over a working page on every dropout would be its own
// fault report.
import { signal, effect } from "@preact/signals";
import { health } from "./signals.js";
import { api, onLoginRequired } from "../lib/api.js";

// How long `reachable` false must hold, from the page's own clock, before the
// panel treats it as an install that cannot reach its daemon.
const GRACE_MS = 3000;

/** Whether the connection panel is showing. */
export const setupOpen = signal(false);
/**
 * Whether this browser holds no valid login.
 *
 * Entered the moment any request is refused with the gate's `login_required` code, and left
 * by a login the backend accepts. While it holds, the panel is the whole page and nothing
 * gated is requested on a timer.
 */
export const loggedOut = signal(false);
/** The host name the page was served from, written once at startup. */
export const pageHost = signal("");
/** Whether a discovery call is in flight. Its wait is the daemon's, up to `discovery_timeout`. */
export const discovering = signal(false);
/**
 * The panel's staged values, seeded from GET /api/connection when it opens.
 *
 * `hasPassword` is the wire's `has_password`, not a value the user types: the read
 * route never answers the password itself, so it is the only way to tell a blank
 * field over a stored password from a blank field over none.
 */
export const form = signal({ host: "", username: "", password: "", remember: true, hasPassword: false });
/**
 * Whether the host field has been edited since the panel opened.
 *
 * Discovery lands seconds after the panel does, so it must never overwrite an
 * address the user has already started typing.
 */
export const hostTouched = signal(false);
/**
 * What the panel has to say about the last press of Connect. Eleven members:
 *
 *   null          nothing pressed yet, or the panel has just been opened
 *   "no-host"     the address field was empty, so nothing was sent
 *   "connecting"  sent, and the readings that judge it have not settled
 *   "saved"       the daemon came up on it; the panel closes on this one
 *   "refused"     the daemon rejected the username and password
 *   "no-8088"     saved with no management credentials to try
 *   "no-answer"   the daemon answered, its settings port at 8088 did not
 *   "unreachable" nothing answered at the address
 *   "not-answered" a login could not be checked, because the daemon did not answer
 *   "pinned"      a save or login named a host, username or password the environment pins
 *   "rejected"    a save or login was refused for its host or its missing credentials
 *
 * A login refused for the typed pair reads "refused".
 */
export const verdict = signal(null);

/**
 * The backend's own sentence for the "pinned" and "rejected" verdicts, shown as it arrived: the
 * refusal names what is wrong, and the wording is the server's.
 */
export const loginSentence = signal("");

// A refused request that says the browser has no login puts the page at the login screen.
// The panel's own routes (the saved record, discovery) are gated too, so it opens without
// reading them: the host, username and password rows start as the user finds them.
onLoginRequired(() => {
  loggedOut.value = true;
  setupOpen.value = true;
});

// The page's own clock, swapped by initSetup so a test can drive it.
let clock = () => performance.now();
// When this page started watching. The grace is measured from here rather than
// from the first failing reading: a page loaded into an install that is already
// down should not owe the grace twice.
let watchingSince = clock();
// Whether the daemon has been connected at any point since this page loaded.
let everConnected = false;
// Whether this page has already auto-opened. One per page load; a user who
// closes the panel is not shown it again by the poll.
let autoOpened = false;
// Whether a save is waiting on the health readings that judge it.
let awaitingVerdict = false;
// When the last save's POST answered, on the page's own clock. The reconnect that
// save triggered has to be given the same grace a cold page gets, and it is measured
// from here rather than from `watchingSince`, which belongs to the auto-open rule and
// must not move when a user presses Connect.
let savedAt = 0;
// What the last save's POST said its own 8088 attempt did. The health poll cannot
// answer this: `credentials_ok` is written only on a refusal, so it still holds the
// previous pair's verdict whenever this attempt failed on the wire or had no
// credentials to try.
/** @type {string | null} */
let savedLane = null;
// Whether the save now in flight should close the panel when it works. Save does;
// Connect does not, because Connect is how a user tries an address again and the
// panel carries the link and the instructions they may still need.
let closeOnSuccess = false;

/**
 * Open the panel, seed it from what HQPTuner is dialling now, and sweep for
 * daemons.
 *
 * The seed is awaited before the sweep: both write the host field, and the
 * sweep's answer is the one that should win when it has exactly one.
 */
export function openSetup() {
  setupOpen.value = true;
  loadConnection().then(runDiscovery);
}

/**
 * Close the panel and forget the save it was reporting on.
 *
 * Logged out, the panel is the whole page and there is nothing to close to, so every way of
 * closing it (Escape, a click on the scrim) leaves it open.
 */
export function closeSetup() {
  if (loggedOut.value) return;
  setupOpen.value = false;
  awaitingVerdict = false;
}

// What one reading says about the save that is waiting on it. A good reading is the
// save having worked, and the panel has nothing left to do.
//
// The credential question is answered by the POST's own `lane` and never by the
// reading; the reading answers reachability and `ready`. `reachable` false is what
// every correct save looks like for about a second, because the save drops the
// control lane on purpose, so it is believed only once it has held for the grace.
/** @param {Record<string, unknown>} h */
function judgeSave(h) {
  if (h.ready) {
    verdict.value = "saved";
    awaitingVerdict = false;
    if (closeOnSuccess) closeSetup();
    return;
  }
  if (savedLane === "refused") verdict.value = "refused";
  else if (h.reachable === false && clock() - savedAt >= GRACE_MS) verdict.value = "unreachable";
  else if (h.reachable && savedLane === "no_credentials") verdict.value = "no-8088";
  else if (h.reachable && savedLane === "no_answer") verdict.value = "no-answer";
  else verdict.value = "connecting";
}

// Whether this reading is an install that cannot use its daemon: a refusal at
// once, silence only once the grace has run out.
/** @param {Record<string, unknown>} h */
function cannotUseDaemon(h) {
  if (h.credentials_ok === false) return true;
  return h.reachable === false && clock() - watchingSince >= GRACE_MS;
}

/** @param {Record<string, unknown> | null} h */
function judge(h) {
  if (!h) return;
  if (h.connected) everConnected = true;
  if (awaitingVerdict) {
    judgeSave(h);
    return;
  }
  if (everConnected || autoOpened || setupOpen.value) return;
  if (cannotUseDaemon(h)) {
    autoOpened = true;
    openSetup();
  }
}

/** Subscribe to the health poll. */
function watch() {
  return effect(() => {
    judge(/** @type {Record<string, unknown> | null} */ (health.value));
  });
}

// One is installed at import, because closing the panel on a good reading after
// a save is not the app's startup wiring: it is what submitConnection is
// waiting for, and it has to work wherever the panel is driven from.
let dispose = watch();

/**
 * Start this page watching: point the grace at a clock, restart it, and forget
 * what any earlier page load had seen. Hands back the disposer for the watch it
 * installs, and only that one.
 *
 * The disposer is per call rather than one shared handle. A caller that
 * disposes must not be able to leave the module deaf to the health poll for
 * everything that comes after it.
 *
 * @param {() => number} [now] the page's clock; the default is `performance.now`
 */
export function initSetup(now) {
  if (now) clock = now;
  watchingSince = clock();
  everConnected = false;
  autoOpened = false;
  awaitingVerdict = false;
  savedAt = 0;
  savedLane = null;
  verdict.value = null;
  dispose();
  dispose = watch();
  return dispose;
}

/**
 * Ask the backend which daemon answers discovery, and fill the host field with it.
 *
 * One machine runs one daemon, so a single answer settles the question and its
 * address fills the field. The fill is suppressed the moment the user has
 * touched the field, and an answer of any other length is left alone.
 */
export async function runDiscovery() {
  discovering.value = true;
  try {
    const found = await api.discoverDaemons();
    const answered = Array.isArray(found) ? found : [];
    if (answered.length === 1 && !hostTouched.value) {
      form.value = { ...form.value, host: answered[0].address };
    }
  } catch {
    // an unanswered sweep leaves the field as it stands
  } finally {
    discovering.value = false;
  }
}

/** Sweep again; a single answer overwrites what the user typed, unlike the sweep on open. */
export async function detectHosts() {
  hostTouched.value = false;
  await runDiscovery();
}

/** Seed the panel from what HQPTuner is dialling now. */
async function loadConnection() {
  hostTouched.value = false;
  verdict.value = null;
  try {
    const c = await api.connection();
    form.value = {
      host: c.host || "",
      username: c.username || "",
      password: "",
      remember: c.remember === true,
      hasPassword: c.has_password === true,
    };
  } catch {
    /* an install whose own backend will not answer still gets a panel to type into */
  }
}

// What a login the backend refused says, by the refusal's code.
/** @type {Record<string, string>} */
const LOGIN_VERDICTS = {
  login_refused: "refused",
  login_not_answered: "not-answered",
  login_values_pinned: "pinned",
  host_invalid: "rejected",
};

// What a save the backend refused before writing anything says, by the refusal's code. Both
// verdicts carry the backend's own sentence.
/** @type {Record<string, string>} */
const SAVE_VERDICTS = { login_values_pinned: "pinned", host_invalid: "rejected", credentials_required: "rejected" };

/**
 * Show the backend's sentence for a refusal that carries its own, under the verdict `next` names.
 *
 * @param {unknown} e the failure the request rejected with
 * @param {string} next a verdict from `LOGIN_VERDICTS` or `SAVE_VERDICTS`
 */
function showSentence(e, next) {
  if (next === "pinned" || next === "rejected") loginSentence.value = /** @type {Error} */ (e).message;
  verdict.value = next;
}

/**
 * Log this browser in with the pair the panel holds.
 *
 * The password is always sent, blank included: the backend checks a blank as blank and never
 * fills it from the pair it holds. The host rides only when the user typed one. A 200 leaves
 * the logged-out state and reloads the page, so every request it makes is made with the login.
 *
 * @param {{ host: string, username: string, password: string, remember: boolean }} f
 */
async function logIn(f) {
  /** @type {Record<string, unknown>} */
  const body = { username: f.username, password: f.password, remember: f.remember };
  const host = f.host.trim();
  if (host) body.host = host;
  try {
    await api.login(body);
  } catch (e) {
    const next = LOGIN_VERDICTS[/** @type {{ code?: string }} */ (e).code || ""];
    if (!next) throw e;
    showSentence(e, next);
    return;
  }
  loggedOut.value = false;
  setupOpen.value = false;
  verdict.value = null;
  globalThis.location?.reload();
}

/**
 * Save what the panel holds, then wait for the daemon's verdict.
 *
 * Logged out, the panel holds a login and not a save: the same rows are sent to /api/login.
 *
 * The password rides the body in both storage modes: `remember` false is a
 * request not to write it to disk, not a request to run without one, and the
 * backend keeps the pair on the live config for the rest of the process.
 *
 * The panel does not close here. POST /api/connection saves without verifying
 * — deliberately, so an outage can be fixed while it is happening — so the 200
 * says the record was written and nothing about whether the daemon accepts it.
 * The readings that follow say that, and the panel closes on one that does.
 */
export async function submitConnection(andClose = false) {
  const f = form.value;
  if (loggedOut.value) {
    await logIn(f);
    return;
  }
  const host = f.host.trim();
  closeOnSuccess = andClose;
  if (!host) {
    verdict.value = "no-host";
    return;
  }
  verdict.value = "connecting";
  awaitingVerdict = true;
  /** @type {Record<string, unknown>} */
  const body = { host, username: f.username, remember: f.remember };
  // A blank field is the user leaving the password alone, whichever one is in force —
  // stored, or the daemon's published default — so the key is omitted and the route
  // keeps what it has. Clearing a password is not something this panel does.
  if (f.password) body.password = f.password;
  let answer;
  try {
    answer = await api.saveConnection(body);
  } catch (e) {
    const next = SAVE_VERDICTS[/** @type {{ code?: string }} */ (e).code || ""];
    if (!next) throw e;
    awaitingVerdict = false;
    showSentence(e, next);
    return;
  }
  savedAt = clock();
  savedLane = answer && answer.lane;
  // Judge the reading already in hand rather than waiting for the next poll: the
  // credential outcome is in `answer`, and a user who typed a wrong password should
  // not read "Connecting" for a poll interval before being told.
  judgeSave(/** @type {Record<string, unknown>} */ (health.value) || {});
}

/**
 * Write `address` into the host field, as the same-machine links do.
 *
 * Marks the field touched, so a discovery answer landing afterwards cannot overwrite
 * an address the user has just chosen.
 *
 * @param {string} address
 */
export function fillHost(address) {
  hostTouched.value = true;
  form.value = { ...form.value, host: address };
}
