// Shared tab-layout primitives: Section (tab body wrapper), Card (the one card
// component — collapsible or not), collapseFrom (the auto/override signal pair
// as a collapse handle), and the checkbox-truth normalizer used across tab
// bodies.
//
// Card markup lives HERE and nowhere else. It used to be hand-rolled at ten
// call sites, which is how a surface fix had to be applied ten times and how
// cards.css's .span mask ended up enumerating container classes by hand. The
// eslint rule hqptuner/no-hand-rolled-card holds the line; the three sites
// whose structure genuinely does not fit carry a disable comment with a reason.
//
// There is no separate Collapsible. A collapsible card was never a different
// component — it is a card whose head is a button, and keeping the two apart is
// what let their surfaces drift until an open collapsible read as a darker card
// than the card beside it.
import { html } from "../../lib/dom.js";

export function Section({ children }) {
  return html`<section class="tab-body">${children}</section>`;
}

// The collapse handle for a card driven by app state: `auto` opens it from the
// engine's own shape, a non-null `override` means the user has spoken and wins.
export function collapseFrom(auto, override) {
  const open = override.value === null ? auto.value : override.value;
  return { open, onToggle: () => (override.value = !open) };
}

// `title` may be a string or markup — a head with a badge or a count needs no
// API of its own. `hint` is the section's tooltip: it cannot be called `title`
// because that name is already the head content.
//
// `collapse` is the one feature distinction: absent, the card is static and its
// body always renders; present, the head becomes the toggle button and the body
// renders only when open. It carries {open, onToggle} rather than being a bare
// boolean because the flag and the state it needs are the same fact.
export function Card({ title, collapse, cardClass, bodyClass, headClass, hint, children }) {
  const open = !collapse || collapse.open;
  const headCls = headClass ? `card-head ${headClass}` : "card-head";
  const head = collapse
    ? html`<button type="button" class=${headCls} onClick=${collapse.onToggle}>
        <span class="tri">${open ? "▾" : "▸"}</span> ${title}
      </button>`
    : html`<div class=${headCls}>${title}</div>`;
  // .card.closed does the collapsed styling; there is no .card.open rule and none is wanted.
  // class-exempt: "open" is the DOM's record of collapse state — the tab tests read it back.
  const cls = ["card", cardClass, collapse ? (open ? "open" : "closed") : null].filter(Boolean).join(" ");
  return html`
    <section class=${cls} title=${hint}>
      ${head}
      ${open ? html`<div class=${bodyClass ? `card-body ${bodyClass}` : "card-body"}>${children}</div>` : null}
    </section>
  `;
}
