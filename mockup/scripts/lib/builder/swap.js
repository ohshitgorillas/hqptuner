// The shell's body swap and Escape: a builder's body in for the chain's and back out, its button and Escape armed.

import { anyOpen } from "../shell/popover.js";
import { closeSheets, sheetOpen } from "../shell/sheet.js";
import { closeOthers } from "../../components/drawers/drawer.js";

/** @typedef {import('./record.js').Shell} Shell */
/** @typedef {{ btn: HTMLElement, chain: HTMLElement, body: HTMLElement, bus: { emit: (t: string) => void } }} Els */

/**
 * Swap a body in for the chain's, or back out: every drawer and sheet closes, the button reads pressed while it shows,
 * the rail wire re-measures. `leave` runs as it swaps in (the other bodies turn off), `opened` once it shows; with
 * `toChain` false, leaving keeps the chain hidden (another body takes over).
 *
 * @param {Els} el
 * @param {boolean} on
 * @param {{ toChain?: boolean, leave?: () => void, opened?: () => void }} [o]
 */
export function swapBody({ btn, chain, body, bus }, on, { toChain = true, leave, opened } = {}) {
  closeOthers(null);
  closeSheets();
  if (on) leave?.();
  body.hidden = !on;
  if (on) chain.hidden = true;
  else if (toChain) chain.hidden = false;
  btn.setAttribute("aria-pressed", String(on));
  if (on) opened?.();
  bus.emit("relayout");
}

/**
 * Escape while the body shows runs `onEscape`. Capture: an open drawer, popover or sheet hears Escape first, so one
 * Escape closes it or leaves the body, not both.
 *
 * @param {HTMLElement} body
 * @param {() => void} onEscape
 */
export function escapeLeaves(body, onEscape) {
  body.ownerDocument.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key !== "Escape" ||
        body.hidden ||
        anyOpen() ||
        sheetOpen() ||
        body.querySelector(".drawer:not([data-closed])")
      )
        return;
      onEscape();
    },
    true,
  );
}

/**
 * The builder's setOn: swap its body in or out; the confirm line clears as it opens.
 *
 * @param {Els} el
 * @param {Shell} sh
 * @param {{ leave: () => void, opened: () => void }} spec
 */
export const setOnOf =
  (el, sh, spec) =>
  (/** @type {boolean} */ on, toChain = true) => {
    swapBody(el, on, {
      toChain,
      leave: () => spec.leave(),
      opened: () => {
        sh.ask = null;
        spec.opened();
      },
    });
  };

/**
 * Arm the builder's button and Escape; the builder's public face.
 *
 * @param {Els} el
 * @param {Shell} sh
 * @param {{ toggles?: boolean, view: (where: any) => void }} spec
 * @param {(on: boolean, toChain?: boolean) => void} setOn
 */
export function start({ btn, body }, sh, spec, setOn) {
  btn.addEventListener("click", () => setOn(spec.toggles ? body.hidden : true));
  escapeLeaves(body, () => {
    if (sh.ask) {
      sh.ask = null;
      spec.view(null);
      return;
    }
    setOn(false);
  });
  return { setOn, isOn: () => !body.hidden };
}
