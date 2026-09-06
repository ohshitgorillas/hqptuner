// The filter primer: the third face the filter half of a page can show, beside
// the filter cards and the Easy Mode card. It stands in place of the same three
// cards Easy Mode does; the swap belongs to the pages that render those cards
// (tabs/OutputTab.js, live/View.js), so this component knows nothing about what
// it replaced. Design: docs/plans/filter-primer-design.md.
//
// A real `Card`, for the same reason Easy Mode's is: it sits in the stack the
// filter cards occupy, and a panel painting the card surface under its own name
// is how a surface drifts off the frame (docs/design-system.md).
//
// Prose is the owner's, verbatim, from ./copy.js; the only markup the view adds
// is the tags the owner's `**strong**` and `*stressed*` marks and bullet lists
// stand for. The graph (./Graph.js) sits across the full width at the top of
// the card, the prose below it at the reading measure.
//
// Rendered only while open: the pages mount it behind the flag, so there is no
// hidden copy in the document while the filter cards are showing.
import { html } from "../../lib/dom.js";
import { Card } from "../common.js";
import { setPrimerOpen } from "../../store/primerview.js";
import { INTRO, SECTIONS } from "./copy.js";
import { PrimerGraph } from "./Graph.js";

/** The card's explanation, owner copy verbatim. */
const SUBTITLE =
  "The Filter Playground features textbook-standard filter mathematics, similar but not equivalent to HQPlayer's FIR filters. HQPlayer's actual filter mathematics are proprietary and strictly off-limits under the terms and conditions.";

/** Matches a strong or stressed run and captures it, so a split keeps the pieces. */
const SPLIT = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

/**
 * One run of a paragraph: the owner's `**strong**` and `*stressed*` marks as
 * the tags they stand for, everything else as text.
 * @param {{ piece: string }} props
 */
function Run({ piece }) {
  if (piece.startsWith("**")) return html`<strong>${piece.slice(2, -2)}</strong>`;
  if (piece.startsWith("*")) return html`<em>${piece.slice(1, -1)}</em>`;
  return html`${piece}`;
}

/** @param {{ text: string }} props */
function Para({ text }) {
  return html`<p>
    ${text
      .split(SPLIT)
      .filter((piece) => piece !== "")
      .map((piece) => html`<${Run} piece=${piece} />`)}
  </p>`;
}

/** @param {{ block: import("./copy.js").Block }} props */
function Prose({ block }) {
  if (typeof block === "string") return html`<${Para} text=${block} />`;
  return html`<ul>
    ${block.map((item) => html`<li><${Para} text=${item} /></li>`)}
  </ul>`;
}

// The way out sits in the card's head, at the corner the way in occupies in the
// Narrow filters head, exactly as Easy Mode's does. It is the only way out and
// the first thing in the tab order after the chrome.
function BackLink() {
  return html`<button type="button" class="primer-back" data-testid="primer-back" onClick=${() => setPrimerOpen(false)}>
    Back to filters
  </button>`;
}

/** The filter playground, standing in for the Narrow filters card and the two chain cards. */
export function PrimerView() {
  return html`
    <${Card} id="filter-primer" title=${html`Filter Playground<${BackLink} />`} subtitle=${SUBTITLE}>
      <${PrimerGraph} />
      <div class="primer-layout">
        <div class="primer-prose t-read">
          <div class="t-head">Filter Primer</div>
          ${INTRO.map((text) => html`<${Para} text=${text} />`)}
          ${SECTIONS.map(
            (s) => html`
              <section class="primer-section" data-section=${s.id}>
                <div class="t-eyebrow">${s.heading}</div>
                ${s.blocks.map((block) => html`<${Prose} block=${block} />`)}
              </section>
            `,
          )}
        </div>
      </div>
    <//>
  `;
}
