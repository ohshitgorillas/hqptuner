// A stage drawer's head: its title (a drawer of one part) or its tab strip, then the apply group, then close. A staged
// restart-lane edit puts a dot on its tab, or on the title of a drawer of one part. The apply group is Discard and a
// split button: the body runs the apply mode in force, Apply or Apply & save; its ▾ key opens a menu that only switches
// which, one choice for every drawer.

import { html } from "../../../lib/dom.js";
import { discardAll } from "../../../store/actions.js";
import { toggleStage } from "../../../store/faceplate/view.js";
import {
  APPLY_MENU,
  APPLY_MODES,
  applyMode,
  canSave,
  pickApplyMode,
  runApply,
  showTab,
} from "../../../store/faceplate/drawer.js";
import { Popover, triggerProps } from "../Popover.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerHead} DrawerHead */

/** What the split body and the mode menu call each apply mode. @type {Record<string, string>} */
const MODE_NAMES = { apply: "Apply", save: "Apply & save" };

/**
 * A tab button's id.
 *
 * @param {DrawerSchema} schema
 * @param {string} tab
 */
export const tabId = (schema, tab) => `${schema.id}-tab-${tab}`;

/**
 * A tab panel's id.
 *
 * @param {DrawerSchema} schema
 * @param {string} tab
 */
export const panelId = (schema, tab) => `${schema.id}-p-${tab}`;

/**
 * The tab strip: one tab per part of the stage, the shown one selected, a staged one dotted.
 *
 * @param {DrawerSchema} schema
 * @param {string} shown
 * @param {string[]} dirty
 */
const tabStrip = (schema, shown, dirty) => html`
  <div class="seg dtabs" role="tablist" aria-label=${schema.aria}>
    ${schema.tabs.map(
      (t) => html`
        <button
          type="button"
          role="tab"
          id=${tabId(schema, t.id)}
          class=${dirty.includes(t.id) ? "dirty" : undefined}
          aria-controls=${panelId(schema, t.id)}
          aria-selected=${String(t.id === shown)}
          data-tab=${t.id}
          onClick=${() => showTab(schema.id, t.id)}
        >
          ${t.label}
        </button>
      `,
    )}
  </div>
`;

/** The mode menu: the two apply modes, the one in force ticked; Apply & save needs a loaded station. */
const modeMenu = () => html`
  <${Popover} id=${APPLY_MENU} cls="amenu" role="menu">
    ${APPLY_MODES.map(
      (m) => html`
        <button
          type="button"
          class="pmrow"
          role="menuitemradio"
          data-mode=${m}
          aria-checked=${String(applyMode.value === m)}
          disabled=${m === "save" && !canSave.value}
          onClick=${() => pickApplyMode(m)}
        >
          <b>${MODE_NAMES[m]}</b>
        </button>
      `,
    )}
  <//>
`;

/**
 * Discard and the split button. The group shows on a restart tab or with staged edits; its buttons need staged edits,
 * and the body in Apply & save mode needs a loaded station too.
 *
 * @param {{ shown: boolean, live: boolean }} apply
 */
function applyGroup({ shown, live }) {
  const mode = applyMode.value;
  const bodyOff = !live || (mode === "save" && !canSave.value);
  return html`
    <div class="apply" data-testid="apply-group" hidden=${!shown}>
      <button type="button" class="btn sm" data-testid="discard" disabled=${!live} onClick=${() => discardAll()}>
        Discard
      </button>
      <div class="asplit">
        <button type="button" class="btn sm aapply" data-testid="apply" disabled=${bodyOff} onClick=${() => runApply()}>
          ${MODE_NAMES[mode]}
        </button>
        <button type="button" class="btn sm akey" ...${triggerProps(APPLY_MENU, "menu")}>▾</button>
        ${modeMenu()}
      </div>
    </div>
  `;
}

/**
 * The head of a drawer.
 *
 * @param {{ schema: DrawerSchema, shown: string, head: DrawerHead }} props
 */
export function Head({ schema, shown, head }) {
  const single = schema.tabs.length === 1;
  return html`
    <div class="dhead">
      ${
        single
          ? html`<span class=${head.titleDot ? "t dirty" : "t"}>${schema.title}</span>`
          : tabStrip(schema, shown, head.dirty)
      }
      <span class="grow"></span>
      ${applyGroup(head.apply)}
      <button
        type="button"
        class="round dx"
        aria-label="Close drawer"
        data-testid="drawer-close"
        onClick=${() => toggleStage(schema.id)}
      >
        ×
      </button>
    </div>
  `;
}
