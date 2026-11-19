// Shared reset of the rendered stage-drawer suites (tests/js/components/faceplate-drawers/): every store signal a
// drawer render reads, put back to an idle engine with no stage, popover, question or staged edit. The drawer store suites
// share it, with the staging wire that records what an apply posts.

import { engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { ok, stagingWire } from "../wire/wire.js";

/**
 * Reset the drawer's store signals: the engine in state `engine`, by default at adaptive volume off, no enums,
 * metadata or pending preset, no stage or popover open, no open question, and nothing staged.
 *
 * @param {Record<string, unknown>} [engine]
 * @returns {Promise<void>}
 */
export async function resetDrawerStore(engine = { adaptive: 0 }) {
  engineState.value = engine;
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
}

/**
 * Install a staging wire that answers an apply with an empty report, and hand back the bodies of the applies it is
 * posted, in arrival order.
 *
 * @returns {string[]}
 */
export function recordApplies() {
  /** @type {string[]} */
  const applies = [];
  stagingWire({
    routes: (path, opts) => {
      if (path !== "/api/config/apply") return undefined;
      applies.push(String(opts.body ?? "{}"));
      return ok({ report: {} });
    },
  });
  return applies;
}
