// Connection status pill, driven by backend connection-manager state + the
// apply lifecycle:
//   green  — both daemon lanes loaded, idle
//   amber  — apply in flight (the daemon is restarting under it)
//   red    — a lane did not come back: unreachable, or the connect still loading
import { html } from "../lib/dom.js";
import { ready } from "../store/signals.js";
import { applying } from "../store/actions.js";
import { engineBusy } from "../store/enginewrite.js";
import { openSetup } from "../store/setup.js";

/** Connection pill reading Applying…, Connected or Unreachable off the ready and apply signals; opens the connection panel. */
export function StatusPill() {
  // `engineBusy` as well as `applying`: a write started on the System page or the
  // speakers card restarts the same daemon, and the pill read Unreachable through it.
  const busy = applying.value || engineBusy.value;
  const state = busy ? "amber" : !ready.value ? "red" : "green";
  const text = busy ? "Applying…" : ready.value ? "Connected" : "Unreachable";
  // The pill is also the way into the connection panel. It is the one element
  // in the chrome that already means "the connection", so opening that panel
  // from it needs no new word anywhere; it is how a user who saved a wrong host
  // gets back to the field they typed it into.
  return html`<button type="button" class="pill pill-${state}" onClick=${openSetup}>${text}</button>`;
}
