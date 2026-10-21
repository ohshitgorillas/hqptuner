// A row's label head: the label, the restart mark, the sublabel and band tag, and a control parked on the line.

import { html } from "../../../lib/dom.js";

/**
 * The mark a setting's head carries when applying it restarts the engine.
 *
 * @param {{ tip: string }} props  tip: the mark's tooltip
 */
export function RestartMark({ tip }) {
  return html`<span class="rs" data-testid="restart-mark" title=${tip}>↻</span>`;
}

/**
 * A row's label head. A non-empty `restarts` draws the restart mark with that tip; the sublabel, the band tag (in
 * capitals) and `tail` follow, each only when given.
 *
 * @param {{ label: string, sub?: string, band?: string, restarts?: string, tail?: unknown }} props
 */
export function Head({ label, sub, band, restarts, tail }) {
  return html`
    <div class="fh">
      <b>${label}</b>${restarts ? html`<${RestartMark} tip=${restarts} />` : null}${
        sub ? html`<span class="s">${sub}</span>` : null
      }
      ${band ? html`<span class="band">${band.toUpperCase()}</span>` : null}${tail ?? null}
    </div>
  `;
}
