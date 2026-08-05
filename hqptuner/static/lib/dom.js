// Shared htm+preact binding. One `html` tagged template for every component.
// htm binds to preact's hyperscript `h`; no JSX, no build step.
import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);

// The mouse wheel never changes a control's value. The wheel is how you move
// down the page, and a page this dense in sliders, number boxes and dropdowns
// would otherwise hand out silent edits to anyone scrolling past one. The guard
// takes the wheel off the control and scrolls the page by the same delta.
//
// There is no exception in here, deliberately: a focused control is guarded
// exactly like an unfocused one. Exempting the focused control is what let a
// clicked slider take the wheel and move. The control is also NOT blurred —
// blurring a number box mid-type fires its change handler and commits a
// half-typed figure.
//
// Attach as onWheel on every wheel-sensitive control: range, number, select.
// (preact binds the listener on the element itself, where wheel is non-passive,
// so preventDefault takes effect — unlike a document-level listener, which the
// browser makes passive by default.)
export function wheelGuard(e) {
  e.preventDefault();
  window.scrollBy(0, e.deltaY);
}

// wheelGuard's blind spot, closed: macOS engines route a scroll gesture's first
// ticks over a slider straight to a value change at platform level, dispatching
// NO wheel event — there is nothing to cancel, an `input` just appears on the
// range (measured on the live page; the guard above never fires). A slider edit
// is therefore honored only with explicit user provenance on that element:
//
//   held  — a pointer is down on it (drag, track-click). Cleared by pointerup /
//           pointercancel, and by any pointermove reporting no buttons: a
//           context menu opened mid-drag eats the pointerup, and without the
//           buttons check the browser's stuck native drag would keep editing.
//   armed — one-shot: a slider keystroke on it, or a drag release. Keyboard
//           edits arrive with no pointer held, and a native range fires its
//           committing `change` AFTER pointerup — both need their edit pair
//           honored. Consumed by the `change` that closes the pair.
//
// The wheel-injected edit has neither and is refused. Trackers live on
// document capture so they observe every gesture before any handler; the
// typeof guard keeps this module importable in the SSR test harness, where the
// suite installs its fake document before importing.
const SLIDER_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
let heldOn = null;
let armedOn = null;
if (typeof document !== "undefined") {
  // Primary button only: a right-click's own pointerdown must not grant (or
  // refresh) provenance — it is the press that opens the context menu that eats
  // the pointerup and leaves the browser's native drag running. The menu
  // opening revokes held outright for the same reason: whatever drag was live,
  // its release will never arrive.
  document.addEventListener("pointerdown", (e) => e.button === 0 && (heldOn = e.target), true);
  document.addEventListener("contextmenu", () => (heldOn = null), true);
  document.addEventListener(
    "pointerup",
    () => {
      if (heldOn) armedOn = heldOn;
      heldOn = null;
    },
    true,
  );
  document.addEventListener("pointercancel", () => (heldOn = null), true);
  document.addEventListener("pointermove", (e) => e.buttons === 0 && (heldOn = null), true);
  document.addEventListener("keydown", (e) => SLIDER_KEYS.has(e.key) && (armedOn = e.target), true);
}

// Wrap a slider's input/change handler: with provenance the edit passes to
// `fn`; without it nothing is called and the control snaps back to `canonical`
// — the value the component is already rendering, so refusal needs no stored
// snapshot. Attach to every range input alongside wheelGuard.
export function userEdit(canonical, fn) {
  return (e) => {
    const el = e.target;
    if (heldOn !== el && armedOn !== el) {
      el.value = String(canonical);
      return;
    }
    if (armedOn === el && e.type === "change") armedOn = null;
    fn(e);
  };
}
