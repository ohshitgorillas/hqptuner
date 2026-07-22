// Engine-health alert strip — a warning row under the signal-path bar that
// exists only while something is wrong (healthy = zero pixels, matching the
// bar's omit-disabled-stages principle). Conditions and wording live in
// store/health.js; this just renders the list.
import { html } from "../lib/dom.js";
import { engineAlerts } from "../store/health.js";

export function AlertStrip() {
  const alerts = engineAlerts.value;
  if (!alerts.length) return null;
  return html`
    <div class="alert-strip">
      ${alerts.map((a) => html`<span class="alert alert-${a.sev}">⚠ ${a.text}</span>`)}
    </div>
  `;
}
