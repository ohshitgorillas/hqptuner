// What the state import suites share: the routes of the page's fixed reads, the state upload's change handler found
// through the vnode seam, and the file a case uploads.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { readings } from "../../../../hqptuner/static/store/core/readings.js";
import { renderTree } from "../vnodeseam.js";
import { ok } from "../wire/wire.js";
import { STATE } from "../wire/livepresetwire.js";

/** @typedef {import("../wire/wire.js").FakeResponse} FakeResponse */

/**
 * The answer to one of the page's fixed reads, or undefined for any other path: the health reading as `payload`, a
 * fresh PCM state, and the served readings.
 *
 * @param {string} bare  the request path without its query
 * @param {Record<string, unknown>} payload
 * @returns {FakeResponse | undefined}
 */
export function pageRead(bare, payload) {
  if (bare === "/api/health") return ok({ ...payload });
  if (bare === "/api/state") return ok({ stale: false, loaded_at: 1, data: STATE("pcm") });
  if (bare === "/api/config") return ok(readings.value);
  return undefined;
}

/**
 * The state upload's change handler on a rendered `About`, or a no-op when the page draws no state upload.
 *
 * @param {Parameters<typeof html>[0]} About
 * @returns {(e: unknown) => unknown}
 */
export function stateUploadChange(About) {
  const { seen } = renderTree(html`<${About} />`);
  const fn = seen.find((v) => v.props["data-testid"] === "state-import")?.props.onChange;
  return typeof fn === "function" ? /** @type {(e: unknown) => unknown} */ (fn) : async () => undefined;
}

/** A state archive to upload. */
export const stateZip = () => new File([new Uint8Array(8)], "hqptuner-state.zip");

/**
 * The change event a file chosen on the state upload fires.
 *
 * @param {File} file
 */
export const chosen = (file) => ({ target: { files: [file], value: "" } });
