// Shared reset of the rendered stage-drawer suites (tests/js/components/faceplate-drawers/): every store signal a
// drawer render reads, put back to an idle engine with no stage, popover, question or staged edit.

import { engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";

/**
 * Reset the drawer's store signals: the engine at adaptive volume off, no enums, metadata or pending preset, no
 * stage or popover open, no open question, and nothing staged.
 *
 * @returns {Promise<void>}
 */
export async function resetDrawerStore() {
  engineState.value = { adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
}
