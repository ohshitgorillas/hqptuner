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
/**
 * @typedef {Event & { target: HTMLInputElement }} ControlEvent
 *   An input/change event from a form control. Every attachment site below is a
 *   range, number or select element, so `target` is narrowed from the DOM's
 *   nullable `EventTarget` to the element the handler actually reads.
 */

/**
 * Take the wheel off a control and scroll the page by the same delta instead.
 * @param {WheelEvent} e
 */
export function wheelGuard(e) {
  e.preventDefault();
  window.scrollBy(0, e.deltaY);
}

// wheelGuard's blind spot, closed: a scroll gesture over a slider on WebKit
// does not arrive as a cancelable wheel at all. Measured on Safari 26.5, the
// wheel events it does send are non-cancelable and the value change rides a
// separate channel — for the ARIA slider role, TRUSTED ArrowLeft/ArrowRight
// keydowns aimed at the element without focusing it (Knob.js onKeyDown carries
// that case); for a native range, an `input` that simply appears, with the
// guard above never firing. Neither can be prevented, so a slider edit is
// honored only with explicit user provenance on that element:
//
//   held  — a pointer is down on it (drag, track-click). Cleared by pointerup /
//           pointercancel, and by any pointermove reporting no buttons: a
//           context menu opened mid-drag eats the pointerup, and without the
//           buttons check the browser's stuck native drag would keep editing.
//   armed — one-shot: a slider keystroke on it WHILE IT HOLDS FOCUS, or a drag
//           release. Keyboard edits arrive with no pointer held, and a native
//           range fires its committing `change` AFTER pointerup — both need
//           their edit pair honored. Consumed by the `change` that closes the
//           pair. The focus qualifier is what keeps WebKit's scroll-synthesized
//           arrow key from arming a control the user never touched.
//
// The wheel-injected edit has neither and is refused. Trackers live on
// document capture so they observe every gesture before any handler; the
// typeof guard keeps this module importable in the SSR test harness, where the
// suite installs its fake document before importing.
const SLIDER_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
/** @type {EventTarget | null} */
let heldOn = null;
/** @type {EventTarget | null} */
let armedOn = null;
/** @type {EventTarget | null} */
let focusedOn = null;
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
  // A slider keystroke arms only the control that actually HOLDS focus. WebKit
  // converts a scroll over a slider-role element into trusted arrow keydowns
  // aimed at it without focusing it (see Knob.js onKeyDown); unqualified, that
  // synthetic key hands the platform's own value change a licence to pass. Both
  // spellings are tracked because `focus`/`blur` do not bubble and only reach a
  // capture listener, while `focusin`/`focusout` do — engines differ in which
  // they deliver first, and either one means the same thing here.
  document.addEventListener("focusin", (e) => (focusedOn = e.target), true);
  document.addEventListener("focus", (e) => (focusedOn = e.target), true);
  document.addEventListener("focusout", () => (focusedOn = null), true);
  document.addEventListener("blur", () => (focusedOn = null), true);
  document.addEventListener(
    "keydown",
    (e) => SLIDER_KEYS.has(e.key) && focusedOn === e.target && (armedOn = e.target),
    true,
  );
}

/**
 * Wrap a slider's input/change handler: with provenance the edit passes to
 * `fn`; without it nothing is called and the control snaps back to `canonical`
 * — the value the component is already rendering, so refusal needs no stored
 * snapshot. Attach to every range input alongside wheelGuard.
 * @param {string | number} canonical the value the component is already rendering
 * @param {(e: ControlEvent) => void} fn the handler an edit with provenance reaches
 * @returns {(e: ControlEvent) => void}
 */
export function userEdit(canonical, fn) {
  return (e) => {
    const el = e.target;
    const held = heldOn === el;
    const armed = armedOn === el;
    if (!held && !armed) {
      el.value = String(canonical);
      return;
    }
    if (armed && e.type === "change") armedOn = null;
    fn(e);
  };
}
