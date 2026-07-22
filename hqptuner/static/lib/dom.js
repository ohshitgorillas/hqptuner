// Shared htm+preact binding. One `html` tagged template for every component.
// htm binds to preact's hyperscript `h`; no JSX, no build step.
import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);

// Focus-gated wheel guard for native range/number inputs. A control reacts to
// the mouse wheel only once engaged (focused/clicked); an unengaged control does
// NOT eat the wheel — the page scrolls normally instead of the value jumping as
// the cursor passes over it. Attach as onWheel on the input. (preact binds wheel
// non-passive, so preventDefault takes effect.)
export function wheelGuard(e) {
  if (document.activeElement === e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.blur();
  window.scrollBy(0, e.deltaY);
}
