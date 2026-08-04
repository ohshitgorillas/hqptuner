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
