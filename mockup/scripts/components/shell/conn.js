// Brand knob = connection lamp: v1's knob glyph back beside the mark, and the Connected pill folded
// into it. The ring is the light (v1 StatusPill's three states): ok = Connected (green), busy = Applying… (amber, the
// pointer sweeps while the engine restarts), lost = Unreachable (red, the pointer turned to off). The state word is the
// button's name and tooltip line; tap = v1's way into connection settings (that panel is not drawn).
// Mock: ok. `#conn-busy` / `#conn-lost` show the other states; every Apply flashes busy for 1.2 s (mock restart).

import { PLATFORM } from "../../../../hqptuner/static/lib/clock.js";
import { revertAfter } from "../../../../hqptuner/static/model/shell/timing.js";

/** @typedef {import('../../model/shell/flags.js').Flags['conn']} ConnState */

/** @type {Record<ConnState, string>} */
const STATES = {
  ok: "Connected",
  busy: "Applying…",
  lost: "Unreachable",
};
// v1 StatusPill title (owner copy).
const HINT = "Open connection settings to set the HQPlayer Embedded server's IP address and authentication details.";

/**
 * Mount the knob's connection lamp on `state0`; set() moves it, applying() flashes busy and settles back to ok.
 *
 * @param {HTMLButtonElement} btn
 * @param {ConnState} state0   the state to open on (model/flags.js `conn`)
 * @param {import('../../../../hqptuner/static/lib/clock.js').Clock} [clock]
 * @returns {{set: (s: ConnState) => void, applying: () => void}}
 */
export function mountConn(btn, state0, clock = PLATFORM) {
  /** @type {ConnState} */
  let state = "ok";
  /** @param {ConnState} s */
  function set(s) {
    state = s;
    btn.dataset.state = s;
    btn.setAttribute("aria-label", `${STATES[s]}. Connection settings`);
    btn.title = `${STATES[s]} — ${HINT}`;
  }
  set(state0);
  const settle = revertAfter(1200, () => set("ok"), clock);
  return {
    set,
    /** An apply went out: the engine restarts under it (mock: 1.2 s), then back to what it was. */
    applying() {
      if (state === "lost") return;
      set("busy");
      settle();
    },
  };
}
