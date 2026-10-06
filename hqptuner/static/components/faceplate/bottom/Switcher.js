// The Setting Switcher bar at the foot of the plate: the target button with its menu of the targets, and the target's
// two slots, or the volume bar while the target is Volume. A slot's body sends it live, an arrow key sends the other
// one live, and its ▾ opens its list; under Matrix profile that list is a menu of the profiles, under Output mode the
// two slots are the fixed modes with no ▾. Every menu is the plate's own, parked at its button and flipped above it
// when the foot is too near.

import { useRef } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { openPopover, togglePopover } from "../../../store/faceplate/view.js";
import {
  TARGETS,
  switcherTarget,
  setSwitcherTarget,
  switcherView,
  setSlot,
  slotList,
  slotLive,
  pickId,
} from "../../../store/faceplate/bottom/switcher.js";
import { Popover, parkAt, triggerProps } from "../Popover.js";
import { VolumeBar } from "../Volume.js";

/** @typedef {import("../../../store/faceplate/bottom/switcher.js").SwitcherView} SwitcherView */
/** @typedef {import("../../../store/faceplate/bottom/switcher.js").Slot} Slot */
/** @typedef {{ current: (HTMLElement | null)[] }} Bodies */

const PICKS = ["Choose the first setting", "Choose the second setting"];
const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
/** @type {{ side: import("../../../model/shell/place.js").Side, foot: number, at: import("../../../model/shell/place.js").Place }} */
const HOW = { side: 22, foot: 14, at: { x: "start", y: "flip", gap: 8 } };
const TARGET_MENU = "swtarget";

/**
 * The popover id of a slot's menu.
 *
 * @param {number} i
 */
const menuId = (i) => `swpick-${i}`;

/**
 * Park a menu against its button.
 *
 * @param {HTMLElement} panel
 */
function park(panel) {
  const at = parkAt(panel, HOW);
  if (at) {
    panel.style.left = `${Math.round(at.left)}px`;
    panel.style.top = `${Math.round(at.top)}px`;
  }
}

/**
 * A target row's tap: the menu closes and the bar switches to it.
 *
 * @param {string} t
 */
function pickTarget(t) {
  openPopover.value = null;
  setSwitcherTarget(t);
}

/** The target button naming the current target, and its menu of the targets, the current one checked. */
function Target() {
  const cur = switcherTarget.value;
  return html`
    <div class="target">
      <span class="eng">Setting Switcher</span>
      <button type="button" class="vfd vpick" aria-label="Setting to switch" ...${triggerProps(TARGET_MENU, "menu")}>
        ${cur}
      </button>
      <${Popover} id=${TARGET_MENU} cls="pmenu" role="menu" label="Setting to switch" park=${park}>
        ${TARGETS.map(
          (t) => html`
            <button
              type="button"
              class="pmrow"
              role="menuitemradio"
              data-target=${t}
              aria-checked=${String(t === cur)}
              onClick=${() => pickTarget(t)}
            >
              ${t}
            </button>
          `,
        )}
      <//>
    </div>
  `;
}

/**
 * A slot's ▾: a list target's list opens over the body; Matrix profile's menu toggles.
 *
 * @param {number} i
 */
function pick(i) {
  if (slotList(i)) togglePopover(menuId(i));
}

/**
 * An arrow key on a slot's body: the other slot goes live and takes the focus.
 *
 * @param {{ key: string, preventDefault: () => void }} e
 * @param {number} i
 * @param {Bodies} bodies
 */
function arrow(e, i, bodies) {
  if (!ARROWS.has(e.key)) return null;
  e.preventDefault();
  const j = 1 - i;
  bodies.current[j]?.focus();
  return slotLive(j);
}

/**
 * One slot: its radio body naming the setting, and its ▾, the picker of a list target's key (`data-list`) where its
 * list parks (`id`).
 *
 * @param {{ s: Slot, i: number, mode: boolean, menu: boolean, key: string | null, tab: boolean, bodies: Bodies }} p
 */
const slot = ({ s, i, mode, menu, key, tab, bodies }) => html`
  <div class=${["slot", s.on ? "on" : "", mode ? "mode" : ""].filter(Boolean).join(" ")}>
    <button
      class="sbody"
      type="button"
      role="radio"
      aria-checked=${String(s.on)}
      tabindex=${tab ? 0 : -1}
      ref=${(/** @type {HTMLElement | null} */ el) => (bodies.current[i] = el)}
      onClick=${() => slotLive(i)}
      onKeyDown=${(/** @type {KeyboardEvent} */ e) => arrow(e, i, bodies)}
    >
      <span class="tx"
        ><span class="l">${s.name}</span><span class="v">${s.label}</span>${
          mode ? html`<span class="aka">${s.aka}</span>` : null
        }</span
      >
    </button>
    <button
      class="spick"
      type="button"
      aria-haspopup="dialog"
      aria-label=${PICKS[i]}
      id=${key ? pickId(i) : undefined}
      data-list=${key ?? undefined}
      data-pop=${menu ? menuId(i) : undefined}
      aria-expanded=${menu ? String(openPopover.value === menuId(i)) : undefined}
      hidden=${mode}
      onClick=${() => pick(i)}
    >
      ▾
    </button>
  </div>
`;

/**
 * A menu row's tap: the menu closes and the slot remembers the profile.
 *
 * @param {number} i
 * @param {string} value
 */
function pickRow(i, value) {
  openPopover.value = null;
  setSlot(i, value);
}

/**
 * Matrix profile's menu for one slot: a row per profile choice while it is open.
 *
 * @param {{ i: number }} props
 */
function SlotMenu({ i }) {
  const rows = openPopover.value === menuId(i) ? (slotList(i) ?? []) : [];
  return html`
    <${Popover} id=${menuId(i)} cls="pmenu" role="menu" label=${PICKS[i]} park=${park}>
      ${rows.map(
        (o) => html`
          <button
            type="button"
            class="pmrow"
            role="menuitem"
            disabled=${o.disabled}
            title=${o.reason || undefined}
            onClick=${() => pickRow(i, o.value)}
          >
            ${o.label}
          </button>
        `,
      )}
    <//>
  `;
}

/**
 * The two slots as a radio group, and Matrix profile's menus beside them.
 *
 * @param {{ v: SwitcherView }} props
 */
function Slots({ v }) {
  const bodies = useRef(/** @type {(HTMLElement | null)[]} */ ([]));
  const mode = v.layout === "mode";
  const menu = v.target === "Matrix profile";
  const live = Math.max(
    0,
    v.slots.findIndex((s) => s.on),
  );
  return html`
    <div class="slots" role="radiogroup" aria-label="Live setting">
      ${v.slots.map((s, i) => slot({ s, i, mode, menu, key: v.key, tab: i === live, bodies }))}
    </div>
    ${menu ? v.slots.map((_, i) => html`<${SlotMenu} i=${i} />`) : null}
  `;
}

/** The Setting Switcher bar. */
export function Switcher() {
  const v = switcherView();
  if (!v) return null;
  return html`
    <div class="switcher">
      <${Target} />
      ${v.layout === "volume" ? html`<${VolumeBar} />` : html`<${Slots} v=${v} />`}
    </div>
  `;
}
