// Renders the open question from store/ask.js, inline in whichever component
// asked it (`owner`). Enter commits, Escape cancels, and an explicit Cancel
// button is always offered — the three things the native prompt()/confirm()
// dialogs did not give us. Renders nothing when nobody is asking, or when the
// open question belongs to another component.
//
// The name field is focused imperatively rather than through the `autofocus`
// attribute. A question is always opened BY A CLICK, so at the moment the field
// renders the document already has a focused element — the button that was just
// clicked — and browsers block autofocus outright in that case ("Autofocus
// processing was blocked because a document already has a focused element").
// The field then sat there unfocused: everything typed went to the still-focused
// button, and Enter re-clicked it, which supersedes the question and withdraws
// it. The whole save read as a no-op with nothing said. Programmatic focus is
// not blocked.
import { useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../lib/dom.js";
import { question, answer, cancel, clearRefusal, toggleChoice } from "../store/ask.js";

/**
 * @typedef {{ owner: string, kind: string, message: string, refused?: boolean,
 *   options?: ChoiceOption[], named?: boolean, confirm?: string, decline?: string }} Question
 *   The open question as store/ask.js publishes it. `options` and `named` exist
 *   on the "choices" kind only; `confirm` and `decline` on the "warn" kind only;
 *   `refused` is set by the empty-answer path of the name kind and of named choices.
 * @typedef {{ current: HTMLInputElement | null }} FieldRef
 */

/**
 * @param {{ key: string, currentTarget: HTMLInputElement }} e
 */
function onKey(e) {
  if (e.key === "Enter") answer(e.currentTarget.value);
  else if (e.key === "Escape") cancel();
}

/**
 * @param {Question} q
 * @param {FieldRef} ref
 */
const nameField = (q, ref) => html`
  <span class="ask">
    <label class="ask-msg" for="ask-field">${q.message}</label>
    <input id="ask-field" type="text" ref=${ref} onKeyDown=${onKey} onInput=${clearRefusal} />
    ${q.refused ? html`<span class="ask-refused">Enter a name first</span>` : null}
    <button class="primary" onClick=${() => answer(ref.current && ref.current.value)}>Save</button>
    <button onClick=${cancel}>Cancel</button>
  </span>
`;

// The choices ask renders as a dropdown panel anchored under the row that
// asked — .multi-pop is the app's one popover chrome (narrowing.css), borrowed
// here so this reads as the same species as the filter facet dropdowns.
//
// The panel is a native manual popover: it lives in the top layer, so no
// ancestor's overflow clip can cut it off however many options it lists (the
// profile picker grows by one row per preset, unbounded). "manual" and not
// "auto" because light-dismiss would hide the panel without settling the
// question's promise, leaving the asking card stuck busy — Cancel/Escape via
// store/ask.js are the only ways out. The top layer ignores the anchor's
// positioning context, so the panel is pinned to the ask row's viewport rect
// imperatively, and re-pinned while the page scrolls or resizes under it.
/**
 * @param {HTMLElement} pop
 */
const pinToAnchor = (pop) => {
  const anchor = pop.parentElement;
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  // Horizontal bound is the CARD the asking control sits in, not the viewport.
  // The panel is 20rem (controls/ask.css) and the content column is ~1200px, so
  // a control in a right-hand column anchors a panel that clears the card's
  // right edge and lays itself over the page gutter and the pending bar. Pin its
  // right edge to the card's instead, and only then let the viewport have the
  // last word (a card wider than the viewport, below the 1100px breakpoint).
  const card = anchor.closest(".card, .dsp-card") || document.body;
  const b = card.getBoundingClientRect();
  const right = Math.min(b.right, window.innerWidth - 8) - pop.offsetWidth;
  const left = Math.max(Math.min(r.left, right), Math.min(b.left, right));
  // Vertical stays viewport-bound rather than card-bound: a card is a horizontal
  // frame, and a control low in a tall card would otherwise open its panel below
  // the fold. The floor is the fixed pending bar, not the viewport edge — the bar
  // paints over the page and a panel pinned to the bottom would cover Discard and
  // Apply, the two buttons the answer sends the user to next.
  const bar = document.querySelector(".pending-bar");
  const floor = bar ? bar.getBoundingClientRect().top : window.innerHeight;
  const top = Math.min(r.bottom, floor - pop.offsetHeight - 8);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${Math.max(8, top)}px`;
};

/**
 * Show the popover in the top layer, pinned under its anchor row and re-pinned
 * as the page scrolls or resizes beneath it.
 *
 * @param {{ current: HTMLElement | null }} pop
 */
function usePinnedPopover(pop) {
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return undefined;
    el.showPopover();
    const place = () => pinToAnchor(el);
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);
}

// A named choices panel (the live snapshot save) carries the name field above
// the list; its value rides to answer() the way the inline name field's does.
/**
 * @param {{ q: Question, field: FieldRef }} props
 */
function ChoicesList({ q, field }) {
  const pop = useRef(/** @type {HTMLElement | null} */ (null));
  usePinnedPopover(pop);
  const commit = () => answer(field.current && field.current.value);
  return html`
  <span class="ask ask-choices">
    <span class="multi-pop ask-pop" popover="manual" ref=${pop}>
      <span class="ask-msg">${q.message}</span>
      ${
        q.named
          ? html`<span class="ask-pop-name">
            <input id="ask-field" type="text" ref=${field} onKeyDown=${onKey} onInput=${clearRefusal} />
            ${q.refused ? html`<span class="ask-refused">Enter a name first</span>` : null}
          </span>`
          : null
      }
      ${(q.options || []).map(
        (o) => html`
          <label class=${o.disabled ? "ask-choice-pinned" : ""}>
            <input
              type="checkbox"
              checked=${o.checked}
              disabled=${o.disabled}
              onChange=${() => toggleChoice(o.value)}
            />
            <span class="opt-label">${o.label}</span>
            ${o.detail ? html`<span class="ask-choice-detail">${o.detail}</span>` : null}
          </label>
        `,
      )}
      <span class="ask-pop-actions">
        <button class="primary" onClick=${commit}>Confirm</button>
        <button onClick=${cancel}>Cancel</button>
      </span>
    </span>
  </span>
`;
}

// The warn ask is the guard in front of a hazardous edit (store/actions.js).
// Same top-layer popover chrome as the choices ask, and "manual" for the same
// reason — light-dismiss would hide it without settling the promise. The safe
// way out is the primary button; the destructive choice is deliberately the
// plain one — whatever wording the asker gave them (store/ask.js).
/**
 * @param {{ q: Question }} props
 */
function WarnBox({ q }) {
  const pop = useRef(/** @type {HTMLElement | null} */ (null));
  usePinnedPopover(pop);
  return html`
  <span class="ask ask-warn">
    <span class="multi-pop ask-pop" popover="manual" ref=${pop}>
      <span class="ask-msg">${q.message}</span>
      <span class="ask-pop-actions">
        <button class="primary" onClick=${cancel}>${q.decline}</button>
        <button onClick=${() => answer()}>${q.confirm}</button>
      </span>
    </span>
  </span>
`;
}

/**
 * @param {Question} q
 */
const confirmLine = (q) => html`
  <span class="ask">
    <span class="ask-msg">${q.message}</span>
    <button class="primary" onClick=${() => answer()}>Confirm</button>
    <button onClick=${cancel}>Cancel</button>
  </span>
`;

/**
 * Renders the pending question inline when it belongs to this owner — a choices popup, a name field, or a confirm line.
 *
 * @param {{ owner: string }} props
 */
export function Ask({ owner }) {
  const ref = useRef(null);
  const q = question.value;
  const mine = !!q && q.owner === owner && (q.kind === "name" || (q.kind === "choices" && !!q.named));
  useLayoutEffect(() => {
    if (mine && ref.current) ref.current.focus();
  }, [mine]);
  if (!q || q.owner !== owner) return null;
  if (q.kind === "choices") return html`<${ChoicesList} q=${q} field=${ref} />`;
  if (q.kind === "warn") return html`<${WarnBox} q=${q} />`;
  return q.kind === "name" ? nameField(q, ref) : confirmLine(q);
}
