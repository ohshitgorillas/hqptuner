// Engine-health alert strip — a warning row under the signal-path bar that
// exists only while something is wrong (healthy = zero pixels, matching the
// bar's omit-disabled-stages principle). Conditions and wording live in
// store/health.js; this just renders the list.
//
// The junk-filter advice chip (store/alerts/junkadvice.js) rides the same strip: it is
// the same "the engine has something to tell you" surface, but advisory rather
// than a fault, so it carries its own tone. Text only — no controls; it clears
// itself when the track changes or the engaged settings treat the junk.
// Rate/shaper conflicts (store/alerts/shaperfit.js) ride the strip between the two:
// they are faults like the health alerts rather than advice, but they are a
// property of the settings rather than of playback, so unlike the health alerts
// they show with the engine stopped.
// The rejected-credentials row (store/alerts/credentials.js) leads the strip: a
// refused credential explains the whole broken half of the app, so it outranks a
// per-track health warning.
import { html } from "../lib/dom.js";
import { engineAlerts } from "../store/health.js";
import { shaperAlerts } from "../store/alerts/shaperfit.js";
import { roonIdleAlert } from "../store/alerts/roonidle.js";
import { credentialsAlert } from "../store/alerts/credentials.js";
import { junkAdvice } from "../store/alerts/junkadvice.js";

/** Warning row of engine-health and rate/shaper alerts plus the junk-filter advice chip; renders nothing when all are empty. */
export function AlertStrip() {
  const roon = roonIdleAlert.value;
  const creds = credentialsAlert.value;
  const alerts = [
    ...(creds ? [creds] : []),
    ...engineAlerts.value,
    ...shaperAlerts.value,
    ...(roon ? [roon] : []),
  ];
  const advice = junkAdvice.value;
  if (!alerts.length && !advice) return null;
  return html`
    <div class="alert-strip">
      ${alerts.map(
        (/** @type {import("../store/health.js").Alert} */ a) =>
          html`<span class="alert alert-${a.sev}" data-alert=${a.kind}>⚠ ${a.text}</span>`,
      )}
      ${advice && html`<span class="alert alert-advice" data-alert="junk-advice">♪ ${advice.reason}</span>`}
    </div>
  `;
}
