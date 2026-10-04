// Backend step (wizard §1.1): NAA or ALSA, the manual's sentence beside each; a new backend clears the device picked.

import { h } from "../../../../lib/shell/dom.js";
import { STB_COPY, STB_BACKENDS } from "../../../../data/builders/station-builder.js";
import { choice, rich } from "../frame/parts.js";

/** @typedef {import('../../station-builder.js').StationState} StationState */

/**
 * The Backend step's rows.
 *
 * @param {StationState} sb
 */
export function backendStep(sb) {
  return [
    choice("", STB_BACKENDS, sb.e.rec.backend, {
      pick: (v) =>
        sb.set((x) => {
          if (x.backend !== v) Object.assign(x, { backend: v, listings: [], resolved: null });
        }),
    }),
    h("div.stbnotes", {}, h("p", {}, rich(STB_COPY.combo))),
  ];
}
