// Engine-health alert strip — a warning row under the signal-path bar that
// exists only while something is wrong (healthy = zero pixels, matching the
// bar's omit-disabled-stages principle). Conditions and wording live in
// store/health.js; this just renders the list.
//
// The junk-filter advice chip (store/junkadvice.js) rides the same strip: it is
// the same "the engine has something to tell you" surface, but advisory rather
// than a fault, so it carries its own tone. Text only — no controls; it clears
// itself when the track changes or the engaged settings treat the junk.
import { html } from "../lib/dom.js";
import { engineAlerts } from "../store/health.js";
import { junkAdvice } from "../store/junkadvice.js";

export function AlertStrip() {
  const alerts = engineAlerts.value;
  const advice = junkAdvice.value;
  if (!alerts.length && !advice) return null;
  return html`
    <div class="alert-strip">
      ${alerts.map((a) => html`<span class="alert alert-${a.sev}">⚠ ${a.text}</span>`)}
      ${advice && html`<span class="alert alert-advice">♪ ${advice.reason}</span>`}
    </div>
  `;
}
