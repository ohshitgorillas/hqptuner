// The stations menu of the builder: a window listing the stations Save writes to, and a menu of every station under it,
// ✓ = ticked. A station already holding another record of this name shows the name at the right. Ticking stays open.

import { html } from "../../../lib/dom.js";
import { heldAt, toggleStation } from "../../../model/builders/builder.js";
import { Popover, triggerProps } from "../Popover.js";

const MENU = "bstations";

/**
 * The stations menu.
 * @param {{ stations: string[], ticked: string[], name: string, book: Record<string, Record<string, unknown>>, cur: { st: string, name: string }, pick: (list: string[]) => void }} props
 */
export function StationsMenu({ stations, ticked, name, book, cur, pick }) {
  const list = ticked.join(" · ");
  return html`
    <div class="bstw">
      <button type="button" class="vfd bstn" title=${list} ...${triggerProps(MENU, "menu")}>
        <span class="l">Stations</span>
        <span class="v">${list || "—"}</span>
      </button>
      <${Popover} id=${MENU} cls="pmenu amenu bstmenu" role="menu" label="Stations">
        ${stations.map(
          (st) => html`
            <button
              type="button"
              class="pmrow"
              role="menuitemcheckbox"
              aria-checked=${String(ticked.includes(st))}
              onClick=${() => pick(toggleStation(stations, ticked, st))}
            >
              <b>${st}</b>${heldAt(book, cur, name, st) ? html`<span>${name}</span>` : null}
            </button>
          `,
        )}
      <//>
    </div>
  `;
}
