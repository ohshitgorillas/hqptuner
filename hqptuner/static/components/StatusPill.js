// Connection status pill, driven by backend connection-manager state + the
// apply lifecycle:
//   green  — both daemon lanes loaded, idle
//   amber  — apply in flight (daemon may be restarting), or an outage alarm
//   red    — unreachable, or reachable with the connect still loading
import { html } from "../lib/dom.js";
import { ready, alarm } from "../store/signals.js";
import { applying } from "../store/actions.js";

/** Connection pill reading Connected, Attention, Applying… or Unreachable off the ready, alarm and apply signals. */
export function StatusPill() {
  const state = applying.value || alarm.value ? "amber" : !ready.value ? "red" : "green";
  const text = applying.value ? "Applying…" : { green: "Connected", amber: "Attention", red: "Unreachable" }[state];
  return html`<span class="pill pill-${state}">${text}</span>`;
}
