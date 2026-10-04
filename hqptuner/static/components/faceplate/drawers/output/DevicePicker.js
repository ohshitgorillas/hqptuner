// The Output drawer's device picker for one backend: a trigger naming the effective device, its list of the daemon's
// devices under their group headers, and the device rescan. Engine device strings split on ": ": a network device is
// `host: card: interface`, the trigger showing the card big and `host · interface` small, the list grouped by host; an
// ALSA device is `card: interface`, the trigger showing the interface big and the card small, the list grouped by card.
// The list is a plate popover (components/faceplate/Popover.js): its trigger toggles it, Escape and a click outside
// close it, a tap on a device stages it and closes it. Every decision is the store's
// (store/faceplate/drawers/output.js).
//
// The rescan's cost is said only while auto-save is on, since auto-save is what puts the live settings back after the
// rescan stops the engine; with it off the sentence would be false.

import { html } from "../../../../lib/dom.js";
import { isDirty } from "../../../../store/resolve.js";
import { autosave } from "../../../../store/actions.js";
import { openPopover } from "../../../../store/faceplate/view.js";
import { deviceView, pickDevice, rescanDevices, rescanning } from "../../../../store/faceplate/drawers/output.js";
import { triggerProps } from "../../Popover.js";

/** @typedef {import("../../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../../store/faceplate/drawers/output.js").DeviceRowView} DeviceRowView */

/** The trigger's accessible name, by the key it picks for. @type {Record<string, string>} */
const ARIA = { net_device: "Network Audio output device", alsa_device: "ALSA output device" };

const RESCAN = "⟳ Rescan devices";
const RESCANNING = "Rescanning…";
const RESCAN_COST = "Stops the engine. All live settings except matrix profiles survive.";

/**
 * Stage a device and close the list.
 *
 * @param {string} k
 * @param {string} value
 */
async function pick(k, value) {
  openPopover.value = null;
  await pickDevice(k, value);
}

/**
 * One device in the list: its lamp, name and detail, the effective one current.
 *
 * @param {{ k: string, row: DeviceRowView }} props
 */
const DeviceRow = ({ k, row }) => html`
  <button
    type="button"
    class=${row.cur ? "devrow cur" : "devrow"}
    role="option"
    aria-selected=${String(row.cur)}
    data-v=${row.value}
    onClick=${() => pick(k, row.value)}
  >
    <span class=${row.cur ? "lamp on" : "lamp"}></span>
    <span class="m">${row.main}</span>
    ${row.detail ? html`<span class="d">${row.detail}</span>` : null}
  </button>
`;

/** The rescan button, and its cost while auto-save makes the cost true. */
function Rescan() {
  const busy = rescanning.value;
  return html`
    <div class="act">
      <button type="button" class="btn xs" data-testid="rescan" disabled=${busy} onClick=${rescanDevices}>
        ${busy ? RESCANNING : RESCAN}
      </button>
      ${autosave.value ? html`<span class="cap" data-testid="rescan-cost">${RESCAN_COST}</span>` : null}
    </div>
  `;
}

/**
 * The device picker for `k`, net_device or alsa_device. The prop is `k` rather than `key`, which preact keeps for
 * itself. `schema` is the drawer's, which a block is handed; the picker reads nothing from it.
 *
 * @param {{ schema?: DrawerSchema, k: string }} props
 */
export function DevicePicker({ k }) {
  const view = deviceView(k);
  const id = `devpick-${k}`;
  const open = openPopover.value === id;
  return html`
    <div class="devpick" data-k=${k} data-kind=${view.kind} data-dirty=${isDirty(k) ? "" : undefined}>
      <button type="button" class="vfd devbtn" aria-label=${ARIA[k]} ...${triggerProps(id, "listbox")}>
        <span class="tx"><span class="v">${view.main}</span><span class="l">${view.sub}</span></span>
        <span class="ar">${open ? "▲" : "▼"}</span>
      </button>
      <div class="devlist" role="listbox" data-pop=${id} hidden=${!open}>
        ${view.groups.map(
          (g) => html`
            <div class="gh"><span>${g.group}</span><span class="ln"></span></div>
            ${g.rows.map((row) => html`<${DeviceRow} k=${k} row=${row} />`)}
          `,
        )}
      </div>
      <${Rescan} />
    </div>
  `;
}
