// Alerts live in the chain and the header: each blinks the lamp (or header element) it belongs to (components/alerts.js).
// Copy is v1's, verbatim:
//   credentials   store/alerts/credentials.js  (owner-approved)
//   speed / clip / apod   store/health.js       (SLOW_DSP_TAIL; fires after 3 sustained polls < 1.05× / < 1.00×;
//                                                 clip / apod at ≥ 10 this track, apod only with a non-apodizing filter)
//   shaperSdm / shaperPcm store/alerts/shaperfit.js
//   roonIdle      store/alerts/roonidle.js
//   junk*         engine/junkadvisor.py (the backend's reason, rendered as given)
// Reworded for v2 places (owner's wording pass): credentials' "status pill" → the knob; roonIdle's "System tab" →
// Settings → Timing.
// Dropped: v1's failed preset pick/delete row (presetpick.js): it tells the user nothing they can act on.
// sev: crit (--bad) | warn (--warn) | advice (not a fault; blinks amber like a warning, its line reads ink-2).

const SLOW_DSP_TAIL = "Use a lighter filter or a lower output rate.";

export const ALERT_COPY = {
  credentials:
    "Authentication rejected: username and password are bad. Open connection settings from the knob and try again.",
  speedCrit: (sp) => `DSP at ${sp.toFixed(2)}× realtime — actively dropping out. ${SLOW_DSP_TAIL}`,
  speedWarn: (sp) => `DSP at ${sp.toFixed(2)}× realtime — dropout risk. ${SLOW_DSP_TAIL}`,
  clip: (n) => `Clipping ×${n} this track — reduce volume or gain.`,
  apod: (n, filter) =>
    `Apodizing events ×${n} this track, but ${filter} is non-apodizing — consider an apodizing filter.`,
  shaperSdm: (name, rate) =>
    `The current settings are invalid: modulator ${name} is incompatible with ${rate} output. HQPlayer cannot produce output.`,
  shaperPcm: (name, rate, floor) =>
    `The current settings are suboptimal: ditherer ${name} is optimized for output rates >=${floor}, but the current rate is ${rate}.`,
  roonIdle:
    "Recommend setting Engine idle time (Settings → Timing) to 10 or longer; at default idle time, Roon inefficiently restarts the engine between tracks.",
  junk20k: (foldKhz, rateKhz) =>
    `Junk above ${foldKhz.toFixed(1)} kHz in a ${rateKhz} kHz container, consistent with fake hi-res. Recommend engaging the 20k high-frequency filter.`,
  junkSpur: (khz, corner) =>
    `Persistent tone at ${khz.toFixed(1)} kHz — recommend switching to a 'hires' resampling filter or engaging the ${corner} high-frequency filter.`,
  junkRamp: (khz) =>
    `HF noise rising toward ${khz} kHz — consistent with excessive noise shaping (some ADCs, DSD-to-PCM transfers). Recommend engaging the 50k high-frequency filter.`,
};

/**
 * Where each alert lives (spec: Alerts). An alert blinks its home; a tap there shows it:
 *   stage    rail stage whose lamp blinks; its drawer opens with the alert line pinned under the head
 *   drawer   that drawer's id; row = the drawer row that fixes it (its label, lit in the alert's colour)
 *   section  page section whose header carries the line beside its title (when the section is on the page). The running
 *            chain's filter / modulator / ditherer alerts live only here: the page holds those fields, the drawer drops them.
 *   el       header / engine-row element that blinks instead of a lamp; a tap opens the alert in a popover
 *   set      Settings rail category that blinks while the gear does; its drawer carries the line
 *   dark     rail stages after it that go dark: nothing reaches them (an SDM modulator below its floor = no output)
 * Several alerts on one home: the worst one sets the blink (crit over warn).
 */
export const HOMES = {
  credentials: { el: "#conn" },
  speed: { el: ".gauge" },
  clip: { stage: "volume", drawer: "volume" },
  apod: { stage: "resampling", section: "Resampling" },
  shaperSdm: { stage: "shaping", section: "Shaping", dark: ["speakers", "output"] },
  shaperPcm: { stage: "shaping", section: "Shaping" },
  roon: { el: "#gear", set: "timing", drawer: "timing", row: ["Engine idle time"] },
  junk: { stage: "hf", drawer: "hf", row: ["High-frequency filter"], section: "HF filter" },
};

// Mock alert picker on the scenario strip (a viewing tool): which alerts to raise. Each fires only where v1's would:
// engine health while playing; junk advice only on Nx PCM content (the HF filter can't be engaged at 1x rates); a shaper
// conflict only in the family that will produce output.
export const MOCK_ALERTS = [
  { kind: "credentials", label: "Credentials rejected" },
  { kind: "speed", label: "DSP speed", when: "playing" },
  { kind: "clip", label: "Clipping", when: "playing" },
  { kind: "apod", label: "Apodizing", when: "non-apod filter" },
  { kind: "shaperSdm", label: "Modulator invalid", when: "SDM chain" },
  { kind: "shaperPcm", label: "Ditherer suboptimal", when: "PCM chain" },
  { kind: "roon", label: "Roon idle time", when: "playing" },
  { kind: "junk", label: "HF filter advice", when: "Nx PCM" },
];
// Mock figures the raised alerts read (and the engine row then shows): a speed below 1× and a clip pile-up.
export const MOCK_FIG = { speed: 0.97, clips: 14 };
