// Shared tab-layout primitives: Section (tab body wrapper), Card (the one card
// component — collapsible or not), collapseFrom (the auto/override signal pair
// as a collapse handle), and the checkbox-truth normalizer used across tab
// bodies.
//
// Card markup lives HERE and nowhere else. Hand-rolled at every call site, a
// surface fix has to be applied at each one and cards.css's .span mask ends up
// enumerating container classes by hand. The
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

// The head bar. A collapsible card's head IS the toggle, so it renders as a
// `<button>` carrying the open/closed triangle; every other card's head is a
// plain `<div>`.
function cardHead({ title, collapse, open, headCls }) {
  if (collapse) {
    return html`<button type="button" class=${headCls} onClick=${collapse.onToggle}>
      <span class="tri">${open ? "▾" : "▸"}</span> ${title}
    </button>`;
  }
  return html`<div class=${headCls}>${title}</div>`;
}

// `title` may be a string or markup — a head with a badge or a count needs no
// API of its own. `hint` is the section's tooltip: it cannot be called `title`
// because that name is already the head content.
//
// `collapse` is the one feature distinction: absent, the card is static and its
// body always renders; present, the head becomes the toggle button and the body
// renders only when open. It carries {open, onToggle} rather than being a bare
// boolean because the flag and the state it needs are the same fact.
//
// `subtitle` is the feature's own prose. It belongs to the CARD and not to a
// row: a card gated by a master switch has one explanation, and rendering it
// under the switch made it read as a caption on the switch. It sits at the top
// of the card BODY and not in the head strip — the head is a name plate, and a
// paragraph inside it turns the strip into a block of raised surface taller than
// the controls it introduces. The text comes from settings.json through
// store/prose.js — a call site passes `noteFor("<gate key>")`, never a string of
// its own.
//
// `center` is for a card whose body is ONE control spanning the whole frame —
// the Output hero row. A head pinned to the left edge of a card that wide reads
// as a caption on whatever happens to sit under its left edge rather than as
// the name of the row beneath it.
export function Card({ title, subtitle, collapse, center, cardClass, bodyClass, headClass, hint, children }) {
  const open = !collapse || collapse.open;
  const headCls = ["card-head", center ? "center" : null, headClass].filter(Boolean).join(" ");
  const sub = subtitle ? html`<span class="card-sub t-caption">${subtitle}</span>` : null;
  const head = cardHead({ title, collapse, open, headCls });
  // .card.closed does the collapsed styling; there is no .card.open rule and none is wanted.
  // class-exempt: "open" is the DOM's record of collapse state — the tab tests read it back.
  const cls = ["card", cardClass, collapse ? (open ? "open" : "closed") : null].filter(Boolean).join(" ");
  return html`
    <section class=${cls} title=${hint}>
      ${head}
      ${open ? html`<div class=${bodyClass ? `card-body ${bodyClass}` : "card-body"}>${sub}${children}</div>` : null}
    </section>
  `;
}
