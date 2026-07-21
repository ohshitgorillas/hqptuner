// Shared tab-layout primitives: Section (tab body wrapper), Card (titled,
// non-collapsible group), Collapsible (auto-opens from app state, manual
// override wins), and the checkbox-truth normalizer used across tab bodies.
import { html } from "../../lib/dom.js";

export function Section({ children }) {
  return html`<section class="tab-body">${children}</section>`;
}

export function Card({ title, children }) {
  return html`
    <section class="card">
      <div class="card-head">${title}</div>
      <div class="card-body">${children}</div>
    </section>
  `;
}

export function Collapsible({ title, auto, override, children }) {
  const open = override.value === null ? auto.value : override.value;
  return html`
    <section class="collapsible ${open ? "open" : "closed"}">
      <button type="button" class="collapsible-head" onClick=${() => (override.value = !open)}>
        <span class="tri">${open ? "▾" : "▸"}</span> ${title}
      </button>
      ${open ? html`<div class="collapsible-body">${children}</div>` : null}
    </section>
  `;
}

// checkbox value can arrive as bool (config) or "1"/"0" (staged) — normalize.
export const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";
