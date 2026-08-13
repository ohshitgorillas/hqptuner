// Matrix-profile descriptions — the prose the user wrote about a saved profile,
// stored for the install and shared by every browser pointed at it. Keyed by
// profile NAME, the stable join key (architecture §2), because
// `<matrix_profile>` carries only `name` (readme §1.12) and there is nowhere in
// hqplayerd's config for this text to live.
//
// Writes are QUEUED, not optimistic. A star is one click and lands or does not;
// a description is typed, and a PUT per keystroke would be a write storm on the
// LAN and a store rewritten a hundred times per paragraph. So the editor calls
// `queueDescription` as the user types and the queue drains on a short pause —
// or immediately, when the editor calls `flushDescriptions` because focus left,
// the card unmounted, or the tab went to the background. That last part is why
// the flush is public: blur alone loses the paragraph when Preact unmounts the
// card on a tab switch, which is exactly how people leave a page.
//
// A failed write puts the text BACK on the queue rather than reverting the
// signal. What the user typed is the thing being protected here: reverting to
// the server's copy would delete a paragraph in front of them to report that we
// could not save it.
//
// Nothing polls. A tab picks up another tab's edits on reload, like favorites.
// Module load stays node-safe: the hydrate is guarded on `fetch` existing.
import { signal } from "@preact/signals";
import { api } from "../lib/api.js";
import { errText } from "../lib/errtext.js";

// How long the typist has to pause before the queue drains on its own.
const QUIET_MS = 800;

/** @typedef {{ text: string, updated: string }} Description */

/** Every stored description, keyed by profile name. */
export const descriptions = signal(/** @type {Record<string, Description>} */ ({}));
// The last failed write, as the server's own sentence. One error for the
// feature, latest wins — there is one editor on screen at a time.
export const descriptionError = signal("");

/** @type {Map<string, string>} name -> the newest text not yet sent */
const queued = new Map();
/** @type {ReturnType<typeof setTimeout> | null} the open drain timer, or null when idle */
let timer = null;

/**
 * The stored description for a profile name, or null when it has none.
 * @param {string} name
 * @returns {Description | null}
 */
export function descriptionFor(name) {
  return descriptions.value[name] || null;
}

/**
 * Fill the map from the server. Never throws: an unreachable backend leaves
 * whatever is already on screen alone, which is what the page can honestly show.
 * @returns {Promise<void>}
 */
async function hydrateDescriptions() {
  try {
    const body = await api.descriptions();
    descriptions.value = body.profiles || {};
  } catch (e) {
    descriptionError.value = errText(e);
  }
}

/**
 * Hold ``text`` as this profile's description, to be written when the typist
 * pauses or the editor flushes. Queuing again for the same name replaces what
 * was queued — only the newest text is ever sent.
 * @param {string} name
 * @param {string} text
 * @returns {void}
 */
export function queueDescription(name, text) {
  queued.set(name, text);
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void flushDescriptions(), QUIET_MS);
}

/**
 * Write every queued description now, one PUT each, and take the server's
 * answer as the stored map. A refused write leaves that name's text queued and
 * the server's sentence in `descriptionError`; the stored entry is never
 * blanked to report a failure.
 * @returns {Promise<void>}
 */
export async function flushDescriptions() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const draining = [...queued];
  queued.clear();
  for (const [name, text] of draining) {
    try {
      const body = await api.saveDescription(name, text);
      descriptions.value = body.profiles || {};
      descriptionError.value = "";
    } catch (e) {
      // Only re-queue when nothing newer arrived while the write was in flight —
      // the newer text is the one the user means.
      if (!queued.has(name)) queued.set(name, text);
      descriptionError.value = errText(e);
    }
  }
}

// Read the map once, at load. Guarded on `fetch` because this module is imported
// by the SSR harness, where there is no backend to ask.
if (typeof fetch === "function") void hydrateDescriptions();
