// The high-frequency filter's auto-pilot switch.
//
// Not a schema field: it has no lane and no daemon setting behind it, so it follows the
// Auto-save checkbox's shape — its own action, its own copy — rather than store/schema.js.
// It renders in two places, the Output tab's Pre-process card and the LIVE Playback card,
// which is why it is a component rather than markup inlined at either site. The markup is
// the ordinary field row so it sits in a pack beside real fields with no CSS of its own.
//
// The state is read off /api/status, not remembered here: the backend switches auto-pilot
// off by itself the moment the filter is set by hand.

import { html } from "../lib/dom.js";
import { Checkbox } from "./controls/index.js";
import { autopilot, metering, setAutopilot } from "../store/actions.js";
import { notesVisible } from "../store/prefs.js";

const LABEL = "High-freq filter auto-pilot";
const NOTE =
  "Automatically engages and disengages the high-frequency filter 20k to 50k settings as needed for hi-res content. Setting the filter manually disables this setting.";
// Grays when the metering reader is off (HQPTUNER_METERING_ENABLED=0): the advisor is what
// auto-pilot acts on, and without it the switch would be a control that does nothing.
const NO_METERING = "Metering is disabled; HQPTuner can't determine optimal settings.";

/** The auto-pilot switch as an ordinary field row, grayed when there is no metering to act on. */
export function AutopilotToggle() {
  const grayed = !metering.value;
  return html`
    <div class="field field-checkbox" data-k="junk_filter_autopilot" title=${grayed ? NO_METERING : NOTE}>
      <label>${LABEL}</label>
      <div class="control">
        <${Checkbox}
          value=${autopilot.value ? "1" : "0"}
          disabled=${grayed}
          onChange=${(/** @type {string} */ v) => setAutopilot(v === "1")}
        />
      </div>
      ${notesVisible.value ? html`<div class="field-note">${NOTE}</div>` : null}
      ${grayed ? html`<div class="field-gray-reason">${NO_METERING}</div>` : null}
    </div>
  `;
}
