// Sync: mirror the backend's snapshots into the source signals (store/signals.js).
// The backend does the daemon talking and pushes each snapshot on GET /api/push
// (api/push.py) whenever its content moves; this layer only copies what arrives.
// The write paths that need a snapshot at once pull it over REST instead.

import { api } from "../lib/api.js";
import { lastApply } from "./actions.js";
import {
  health,
  engineState,
  engineStatus,
  enums,
  config,
  matrixConfig,
  metadata,
  volume,
  volumeRange,
  staged,
} from "./signals.js";

const PUSH = "/api/push";

/**
 * @typedef {{ data?: unknown }} Payload
 *   What a snapshot route answers with. Most wrap their snapshot as
 *   `{stale, loaded_at, data}`; health/metadata/pending answer raw, which is
 *   what `unwrap` selects between.
 */

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | null>}
 */
async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// Mirror one snapshot route into its signal. A failed call leaves the last
// good value in place rather than blanking the UI. Most routes answer with
// the payload under `.data`; `unwrap` names the ones that answer raw.
const raw = (/** @type {Payload} */ r) => r;
const data = (/** @type {Payload} */ r) => r.data;
/**
 * Write `next` into `sig` only where it reads differently from what the signal
 * holds. Every body is parsed into a fresh object, so the comparison is by
 * content: a reference compare would notify every subscriber on every body.
 *
 * @param {{ value: unknown }} sig
 * @param {unknown} next
 */
function assignChanged(sig, next) {
  if (JSON.stringify(next) !== JSON.stringify(sig.value)) sig.value = next;
}

/**
 * Copy one snapshot route's payload into its signal, leaving the last good
 * value in place when the call fails and the signal untouched when the payload
 * reads the same as the one it holds.
 *
 * @param {() => Promise<Payload>} fn
 * @param {{ value: unknown }} sig
 * @param {(r: Payload) => unknown} [unwrap]
 * @returns {Promise<void>}
 */
export async function mirror(fn, sig, unwrap = data) {
  const r = await safe(fn);
  if (r) assignChanged(sig, unwrap(r));
}

/**
 * Take one health reading now, off the push stream.
 *
 * The pill and the page dim read `health`. A write that restarts the daemon
 * finishes with a reading of its own here, so the pill leaves its Applying…
 * state onto the health the daemon has now rather than whatever the stream
 * last sent mid-restart.
 *
 * @returns {Promise<void>}
 */
export async function refreshHealth() {
  await mirror(api.health, health, raw);
}

/**
 * Trigger a daemon output-device rescan, then re-pull the config forms so the
 * device dropdowns show a newly-present endpoint (an NAA powered back on).
 *
 * @returns {Promise<{ restored: Record<string, string>, warning?: string }>}
 *   The rescan report. `warning` is set when the rescan finished but the live
 *   settings it stopped the engine for could not be put back — the caller
 *   surfaces it, because a silent loss is the bug this reports on.
 */
export async function refreshDevices() {
  const r = await api.refreshDevices();
  await refreshConfig();
  // Reported here rather than at the button, so every caller surfaces it: a
  // rescan that lost the user's live settings must say so whoever asked for it.
  // Left untouched when there is nothing to warn about — the line is still
  // showing the last apply's result and the user may be reading it.
  if (r && r.warning) lastApply.value = { ok: false, code: "rescan-warning", text: r.warning };
  return r;
}

/** Re-pull the slow snapshots — enumerations, config, matrix and the pending buffer. */
export async function refreshConfig() {
  await mirror(api.enumerations, enums);
  await mirror(api.config, config);
  await mirror(api.matrix, matrixConfig);
  await mirror(api.pending, staged, raw);
}

/**
 * The push events that land in one signal each, and what of the body lands:
 * a snapshot route's `data`, or the whole body of a raw one.
 *
 * @type {Array<[string, { value: unknown }, (r: Payload) => unknown]>}
 */
const ROUTES = [
  ["health", health, raw],
  ["state", engineState, data],
  ["status", engineStatus, data],
  ["enumerations", enums, data],
  ["config", config, data],
  ["matrix", matrixConfig, data],
  ["pending", staged, raw],
];

/**
 * The one body feeding two signals: the level, and the range it sits in.
 *
 * @param {{ volume: unknown }} v
 */
function landVolume(v) {
  volume.value = v.volume;
  assignChanged(volumeRange, v);
}

/** @type {EventSource | null} */
let stream = null;

/** @returns {boolean} whether the browser has hidden the page; false where there is no document */
const pageHidden = () => typeof document !== "undefined" && document.hidden;

/** Open the push stream, unless one is open or the page is hidden. */
function openStream() {
  if (stream || pageHidden()) return;
  const es = new EventSource(PUSH);
  for (const [name, sig, unwrap] of ROUTES) {
    es.addEventListener(name, (e) => assignChanged(sig, unwrap(JSON.parse(e.data))));
  }
  es.addEventListener("volume", (e) => landVolume(JSON.parse(e.data)));
  stream = es;
}

/** Close the push stream, if one is open. */
function closeStream() {
  if (stream) stream.close();
  stream = null;
}

/**
 * Prime the static metadata once, and hold the push stream open while the page
 * is shown. The stream answers every snapshot it holds as it opens, so a page
 * coming back is current at once. Where there is no document or no EventSource
 * nothing is opened.
 */
export function startSync() {
  safe(api.metadata).then((m) => {
    if (m) metadata.value = m;
  });
  if (typeof document === "undefined" || typeof EventSource === "undefined") return;
  openStream();
  document.addEventListener("visibilitychange", () => {
    if (pageHidden()) closeStream();
    else openStream();
  });
}
