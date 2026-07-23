// Renders the open question from store/ask.js, inline in whichever component
// asked it (`owner`). Enter commits, Escape cancels, and an explicit Cancel
// button is always offered — the three things the native prompt()/confirm()
// dialogs did not give us. Renders nothing when nobody is asking, or when the
// open question belongs to another component.
import { useRef } from "preact/hooks";
import { html } from "../lib/dom.js";
import { question, answer, cancel } from "../store/ask.js";

function onKey(e) {
  if (e.key === "Enter") answer(e.currentTarget.value);
  else if (e.key === "Escape") cancel();
}

const nameField = (q, ref) => html`
  <span class="ask ask-name">
    <label class="ask-msg" for="ask-field">${q.message}</label>
    <input id="ask-field" type="text" ref=${ref} autofocus onKeyDown=${onKey} />
    <button class="primary" onClick=${() => answer(ref.current && ref.current.value)}>Save</button>
    <button onClick=${cancel}>Cancel</button>
  </span>
`;

const confirmLine = (q) => html`
  <span class="ask ask-confirm">
    <span class="ask-msg">${q.message}</span>
    <button class="primary" onClick=${() => answer()}>Confirm</button>
    <button onClick=${cancel}>Cancel</button>
  </span>
`;

export function Ask({ owner }) {
  const ref = useRef(null);
  const q = question.value;
  if (!q || q.owner !== owner) return null;
  return q.kind === "name" ? nameField(q, ref) : confirmLine(q);
}
