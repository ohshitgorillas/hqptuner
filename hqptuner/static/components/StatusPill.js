// Connection status pill, driven by backend connection-manager state + the
// apply lifecycle:
//   green  — both daemon lanes loaded, idle
//   amber  — apply in flight (the daemon is restarting under it)
//   red    — a lane did not come back: unreachable, or the connect still loading
import { html } from "../lib/dom.js";
import { ready } from "../store/signals.js";
import { applying } from "../store/actions.js";

/** Connection pill reading Applying…, Connected or Unreachable off the ready and apply signals. */
export function StatusPill() {
  const state = applying.value ? "amber" : !ready.value ? "red" : "green";
  const text = applying.value ? "Applying…" : ready.value ? "Connected" : "Unreachable";
  return html`<span class="pill pill-${state}">${text}</span>`;
}
