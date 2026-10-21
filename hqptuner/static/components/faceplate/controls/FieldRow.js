// A row: its head, control and gray reason beside its prose.

import { classNames, html } from "../../../lib/dom.js";

/**
 * The one row shell: the head, the control and the gray line in the controls column, the prose beside them, then what
 * hangs under the row. A row holding a staged edit is marked dirty, and `alert` names the alert lit on it.
 *
 * @param {{
 *   k?: string,
 *   field?: string,
 *   choice?: string,
 *   dirty?: boolean,
 *   alert?: string,
 *   head: unknown,
 *   control?: unknown,
 *   gray?: unknown,
 *   man?: unknown,
 *   under?: unknown,
 *   cls?: string,
 * }} props
 */
export function FieldRow({ k, field, choice, dirty = false, alert, head, control, gray, man, under, cls }) {
  return html`
    <div
      class=${classNames("drow", cls)}
      data-k=${k}
      data-field=${field}
      data-choice=${choice}
      data-dirty=${dirty ? "" : undefined}
      data-alert=${alert}
    >
      <div class="ctl">${head} ${control} ${gray}</div>
      <div class="man">${man}</div>
      ${under}
    </div>
  `;
}
