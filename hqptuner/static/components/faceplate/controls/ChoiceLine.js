// A choice line: a radio and a name over a paragraph.

import { classNames, html } from "../../../lib/dom.js";

/**
 * One line of a choice list. The radio and the name both call `onPick`, the picked line included. Given a `summary`, an
 * unpicked line folds to its name and the summary, and hides its paragraph.
 *
 * @param {{
 *   v: string,
 *   label: string,
 *   sub?: string,
 *   picked: boolean,
 *   off?: boolean,
 *   man?: unknown,
 *   detail?: unknown,
 *   summary?: unknown,
 *   onPick: () => void,
 * }} props
 */
export function ChoiceLine({ v, label, sub, picked, off = false, man, detail, summary, onPick }) {
  const folded = Boolean(summary) && !picked;
  return html`
    <div class=${classNames("chline", picked && "cur", folded && "fold")} data-v=${v}>
      <div class="chl">
        <button
          type="button"
          class="radio"
          role="radio"
          aria-checked=${String(picked)}
          aria-label=${label}
          disabled=${off}
          onClick=${onPick}
        ></button>
        <span class="chn" onClick=${off ? undefined : onPick}>
          <b>${label}</b>${sub ? html`<span class="s">${sub}</span>` : null}
        </span>
        ${folded ? summary : null} ${detail}
      </div>
      ${folded ? null : html`<div class="man">${man}</div>`}
    </div>
  `;
}
