// A stage drawer drawn from its schema over the v1 store: the head, the open question pinned under it, then one panel
// per tab. It is closed unless its stage is the open one (store/faceplate/view.js); closing never discards, so staged
// edits stay put. It reads idle while its shown tab carries a status word, and combo while its backend shows every
// group. The decisions are store/faceplate/drawer.js's.

import { html } from "../../../lib/dom.js";
import { answer, cancel } from "../../../store/ask.js";
import { openStage } from "../../../store/faceplate/view.js";
import { drawerHead, drawerQuestion, shownTab } from "../../../store/faceplate/drawer.js";
import { Head, panelId, tabId } from "./Head.js";
import { item } from "./Rows.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerTab} DrawerTab */
/** @typedef {import("./Rows.js").Blocks} Blocks */

/**
 * The open question, pinned under the head as an alert line with its two answers; nothing when none is this drawer's.
 *
 * @param {DrawerSchema} schema
 */
function pinnedQuestion(schema) {
  const q = drawerQuestion(schema);
  if (!q) return null;
  return html`
    <div class="dalert">
      <p class="aline" data-sev="warn">
        <span class="ag" aria-hidden="true">⚠</span>
        <span>
          ${q.message}
          <button type="button" class="btn sm" onClick=${cancel}>${q.decline}</button>
          <button type="button" class="btn sm" onClick=${() => answer()}>${q.confirm}</button>
        </span>
      </p>
    </div>
  `;
}

/**
 * One tab's panel: its body items, shown only while its tab is. A drawer of one part has no tabpanel.
 *
 * @param {DrawerSchema} schema
 * @param {DrawerTab} tab
 * @param {string} shown
 * @param {Blocks} blocks
 */
function panel(schema, tab, shown, blocks) {
  const tabbed = schema.tabs.length > 1;
  return html`
    <div
      class="dpanel"
      id=${panelId(schema, tab.id)}
      role=${tabbed ? "tabpanel" : undefined}
      aria-labelledby=${tabbed ? tabId(schema, tab.id) : undefined}
      data-tab=${tab.id}
      hidden=${tab.id !== shown}
    >
      ${tab.body.map((it) => item(schema, it, blocks))}
    </div>
  `;
}

/**
 * The drawer's classes: `idle` while its shown tab carries a status word, `combo` while its backend is `combo`.
 *
 * @param {DrawerSchema} schema
 * @param {string} shown
 */
function drawerClass(schema, shown) {
  const tab = schema.tabs.find((t) => t.id === shown);
  const idle = !!tab?.status?.();
  const combo = schema.group?.() === "combo";
  return ["drawer", idle ? "idle" : "", combo ? "combo" : ""].filter(Boolean).join(" ");
}

/**
 * A stage drawer.
 *
 * @param {{ schema: DrawerSchema, blocks?: Blocks }} props  blocks: the components a `{ block }` item mounts, by name
 */
export function Drawer({ schema, blocks = {} }) {
  const shown = shownTab(schema);
  const head = drawerHead(schema, shown);
  return html`
    <aside
      class=${drawerClass(schema, shown)}
      id=${`drawer-${schema.id}`}
      aria-label=${schema.aria}
      data-closed=${openStage.value === schema.id ? undefined : ""}
    >
      <${Head} schema=${schema} shown=${shown} head=${head} />
      ${pinnedQuestion(schema)} ${schema.tabs.map((t) => panel(schema, t, shown, blocks))}
    </aside>
  `;
}
