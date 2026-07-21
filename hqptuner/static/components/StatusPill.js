// Connection status pill, driven by backend connection-manager state + the
// apply lifecycle:
//   green  — reachable, idle
//   amber  — apply in flight (daemon may be restarting), or an outage alarm
//   red    — unreachable
import { html } from "../lib/dom.js";
import { reachable, alarm, applying } from "../store/state.js";

export function StatusPill() {
  const state = applying.value || alarm.value ? "amber" : !reachable.value ? "red" : "green";
  const text = applying.value
    ? "Applying…"
    : { green: "Connected", amber: "Attention", red: "Unreachable" }[state];
  return html`<span class="pill pill-${state}">${text}</span>`;
}
