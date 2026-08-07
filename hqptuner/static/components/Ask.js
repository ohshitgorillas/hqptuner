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
 *   options?: ChoiceOption[] }} Question
 *   The open question as store/ask.js publishes it. `options` exists on the
 *   "choices" kind only; `refused` is set by the name kind's empty-answer path.
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
/**
 * @param {Question} q
 */
const choicesList = (q) => html`
  <span class="ask ask-choices">
    <span class="multi-pop ask-pop">
      <span class="ask-msg">${q.message}</span>
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
          </label>
        `,
      )}
      <span class="ask-pop-actions">
        <button class="primary" onClick=${() => answer()}>Confirm</button>
        <button onClick=${cancel}>Cancel</button>
      </span>
    </span>
  </span>
`;

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
 * @param {{ owner: string }} props
 */
export function Ask({ owner }) {
  const ref = useRef(null);
  const q = question.value;
  const mine = !!q && q.owner === owner && q.kind === "name";
  useLayoutEffect(() => {
    if (mine && ref.current) ref.current.focus();
  }, [mine]);
  if (!q || q.owner !== owner) return null;
  if (q.kind === "choices") return choicesList(q);
  return q.kind === "name" ? nameField(q, ref) : confirmLine(q);
}
